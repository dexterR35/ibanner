import { test, expect } from '@playwright/test';
import { bindFixtureHero } from './helpers/fixtures.js';

// Every model is mocked: this checks the Studio wiring, not trained-model quality.
const profileId = (c) => c.repeat(64);
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());

async function mockModels(page, calls) {
  await page.route('**/api/subjects/vision/capabilities*', (route) =>
    route.fulfill({
      json: {
        qwen: { ready: true },
        florence: { ready: true, profileId: profileId('f') },
        ocr: { ready: true, profileId: profileId('a') },
      },
    }),
  );
  await page.route('**/api/subjects/tools/health', (route) =>
    route.fulfill({
      json: {
        service: 'bannerflow-tools',
        schemaVersion: 1,
        state: 'available',
        device: 'cpu',
        tools: {
          cutout: { ready: true, issues: [], selection: 'box' },
          extend: { ready: false, issues: [] },
          upscale: { ready: false, issues: [] },
        },
      },
    }),
  );
  await page.route('**/api/subjects/tools/saliency*', (route) => {
    calls.push('saliency');
    return route.fulfill({
      json: {
        schemaVersion: 1,
        engine: 'birefnet',
        cols: 4,
        rows: 4,
        values: [0, 0, 0, 0, 0, 80, 90, 0, 0, 80, 90, 0, 0, 0, 0, 0],
        box: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
        coverage: 0.25,
      },
    });
  });
  await page.route('**/api/subjects/vision/ocr', (route) => {
    calls.push('ocr');
    return route.fulfill({
      json: {
        schemaVersion: 1,
        engine: 'rapidocr',
        width: 300,
        height: 210,
        lines: [
          { text: 'NO 10', confidence: 0.9, box: { x: 0.05, y: 0.05, width: 0.2, height: 0.08 } },
        ],
        profileId: profileId('a'),
        provenance: {},
      },
    });
  });
  await page.route('**/api/subjects/vision/reference', (route) => {
    calls.push('florence');
    return route.fulfill({
      json: {
        schemaVersion: 1,
        engine: 'florence2',
        width: 300,
        height: 210,
        textRegions: [],
        objects: [{ label: 'person', box: { x: 0.3, y: 0.2, width: 0.4, height: 0.7 } }],
        profileId: profileId('f'),
        provenance: {
          model: 'florence-community/Florence-2-base-ft',
          revision: '0'.repeat(40),
          device: 'cpu',
          coordinateSpace: 'normalized-oriented-preview',
          tasks: ['<OD>'],
        },
      },
    });
  });
  await page.route('**/api/subjects/vision/layout', async (route) => {
    const payload = route.request().postDataJSON();
    calls.push(['layout', payload]);
    // Propose the nearest example's boxes (the reference itself for reference-linked sizes).
    const targets = payload.targets.map((t) => {
      const svg = t.examples.at(-1).svg,
        boxes = {};
      for (const m of svg.matchAll(
        /<rect id="([a-z]+_\d+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g,
      ))
        if (t.elements.some((e) => e.id === m[1]))
          boxes[m[1]] = { x: +m[2], y: +m[3], width: +m[4], height: +m[5] };
      return { id: t.id, candidates: [{ complete: true, boxes }], raw: [svg] };
    });
    await route.fulfill({
      json: { schemaVersion: 1, method: 'postero-icl', targets, elapsedMs: 1200, provenance: {} },
    });
  });
  await page.route('**/api/subjects/vision/shorten', (route) => {
    calls.push('shorten');
    return route.fulfill({
      json: { suggestions: ['MATCH DAY'], role: 'headline', maxChars: 12, provenance: {} },
    });
  });
}

test('Arrange now analyzes the photo with every model and keeps the best layout per size', async ({
  page,
}) => {
  const calls = [];
  await mockModels(page, calls);
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await bindFixtureHero(page, ['BANNER1']);
  await saved(page);
  await page.getByRole('button', { name: 'Arrange now', exact: true }).click();
  await expect(page.getByText(/8 formats arranged/)).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(/Qwen3-VL took 1 s/)).toBeVisible();
  await saved(page);
  expect(calls.filter((c) => typeof c === 'string').sort()).toEqual([
    'florence',
    'ocr',
    'saliency',
  ]);
  const layout = calls.find((c) => c[0] === 'layout')[1];
  expect(layout.targets).toHaveLength(8);
  expect(layout.targets.every((t) => t.examples.length >= 1 && t.examples.length <= 4)).toBe(true);
  expect(layout.targets[0].description).toContain('Objects: person');
  const p = await project(page);
  expect(p.campaigns.BANNER1.photoAnalysis.engines.sort()).toEqual([
    'birefnet',
    'florence2',
    'opencv',
    'paddleocr',
  ]);
  for (const entry of p.blueprints.filter((e) => e.marketId === 'BANNER1')) {
    const banner = p.banners[entry.id];
    expect(banner.aiLayout.versionId).toBe(banner.blueprintVersionId);
    expect(banner.arrangement).toBeTruthy();
  }
  // Other markets are untouched.
  expect(p.banners['BANNER2-300x250'].aiLayout ?? null).toBeNull();
});

test('copy that cannot fit gets a Qwen suggestion that is approved for one size only', async ({
  page,
}) => {
  const calls = [];
  await mockModels(page, calls);
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await page
    .getByLabel('Headline', { exact: true })
    .fill('PLAY EVERY SINGLE MATCH OF THE SEASON YOUR WAY WITH BRANDX THIS WEEKEND AND MORE');
  await saved(page);
  const section = page.locator('.studio-copy-fit');
  await expect(section).toContainText('too long');
  const row = section.locator('.copy-fit-row', { hasText: '300x50 · Headline' });
  await row.getByRole('button', { name: 'Suggest shorter copy' }).click();
  await row.getByRole('button', { name: 'MATCH DAY' }).click();
  await saved(page);
  const p = await project(page);
  expect(p.campaigns.BANNER1.copyFits['300x50'].headline).toBe('MATCH DAY');
  expect(p.campaigns.BANNER1.headline).toContain('PLAY EVERY SINGLE MATCH');
  await expect
    .poll(async () => {
      const current = await project(page);
      const layer = current.banners['BANNER1-300x50'].arrangement?.layers.find(
        (l) => l.source === 'headline',
      );
      return layer?.textOverride;
    })
    .toBe('MATCH DAY');
  const other = (await project(page)).banners['BANNER1-300x250'].arrangement?.layers.find(
    (l) => l.source === 'headline',
  );
  expect(other?.textOverride ?? null).toBeNull();
  expect(calls).toContain('shorten');
});
