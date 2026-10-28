import { setAutoArrange } from './helpers/campaign.js';
import { test, expect } from '@playwright/test';

const health = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  ready: true,
  state: 'available',
  loaded: true,
  device: 'fixture',
  issues: [],
};
const result = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  detections: [
    { label: 'human face', score: 0.9, box: { xmin: 0.65, ymin: 0.1, xmax: 0.8, ymax: 0.25 } },
  ],
};
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const progress = (page) =>
  page.getByRole('progressbar', { name: 'Automatic subject placement', exact: true });
async function setup(page) {
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.goto('/campaign?market=BANNER2');
  await saved(page);
  await page.getByLabel('Auto find subject on upload').uncheck();
  await setAutoArrange(page, false);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(
    page.getByText('photo-300x600.png added. Original preserved.', { exact: true }),
  ).toBeVisible();
  await saved(page);
}
async function locked(page) {
  await expect(progress(page)).toBeVisible();
  await expect(page.locator('.studio-toolbar [role="progressbar"]')).toHaveCount(0);
  const canvas = await page.getByRole('region', { name: 'Campaign artboard canvas' }).boundingBox();
  const loader = await page.locator('.artboard-overlay .subject-placement-status').boundingBox();
  expect(Math.abs(loader.x + loader.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(1);
  expect(Math.abs(loader.y + loader.height / 2 - (canvas.y + canvas.height / 2))).toBeLessThan(1);
  expect(await progress(page).getAttribute('aria-valuenow')).toBeNull();
  await expect(
    page.getByRole('button', { name: 'Edit banner 300x250', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export 300x250', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Match blueprints', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add size', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Headline', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Subject finder', { exact: true })).toHaveCount(0);
  await expect(page.locator('.upload-zone input')).toBeDisabled();
  await expect(page.getByLabel('Import project file', { exact: true })).toBeDisabled();
  await expect(page.locator('.campaign-fields')).toHaveAttribute('inert', '');
  await expect(page.locator('.subject-panel button[type="submit"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancel search', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pan canvas', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Fit all artboards', exact: true })).toBeDisabled();
}
async function unlocked(page) {
  await expect(progress(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Edit banner 300x250', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Headline', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Find subject', exact: true })).toBeEnabled();
}

test('Auto place selects Florence-2 first, locks editing until completion and freezes canvas controls', async ({
  page,
}, testInfo) => {
  let release,
    requests = 0;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/subjects/detect?*', async (route) => {
    requests++;
    await pending;
    await route.fulfill({ json: result });
  });
  await setup(page);
  const before = await project(page),
    started = page.waitForRequest('**/api/subjects/detect?*');
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await started;
  await locked(page);
  await expect(page.locator('.artboard-overlay [role="status"]')).toHaveText('Loading Florence-2…');
  await expect(progress(page)).toHaveAttribute(
    'aria-valuetext',
    'Finding subjects with Florence-2…',
  );
  const world = page.locator('.artboard-grid');
  const beforeCamera = await world.getAttribute('style');
  const canvas = page.getByRole('region', { name: 'Campaign artboard canvas' });
  await canvas.hover();
  await page.mouse.wheel(0, 900);
  await canvas.focus();
  await canvas.press('ArrowDown');
  await canvas.press('+');
  expect(await world.getAttribute('style')).toBe(beforeCamera);
  await saved(page);
  expect((await project(page)).banners).toEqual(before.banners);
  await page.screenshot({ path: testInfo.outputPath('subject-placement-loading-desktop.png') });
  await page.getByRole('button', { name: 'Blueprint library 8', exact: true }).click();
  await expect(progress(page)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit blueprint 300x250', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'View blueprint 300x250', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit in Studio', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Campaign studio', exact: true }).click();
  await locked(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(progress(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('subject-placement-loading-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  release();
  await expect(page.locator('.studio-subject-status')).toContainText(
    'Subject placed across all formats',
  );
  await unlocked(page);
  await saved(page);
  expect((await project(page)).campaigns.BANNER2.subjectEngine).toBe('florence');
  expect((await project(page)).campaigns.BANNER2.subjectSearch.engine).toBe('florence');
  expect((await project(page)).blueprints).toEqual(before.blueprints);
  await page.reload();
  await saved(page);
  expect(requests).toBe(1);
});

test('a Florence-2 failure unlocks editing, preserves banners and never starts browser inference', async ({
  page,
}) => {
  const retiredRequests = [];
  page.on('request', (r) => {
    if (/owlvit|subject-detector|vendor\/onnx/i.test(r.url())) retiredRequests.push(r.url());
  });
  await page.route('**/api/subjects/detect?*', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Fixture service unavailable' } }),
  );
  await setup(page);
  const before = await project(page);
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect(page.locator('.studio-subject-status')).toContainText('Florence-2 unavailable');
  await unlocked(page);
  await saved(page);
  expect((await project(page)).banners).toEqual(before.banners);
  expect((await project(page)).campaigns.BANNER2.subjectFocus).toEqual(
    before.campaigns.BANNER2.subjectFocus,
  );
  expect(retiredRequests).toEqual([]);
});

test('an empty Florence-2 result preserves manual focus and unlocks editing', async ({ page }) => {
  await page.route('**/api/subjects/detect?*', (route) =>
    route.fulfill({ json: { ...result, detections: [] } }),
  );
  await setup(page);
  await page.locator('.subject-preview').click({ position: { x: 50, y: 50 } });
  await saved(page);
  const before = await project(page);
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect(page.locator('.studio-subject-status')).toContainText('No confident match');
  await unlocked(page);
  await saved(page);
  expect((await project(page)).campaigns.BANNER2.subjectFocus).toEqual(
    before.campaigns.BANNER2.subjectFocus,
  );
  expect((await project(page)).campaigns.BANNER2.subjectSearch.engine).toBe('florence');
});

test('browser history cannot reopen an editable banner during placement; cancelling unlocks it', async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/api/subjects/detect?*', async (route) => {
    await pending;
    await route.fulfill({ json: result }).catch(() => {});
  });
  await setup(page);
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await page.getByRole('button', { name: 'Back to formats', exact: true }).click();
  const before = await project(page),
    started = page.waitForRequest('**/api/subjects/detect?*');
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await started;
  await page.goBack();
  await expect(page).toHaveURL(/\/campaign\/BANNER2-300x250\/edit\?market=BANNER2$/);
  await expect(progress(page)).toBeVisible();
  await expect(page.locator('.editor')).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Save banner', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to formats', exact: true }).click();
  await saved(page);
  expect((await project(page)).banners).toEqual(before.banners);
  expect((await project(page)).campaigns.BANNER2.subjectFocus).toEqual(
    before.campaigns.BANNER2.subjectFocus,
  );
});

test('upload automatically shows the centered loader, locks the canvas, and places only its market; re-upload retries', async ({
  page,
}, testInfo) => {
  let releases = [],
    searches = 0;
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/subjects/detect?*', async (route) => {
    searches++;
    await new Promise((resolve) => releases.push(resolve));
    await route.fulfill({ json: result });
  });
  await page.goto('/campaign?market=BANNER2');
  await saved(page);
  await setAutoArrange(page, false);
  await saved(page);
  const before = await project(page);
  for (let upload = 0; upload < 2; upload++) {
    const started = page.waitForRequest('**/api/subjects/detect?*');
    await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
    await started;
    await locked(page);
    await expect(page.getByRole('region', { name: 'Campaign artboard canvas' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    if (!upload)
      await page.screenshot({ path: testInfo.outputPath('upload-placement-loading.png') });
    releases.shift()();
    await unlocked(page);
    await saved(page);
    const after = await project(page);
    expect(after.campaigns.BANNER2.subjectFocus.label).toBe('human face');
    expect(after.campaigns.BANNER1).toEqual(before.campaigns.BANNER1);
    expect(after.blueprints).toEqual(before.blueprints);
    for (const entry of after.blueprints) {
      if (entry.marketId === 'BANNER2') expect(after.banners[entry.id].arrangement).toBeTruthy();
      else expect(after.banners[entry.id]).toEqual(before.banners[entry.id]);
    }
  }
  expect(searches).toBe(2);
});
