import { offlineAI, setAutoArrange } from './helpers/campaign.js';
import { bindFixtureHero } from './helpers/fixtures.js';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => offlineAI(page));

const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const health = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  ready: true,
  state: 'available',
  loaded: false,
  device: 'fixture',
  issues: [],
};
const result = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  detections: [
    { label: 'playing card', score: 0.9, box: { xmin: 0.7, ymin: 0.2, xmax: 0.9, ymax: 0.4 } },
  ],
};

test('Studio camera zooms and pans, fits all sizes, and opens artboards without modifying banner data', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/campaign?market=BANNER2');
  await saved(page);
  await expect(page.locator('.page-heading, .campaign-meta')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Auto place subject', exact: true }),
  ).toBeDisabled();
  const before = await project(page);
  const viewport = page.getByRole('region', { name: 'Campaign artboard canvas' });
  const world = page.locator('.artboard-grid');
  const banner = page.getByRole('button', { name: 'Select banner 300x250', exact: true });
  const initial = await banner.boundingBox();
  expect(initial.height).toBeGreaterThan(100);
  await expect(page.locator('.studio-toolbar .auto-subject-action')).toHaveCount(0);
  const top = await viewport.boundingBox(),
    action = await page.locator('.canvas-floating-actions').boundingBox();
  expect(Math.abs(action.x + action.width / 2 - (top.x + top.width / 2))).toBeLessThan(2);
  expect(action.y - top.y).toBeCloseTo(16, 1);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect((await banner.boundingBox()).width / initial.width).toBeCloseTo(1.2, 2);
  expect(await page.locator('.canvas-floating-actions').boundingBox()).toEqual(action);
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  expect((await banner.boundingBox()).width).toBeCloseTo(initial.width, 1);
  await page.getByRole('button', { name: /reset to 100%/ }).click();
  expect((await banner.boundingBox()).width).toBeCloseTo(300, 1);
  await page.getByRole('button', { name: 'Fit all artboards', exact: true }).click();
  const matrix = () =>
    world.evaluate((el) => {
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return { x: m.e, y: m.f, zoom: m.a };
    });
  await page.getByRole('button', { name: /reset to 100%/ }).click();
  const originalCamera = await matrix();
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  const rect = await viewport.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + 35, { steps: 5 });
  await page.mouse.up();
  await expect(page).toHaveURL(/\/campaign\?market=BANNER2$/);
  const panned = await matrix();
  expect(panned.x - originalCamera.x).toBeCloseTo(60, 1);
  expect(panned.y - originalCamera.y).toBeCloseTo(35, 1);
  expect(await page.locator('.canvas-floating-actions').boundingBox()).toEqual(action);
  await viewport.hover();
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -40);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await matrix()).zoom).toBeGreaterThan(panned.zoom);
  await page.getByRole('button', { name: 'Fit all artboards', exact: true }).click();
  await page.getByRole('button', { name: 'Select artboards', exact: true }).click();
  await saved(page);
  expect(await project(page)).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('studio-artboard-desktop.png') });
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit banner BANNER2 / 300 × 250' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to formats', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find a format', exact: true }).fill('728');
  await expect(page.locator('.banner-artboard')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear format search', exact: true }).click();
  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole('button', { name: 'Fit all artboards', exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const bounds = await viewport.boundingBox();
    const floatingAction = await page.locator('.canvas-floating-actions').boundingBox();
    expect(
      Math.abs(floatingAction.x + floatingAction.width / 2 - (bounds.x + bounds.width / 2)),
    ).toBeLessThan(2);
    expect(floatingAction.y - bounds.y).toBeCloseTo(16, 1);
    const rail = await page.locator('.canvas-tool-rail').boundingBox();
    expect(rail.y).toBeGreaterThan(floatingAction.y + floatingAction.height);
    for (const control of await page.locator('.canvas-campaign-actions > *').all()) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(bounds.x);
      expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    expect(bounds.height).toBeGreaterThan(200);
    for (const art of await page.locator('.artboard-preview').all()) {
      const b = await art.boundingBox();
      expect(b.x).toBeGreaterThanOrEqual(bounds.x);
      expect(b.x + b.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
    }
    await page.screenshot({ path: testInfo.outputPath(`studio-artboard-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('canvas actions persist per market and Arrange now has one click target', async ({ page }) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await bindFixtureHero(page, ['BANNER1']);
  const arrange = page.getByRole('button', { name: 'Arrange now', exact: true });
  const auto = page.getByRole('button', { name: 'Automatic arrangement', exact: true });
  const automatic = page.getByLabel('Auto arrange', { exact: true });
  const blueprint = page.getByRole('button', { name: 'Match blueprints', exact: true });
  await expect(arrange).toBeEnabled();
  await saved(page);
  const before = await project(page);
  await expect(page.locator('.canvas-campaign-actions input[type=checkbox]')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'BANNER1 canvas actions' })).toBeVisible();
  await setAutoArrange(page, false);
  await page.getByLabel('Headline', { exact: true }).fill('A MARKET SPECIFIC DIRECTION');
  await arrange.click();
  // Arrange now is a one-time action; the Auto toggle keeps its saved state.
  await expect(page.getByText(/formats arranged/)).toBeVisible({ timeout: 60000 });
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await saved(page);
  await expect(automatic).toHaveCount(0);
  expect((await project(page)).banners['BANNER1-300x250'].arrangement).toBeTruthy();
  await blueprint.click();
  await saved(page);
  const b1 = await project(page);
  expect(b1.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);
  expect(b1.banners['BANNER2-300x250']).toEqual(before.banners['BANNER2-300x250']);

  await page.getByRole('button', { name: 'Banner 2', exact: true }).click();
  await expect(page.getByRole('group', { name: 'BANNER2 canvas actions' })).toBeVisible();
  await expect(automatic).toHaveCount(0);
  await expect(blueprint).toHaveAttribute('aria-pressed', 'false');
  await blueprint.click();
  await setAutoArrange(page, false);
  await saved(page);
  const b2 = await project(page);
  expect(b2.campaigns.BANNER1).toEqual(b1.campaigns.BANNER1);
  expect(b2.banners['BANNER1-300x250']).toEqual(b1.banners['BANNER1-300x250']);

  await page.getByRole('button', { name: 'Banner 1', exact: true }).click();
  await page.reload();
  await expect(arrange).toBeEnabled();
  await expect(automatic).toHaveCount(0);
  await expect(blueprint).toHaveAttribute('aria-pressed', 'true');
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  const camera = await page.locator('.artboard-grid').getAttribute('style');
  await auto.focus();
  await auto.press('Space');
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await saved(page);
  await expect(automatic).toHaveCount(0);
  expect(await page.locator('.artboard-grid').getAttribute('style')).toEqual(camera);
  await blueprint.click();
  await page.getByRole('button', { name: 'Match blueprints', exact: true }).click();
  await expect(blueprint).toHaveAttribute('aria-pressed', 'true');
  await saved(page);
  expect((await project(page)).campaigns.BANNER2).toEqual(b2.campaigns.BANNER2);
});

test('top subject action applies crops with auto arrangement off; sidebar search stays manual and no-match keeps the layout', async ({
  page,
}) => {
  let noMatch = false,
    searches = 0;
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.route('**/api/subjects/detect?*', (route) => {
    searches++;
    return route.fulfill({ json: noMatch ? { ...result, detections: [] } : result });
  });
  await page.goto('/campaign?market=BANNER2');
  await saved(page);
  await page.getByLabel('Auto find subject on upload').uncheck();
  await setAutoArrange(page, false);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(
    page.getByText('photo-300x600.png added. Original preserved.', { exact: true }),
  ).toBeVisible();
  await saved(page);
  const before = await project(page);
  await page.getByLabel('Find in image', { exact: true }).fill('playing card');
  await page.getByRole('button', { name: 'Find subject', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Focus playing card 1', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.subject-panel [role="status"]')).toHaveCount(0);
  await saved(page);
  expect((await project(page)).banners).toEqual(before.banners);
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect(page.locator('.studio-subject-status')).toContainText(
    'Subject placed across all formats',
  );
  await saved(page);
  const after = await project(page);
  expect(after.campaigns.BANNER2.autoArrange).toBe(false);
  expect(after.campaigns.BANNER2.autoSubject).toBe(false);
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.campaigns.BANNER1).toEqual(before.campaigns.BANNER1);
  for (const e of after.blueprints) {
    if (e.marketId === 'BANNER2') expect(after.banners[e.id].arrangement).toBeTruthy();
    else expect(after.banners[e.id]).toEqual(before.banners[e.id]);
  }
  expect(after.assets).toEqual(before.assets);
  noMatch = true;
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect(page.locator('.studio-subject-status')).toContainText('No confident match');
  await saved(page);
  expect((await project(page)).banners).toEqual(after.banners);
  expect((await project(page)).campaigns.BANNER2.subjectFocus).toEqual(
    after.campaigns.BANNER2.subjectFocus,
  );
  await page.reload();
  await saved(page);
  expect((await project(page)).banners).toEqual(after.banners);
  expect(searches).toBe(3);
});

test('cancelling top subject placement discards late results and leaves manual focus available', async ({
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
  await page.goto('/campaign?market=BANNER2');
  await saved(page);
  await page.getByLabel('Auto find subject on upload').uncheck();
  await setAutoArrange(page, false);
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(
    page.getByText('photo-300x600.png added. Original preserved.', { exact: true }),
  ).toBeVisible();
  await saved(page);
  const before = await project(page);
  const started = page.waitForRequest('**/api/subjects/detect?*');
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Cancel search', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Auto place subject', exact: true })).toBeEnabled();
  await page.locator('.subject-preview').click({ position: { x: 50, y: 50 } });
  await saved(page);
  expect((await project(page)).campaigns.BANNER2.subjectFocus.source).toBe('manual');
  expect((await project(page)).banners).toEqual(before.banners);
});

test('wheel, keyboard and hand panning stop at the collection bounds, including after resizing and filtering', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const viewport = page.getByRole('region', { name: 'Campaign artboard canvas' });
  const bounds = () =>
    page.locator('.artboard-grid').evaluate((world) => {
      const parent = world.parentElement,
        m = new DOMMatrix(getComputedStyle(world).transform);
      return {
        x: m.e,
        y: m.f,
        zoom: m.a,
        width: world.offsetWidth,
        height: world.offsetHeight,
        vw: parent.clientWidth,
        vh: parent.clientHeight,
      };
    });
  const valid = async () => {
    const b = await bounds();
    expect(b.x).toBeGreaterThanOrEqual(Math.min(64, b.vw - b.width * b.zoom - 32) - 1);
    expect(b.x).toBeLessThanOrEqual(Math.max(64, b.vw - b.width * b.zoom - 32) + 1);
    expect(b.y).toBeGreaterThanOrEqual(Math.min(80, b.vh - b.height * b.zoom - 32) - 1);
    expect(b.y).toBeLessThanOrEqual(Math.max(80, b.vh - b.height * b.zoom - 32) + 1);
    return b;
  };
  await page.getByRole('button', { name: /reset to 100%/ }).click();
  await viewport.hover();
  await page.mouse.wheel(100000, 100000);
  await expect.poll(async () => (await bounds()).y).toBeLessThan(0);
  const end = await valid();
  await page.mouse.wheel(100000, 100000);
  await viewport.focus();
  await viewport.press('ArrowDown');
  await viewport.press('ArrowRight');
  expect(await valid()).toEqual(end);
  await page.mouse.wheel(-100000, -100000);
  await expect.poll(async () => (await bounds()).y).toBe(80);
  await viewport.press('ArrowUp');
  await viewport.press('ArrowLeft');
  const start = await valid();
  expect(start.x).toBe(64);
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  const v = await viewport.boundingBox();
  await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
  await page.mouse.down();
  await page.mouse.move(v.x + v.width - 10, v.y + v.height - 10, { steps: 5 });
  await page.mouse.up();
  expect(await valid()).toEqual(start);
  await page.setViewportSize({ width: 900, height: 844 });
  await valid();
  await page.getByRole('textbox', { name: 'Find a format', exact: true }).fill('300x250');
  await expect(page.locator('.banner-artboard')).toHaveCount(1);
  await viewport.hover();
  await page.mouse.wheel(100000, 100000);
  await viewport.focus();
  await viewport.press('ArrowDown');
  await valid();
});
