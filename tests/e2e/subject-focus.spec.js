import { test, expect } from '@playwright/test';
import { fixtureDataUrl } from './helpers/fixtures.js';

const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const saved = async (page) => {
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeEnabled();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
};

test('real local model detects people after upload, stores focus, and exports the arranged crop', async ({
  page,
}, testInfo) => {
  test.setTimeout(210_000);
  test.skip(
    process.env.BANNERFLOW_REAL_FLORENCE !== '1' &&
      process.env.BANNERFLOW_TEST_SUBJECT_ENGINE !== 'florence',
    'Trained Florence-2 weights are an explicit opt-in.',
  );
  const engine = 'florence';
  const external = [];
  page.on('request', (r) => {
    if (/^https?:/.test(r.url()) && new URL(r.url()).hostname !== 'localhost')
      external.push(r.url());
  });
  await page.goto('/');
  await saved(page);
  const before = await project(page);
  // A crop of the synthetic photo fixture as a reproducible small hero.
  const fixture = await page.evaluate(async (src) => {
    const image = await createImageBitmap(await (await fetch(src)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 210;
    canvas.getContext('2d').drawImage(image, 0, 340, 300, 210, 0, 0, 300, 210);
    image.close();
    return canvas.toDataURL().split(',')[1];
  }, fixtureDataUrl('photo-300x600.png'));
  const searchStarted = Date.now();
  await page.locator('.upload-zone input').setInputFiles({
    name: 'hero-fixture.png',
    mimeType: 'image/png',
    buffer: Buffer.from(fixture, 'base64'),
  });
  await expect(
    page.getByRole('progressbar', { name: 'Automatic subject placement' }),
  ).toBeVisible();
  await expect(page.getByLabel('Campaign name', { exact: true })).toBeDisabled();
  await expect(page.locator('.subject-panel [role="status"]')).toHaveText(
    /placed|unavailable|No confident match/,
    { timeout: 185_000 },
  );
  const elapsedMs = Date.now() - searchStarted;
  await expect(page.locator('.subject-results button')).not.toHaveCount(0);
  await saved(page);
  const found = await project(page);
  expect(found.campaigns.BANNER1.subjectSearch.engine).toBe(engine);
  await testInfo.attach('subject-inference', {
    body: JSON.stringify(
      { engine, elapsedMs, results: found.campaigns.BANNER1.subjectSearch.results },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  console.log(`${engine} subject search: ${(elapsedMs / 1000).toFixed(1)} seconds`);
  expect(found.campaigns.BANNER1.subjectFocus.source).toBe('detected');
  expect(found.campaigns.BANNER1.subjectFocus.label).toMatch(/person|face/);
  expect(found.blueprints).toEqual(before.blueprints);
  expect(found.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);
  expect(external).toEqual([]);
  await page
    .locator('.subject-panel')
    .screenshot({ path: testInfo.outputPath('detected-subjects.png') });
  const pixelMatch = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const p = await loadProject(),
      entry = p.blueprints.find((e) => e.id === 'BANNER1-300x250'),
      bp = resolveBanner(entry, p.banners[entry.id]);
    const c = p.campaigns.BANNER1,
      r = await loadResources(c),
      a = canvasOf(300, 250),
      b = canvasOf(300, 250);
    renderFrame(a, bp, c, r);
    const bitmap = await createImageBitmap(await renderOutput(bp, c, r, 'png'));
    b.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const first = a.getContext('2d').getImageData(0, 0, 300, 250).data,
      second = b.getContext('2d').getImageData(0, 0, 300, 250).data;
    return first.every((v, i) => v === second[i]);
  });
  expect(pixelMatch).toBe(true);
  await page.reload();
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectFocus).toEqual(
    found.campaigns.BANNER1.subjectFocus,
  );
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await page
    .locator('.layer-row')
    .filter({ hasText: 'Campaign image' })
    .getByRole('button')
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Focus on/ })).toBeVisible();
});

// Local HTTP failure/race fixtures; the opt-in test above exercises trained inference.
test('no match and model errors allow manual focus; stale searches cannot change another image or market', async ({
  page,
}) => {
  await page.route('**/api/subjects/health', (route) =>
    route.fulfill({
      json: {
        service: 'bannerflow-sam3',
        schemaVersion: 1,
        engine: 'florence',
        ready: true,
        state: 'available',
        loaded: true,
        device: 'fixture',
        issues: [],
      },
    }),
  );
  await page.route('**/api/subjects/detect?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const broken = new URL(route.request().url()).searchParams.get('query') === 'broken';
    await route
      .fulfill({
        status: broken ? 503 : 200,
        json: broken
          ? { detail: 'Fixture error' }
          : {
              service: 'bannerflow-sam3',
              schemaVersion: 1,
              engine: 'florence',
              detections: [],
            },
      })
      .catch(() => {});
  });
  await page.goto('/');
  await saved(page);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText('No confident match');
  await page.getByLabel('Find in image').fill('broken');
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await expect(page.getByText(/Florence-2 unavailable/)).toBeVisible();
  await page.locator('.subject-preview').click({ position: { x: 60, y: 80 } });
  await saved(page);
  let p = await project(page);
  expect(p.campaigns.BANNER1.subjectFocus.source).toBe('manual');
  expect(p.banners['BANNER1-300x250'].arrangement).toBeTruthy();
  const focus = p.campaigns.BANNER1.subjectFocus;
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await page.getByRole('button', { name: 'Banner 2', exact: true }).click();
  await expect(page).toHaveURL(/market=BANNER2/);
  // URL updates precede the new market's panel commit during router transitions.
  await expect(page.locator('.subject-preview')).toHaveCount(0);
  await expect
    .poll(async () => (await project(page)).campaigns.BANNER2.subjectEngine)
    .toBe('florence');
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-160x600.png');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText('No confident match');
  await saved(page);
  p = await project(page);
  expect(p.campaigns.BANNER1.subjectFocus).toEqual(focus);
  expect(p.campaigns.BANNER2.subjectFocus).toBeFalsy();
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await saved(page);
  expect((await project(page)).campaigns.BANNER2.subjectFocus).toBeNull();
  await expect(page.getByRole('button', { name: 'Find subject', exact: true })).toBeEnabled();
});
