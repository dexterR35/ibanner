import { test, expect } from '@playwright/test';

// HTTP fixtures verify adapter/UI behavior. Actual Florence-2 needs local model weights.
const health = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  ready: true,
  state: 'available',
  loaded: false,
  device: 'test fixture',
  issues: [],
};
const result = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  detections: [
    { label: 'human face', score: 0.9, box: { xmin: 0.3, ymin: 0.5, xmax: 0.6, ymax: 0.65 } },
  ],
};
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());

test('legacy browser preference and caches retire without changing original assets or blueprints', async ({
  page,
}) => {
  const retiredRequests = [];
  page.on('request', (request) => {
    if (/owlvit|subject-detector|vendor\/onnx/.test(request.url()))
      retiredRequests.push(request.url());
  });
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/subjects/detect?*', (route) => route.fulfill({ json: result }));
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await page.evaluate(async () => {
    const { loadProject, saveProject, storeAsset } = await import('/src/core/storage.js');
    const p = await loadProject();
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 30;
    canvas.getContext('2d').fillRect(0, 0, 40, 30);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const asset = await storeAsset(
      new File([blob], 'legacy-source.png', { type: 'image/png' }),
      'hero',
    );
    p.assets.push(asset);
    Object.assign(p.campaigns.BANNER1, {
      heroAssetId: asset.id,
      subjectEngine: 'browser',
      autoSubject: false,
      subjectSearch: {
        assetId: asset.id,
        query: 'person',
        results: [],
        engine: 'browser',
        preference: 'browser',
      },
    });
    await saveProject(p);
    await (
      await caches.open('bannerflow-owlvit-old')
    ).put('/vendor/models/owlvit-base-patch32-ONNX/config.json', new Response('{}'));
    const cache = await caches.open('transformers-cache');
    await cache.put(
      '/vendor/models/owlvit-base-patch32-ONNX/onnx/model_quantized.onnx',
      new Response('old weights'),
    );
    await cache.put('/references/preserved.png', new Response('original'));
    return {
      assets: p.assets,
      blueprints: p.blueprints,
      search: p.campaigns.BANNER1.subjectSearch,
    };
  });
  await page.reload();
  await saved(page);
  const after = await project(page);
  expect(after.campaigns.BANNER1.subjectEngine).toBe('florence');
  expect(after.campaigns.BANNER1.subjectSearch).toEqual(before.search);
  expect(after.assets).toEqual(before.assets);
  expect(after.blueprints).toEqual(before.blueprints);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('transformers-cache');
        return {
          retired:
            (await caches.keys()).some((name) => name.startsWith('bannerflow-owlvit-')) ||
            !!(await cache.match(
              '/vendor/models/owlvit-base-patch32-ONNX/onnx/model_quantized.onnx',
            )),
          original: await (await cache.match('/references/preserved.png')).text(),
        };
      }),
    )
    .toEqual({ retired: false, original: 'original' });
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await expect(page.locator('.subject-results button')).toHaveCount(1);
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectSearch.engine).toBe('florence');
  expect(retiredRequests).toEqual([]);
});
test('busy Florence-2 waits for the service and can cancel the queued search', async ({ page }) => {
  let posts = 0,
    busyUntil = 0;
  await page.route('**/api/subjects/health', (route) =>
    route.fulfill({
      json: {
        ...health,
        state: Date.now() < busyUntil ? 'busy' : 'ready',
      },
    }),
  );
  await page.route('**/api/subjects/detect?*', (route) => {
    posts++;
    if (posts === 2) return route.fulfill({ json: result });
    busyUntil = Date.now() + (posts === 1 ? 1500 : 60_000);
    return route.fulfill({ status: 429, json: { detail: 'Another image is processing.' } });
  });
  await page.goto('/');
  await saved(page);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText(
    'Waiting for your turn',
  );
  await expect(page.locator('.subject-results button')).toHaveCount(1);
  expect(posts).toBe(2);
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await expect(page.locator('.subject-panel [role="status"]')).toContainText(
    'Waiting for your turn',
  );
  await page.locator('.subject-preview').click({ position: { x: 50, y: 50 } });
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectFocus.source).toBe('manual');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText('Manual focus');
  // An aborted queue must not resume after the service becomes idle.
  busyUntil = 0;
  await page.getByLabel('Campaign name', { exact: true }).fill('Cancelled queued search');
  await saved(page);
  await page.reload();
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectFocus.source).toBe('manual');
  expect(posts).toBe(3);
});

test('automatic Florence-2 adapter positions uploads and persists provider with the focus', async ({
  page,
}, testInfo) => {
  let searches = 0;
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/subjects/detect?*', (route) => {
    searches++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['content-type']).toBe('image/png');
    expect(route.request().postDataBuffer().length).toBeGreaterThan(100);
    return route.fulfill({ json: result });
  });
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await expect(page.getByLabel('Subject finder', { exact: true })).toHaveCount(0);
  await expect(page.locator('.subject-panel')).not.toContainText('Browser AI');
  const before = await project(page);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText(
    'Subject placed across all formats for BANNER1',
  );
  await saved(page);
  const after = await project(page);
  expect(after.campaigns.BANNER1.subjectSearch.engine).toBe('florence');
  expect(after.campaigns.BANNER1.subjectSearch.preference).toBe('florence');
  expect(after.campaigns.BANNER1.subjectFocus.label).toBe('human face');
  expect(after.banners['BANNER1-300x250'].arrangement).toBeTruthy();
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);
  await page.reload();
  await saved(page);
  await expect(page.getByRole('button', { name: 'Focus human face 1' })).toBeVisible();
  expect((await project(page)).campaigns.BANNER1.subjectSearch).toEqual(
    after.campaigns.BANNER1.subjectSearch,
  );
  expect(searches).toBe(1);
  await page
    .locator('.subject-panel')
    .screenshot({ path: testInfo.outputPath('sam3-connected-fixture.png') });
});

test('unavailable Florence-2 exposes setup errors and keeps manual focus available', async ({
  page,
}, testInfo) => {
  await page.route('**/api/subjects/health', (route) =>
    route.fulfill({
      json: {
        ...health,
        ready: false,
        state: 'needs_setup',
        backend: 'transformers',
        device: 'CPU',
        note: 'CPU mode is supported. Searches may be slow.',
        issues: [
          {
            code: 'checkpoint_missing',
            message: 'Download the Florence-2 model files with npm run florence:download.',
          },
        ],
      },
    }),
  );
  await page.route('**/api/subjects/detect?*', () => {
    throw new Error('Unavailable service must not receive images');
  });
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText(
    'Florence-2 unavailable',
  );
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectSearch).toBeFalsy();
  await expect(page.locator('.subject-panel [role="status"]')).toContainText(
    'Florence-2 unavailable',
  );
  await page.locator('.subject-service summary').click();
  await expect(
    page.getByText('Download the Florence-2 model files with npm run florence:download.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('CPU mode is supported. Searches may be slow.')).toBeVisible();
  await page.locator('.subject-preview').click({ position: { x: 50, y: 50 } });
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectFocus.source).toBe('manual');
  await page
    .locator('.subject-panel')
    .screenshot({ path: testInfo.outputPath('sam3-needs-setup.png') });
});

test('malformed Florence-2 responses report errors; valid empty results remain Florence-2 results', async ({
  page,
}) => {
  let malformed = true;
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/subjects/detect?*', (route) =>
    route.fulfill({
      json: malformed
        ? { ...result, detections: [{ ...result.detections[0], score: 9 }] }
        : { ...result, detections: [] },
    }),
  );
  await page.goto('/');
  await saved(page);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.locator('.subject-panel [role="status"]')).toContainText(
    'Florence-2 unavailable',
  );
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectSearch).toBeFalsy();
  malformed = false;
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await expect(page.locator('.subject-panel [role="status"]')).toContainText('No confident match');
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.subjectSearch.engine).toBe('florence');
});

test('changing images cancels a pending Florence-2 search and cannot apply its late result', async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/subjects/detect?*', async (route) => {
    await pending;
    await route.fulfill({ json: result }).catch(() => {});
  });
  await page.goto('/');
  await saved(page);
  const started = page.waitForRequest('**/api/subjects/detect?*');
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await started;
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click();
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-160x600.png');
  release();
  await expect(page.getByRole('button', { name: 'Find subject', exact: true })).toBeEnabled();
  await saved(page);
  const c = (await project(page)).campaigns.BANNER1;
  expect(c.subjectFocus).toBeNull();
  expect(c.subjectSearch).toBeNull();
});
