import { test, expect } from '@playwright/test';
import { bindFixtureHero } from './helpers/fixtures.js';
import { readFile } from 'node:fs/promises';

const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
async function banner(page, id = 'BANNER1-300x250') {
  return page.evaluate(async (id) => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    return (await import('/src/data/defaults.js')).resolveBanner(
      p.blueprints.find((e) => e.id === id),
      p.banners[id],
    );
  }, id);
}
async function select(page, size = '300x250') {
  await page.getByRole('button', { name: 'Fit all artboards', exact: true }).click();
  await page.getByRole('button', { name: `Select banner ${size}`, exact: true }).click();
  await expect(
    page.getByRole('complementary', { name: 'Selected banner properties' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Banner editing canvas' })).toBeVisible();
}
const layer = (bp, id) => bp.layers.find((l) => l.id === id);
const inspector = (page) => page.getByRole('complementary', { name: 'Selected banner properties' });
const camera = (page) => page.locator('.artboard-grid').getAttribute('style');

test('select and edit text directly in Studio, drag with undo, auto-save only that banner and export matching pixels', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await project(page);
  await select(page);
  await expect(page).toHaveURL(/\/campaign\?market=BANNER1$/);
  const selected = await banner(page),
    headline = layer(selected, 'headline');
  const artwork = await page.locator('.editor-artwork').boundingBox(),
    scale = artwork.width / selected.width;
  await page.mouse.click(
    artwork.x + (headline.x + headline.width / 2) * scale,
    artwork.y + (headline.y + headline.height / 2) * scale,
  );
  await expect(inspector(page).getByLabel('Layer name', { exact: true })).toHaveCount(0);
  await expect(
    inspector(page).getByLabel('Text / rows for this format', { exact: true }),
  ).toBeVisible();
  await inspector(page)
    .getByLabel('Text / rows for this format', { exact: true })
    .fill('ONLY THIS BANNER');
  await saved(page);
  const written = await banner(page);
  expect(layer(written, 'headline').textOverride).toBe('ONLY THIS BANNER');
  const h = layer(written, 'headline'),
    b = await page.locator('.editor-artwork').boundingBox(),
    z = b.width / written.width;
  const start = { x: b.x + (h.x + h.width / 2) * z, y: b.y + (h.y + h.height / 2) * z };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12 * z, start.y + 8 * z, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  expect(layer(await banner(page), 'headline').x).toBe(h.x + 12);
  expect(layer(await banner(page), 'headline').y).toBe(h.y + 8);
  await inspector(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect(layer(await banner(page), 'headline')).toEqual(h);
  await inspector(page).getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  const after = await project(page);
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.campaigns).toEqual(before.campaigns);
  for (const [id, record] of Object.entries(before.banners))
    if (id !== 'BANNER1-300x250') expect(after.banners[id]).toEqual(record);
  await page.screenshot({ path: testInfo.outputPath('studio-inline-text.png') });
  await inspector(page).getByRole('button', { name: 'Deselect banner', exact: true }).click();
  await page.getByRole('button', { name: 'Fit all artboards', exact: true }).click();
  const card = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Select banner 300x250', exact: true }) });
  const pixels = await card.locator('canvas').evaluate((c) => c.toDataURL());
  const downloading = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  const file = await downloading;
  expect(`data:image/png;base64,${(await readFile(await file.path())).toString('base64')}`).toBe(
    pixels,
  );
  await page.reload();
  await saved(page);
  await select(page);
  await inspector(page).getByRole('button', { name: 'Headline', exact: true }).click();
  await expect(inspector(page).getByLabel('Text / rows for this format')).toHaveValue(
    'ONLY THIS BANNER',
  );
  expect(errors).toEqual([]);
});

test('inline image panning keeps its mask; tool switching pans the view and banner switching preserves local edits', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await bindFixtureHero(page, ['BANNER1']);
  await saved(page);
  await select(page);
  await inspector(page).getByRole('button', { name: 'Campaign image', exact: true }).click();
  await inspector(page).getByRole('slider', { name: /^Zoom/ }).press('End');
  await saved(page);
  const bp = await banner(page),
    original = layer(bp, 'hero');
  const b = await page.locator('.editor-artwork').boundingBox(),
    z = b.width / bp.width;
  const point = {
    x: b.x + (original.x + original.width / 2) * z,
    y: b.y + (original.y + original.height * 0.7) * z,
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 24, point.y + 18, { steps: 6 });
  await page.mouse.up();
  await saved(page);
  const moved = layer(await banner(page), 'hero');
  expect(moved.focalX).toBeLessThan(original.focalX);
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'fade'])
    expect(moved[key]).toEqual(original[key]);
  const beforePan = await project(page),
    view = await camera(page);
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - 70, point.y - 35, { steps: 6 });
  await page.mouse.up();
  expect(await camera(page)).not.toBe(view);
  expect(await project(page)).toEqual(beforePan);
  await page.getByRole('button', { name: 'Select artboards', exact: true }).click();
  await select(page, '300x600');
  await expect(inspector(page)).toContainText('BANNER1 · 300 × 600');
  await expect(page.locator('.studio-inline-timeline')).toBeEmpty();
  await inspector(page).getByRole('button', { name: 'Call to action', exact: true }).click();
  await inspector(page).getByLabel('Text / rows for this format').fill('LOCAL CTA');
  await saved(page);
  expect(layer(await banner(page, 'BANNER1-300x600'), 'cta').textOverride).toBe('LOCAL CTA');
  expect(layer(await banner(page), 'hero')).toEqual(moved);
  await page.screenshot({ path: testInfo.outputPath('studio-inline-portrait.png') });
  await select(page);
  expect(layer(await banner(page), 'hero')).toEqual(moved);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(inspector(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('studio-inline-mobile.png') });
});

test('GIF timing is edited in Studio and disappears for a static banner', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await select(page);
  await expect(page.locator('.studio-inline-timeline')).toBeEmpty();
  await inspector(page).getByLabel('Create GIF', { exact: true }).check();
  await expect(page.locator('.studio-inline-timeline .timeline')).toBeVisible();
  await page.getByRole('button', { name: 'Add part', exact: true }).click();
  await page.getByLabel('Part name', { exact: true }).fill('Closing');
  await page.getByLabel('Duration (ms)', { exact: true }).fill('2400');
  await saved(page);
  expect((await banner(page)).scenes.at(-1).durationMs).toBe(2400);
  await page.screenshot({ path: testInfo.outputPath('studio-inline-gif.png') });
  await inspector(page).getByLabel('Create GIF', { exact: true }).uncheck();
  await saved(page);
  await expect(page.locator('.studio-inline-timeline')).toBeEmpty();
  expect((await banner(page)).scenes.at(-1).name).toBe('Closing');
});

test('placement locks the inline inspector and canvas, then restores the selected banner with its local copy', async ({
  page,
}, testInfo) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
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
    await pending;
    await route.fulfill({
      json: {
        service: 'bannerflow-sam3',
        schemaVersion: 1,
        engine: 'florence',
        detections: [
          { label: 'person', score: 0.9, box: { xmin: 0.4, ymin: 0.3, xmax: 0.7, ymax: 0.8 } },
        ],
      },
    });
  });
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeEnabled();
  await select(page);
  await inspector(page).getByRole('button', { name: 'Headline', exact: true }).click();
  await inspector(page).getByLabel('Text / rows for this format').fill('KEEP LOCAL WORDS');
  await saved(page);
  const before = await project(page);
  const beforeCamera = await camera(page);
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Automatic subject placement', exact: true }),
  ).toBeVisible();
  await expect(inspector(page).locator('textarea')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pan canvas', exact: true })).toBeDisabled();
  const surface = page.getByRole('region', { name: 'Banner editing canvas' });
  await expect(surface).toHaveCSS('pointer-events', 'none');
  await page.screenshot({ path: testInfo.outputPath('studio-inline-loading.png') });
  expect(await camera(page)).toBe(beforeCamera);
  release();
  await expect(
    page.getByRole('progressbar', { name: 'Automatic subject placement', exact: true }),
  ).toHaveCount(0);
  await expect(inspector(page).getByLabel('Text / rows for this format')).toBeEnabled();
  await expect(inspector(page).getByLabel('Text / rows for this format')).toHaveValue(
    'KEEP LOCAL WORDS',
  );
  await saved(page);
  const after = await project(page);
  expect(after.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);
  expect(after.blueprints).toEqual(before.blueprints);
  await inspector(page).getByRole('button', { name: 'Deselect banner', exact: true }).click();
  await page.getByRole('button', { name: 'Banner 2', exact: true }).click();
  await expect(inspector(page)).toHaveCount(0);
  await expect(page.locator('.studio-inline-timeline')).toBeEmpty();
});

test('artboard titles move whole boards without changing artwork and reset restores the arrangement', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await project(page);
  const title = page.getByRole('button', { name: 'Move artboard 300x250', exact: true });
  const point = await title.boundingBox();
  const board = page.getByRole('article', { name: '300 by 250 artboard' });
  const original = await board.boundingBox();
  await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x + point.width / 2 + 70, point.y + point.height / 2 + 40, {
    steps: 6,
  });
  await page.mouse.up();
  const moved = await board.boundingBox();
  expect(moved.x - original.x).toBeCloseTo(70, 0);
  expect(moved.y - original.y).toBeCloseTo(40, 0);
  expect(await project(page)).toEqual(before);
  await page.getByRole('button', { name: 'Reset artboard positions', exact: true }).click();
  expect((await board.boundingBox()).x).toBeCloseTo(original.x, 0);
  expect((await board.boundingBox()).y).toBeCloseTo(original.y, 0);
  await title.click();
  await expect(inspector(page)).toContainText('BANNER1 · 300 × 250');
  await expect(page).toHaveURL(/\/campaign\?market=BANNER1$/);
});

test('inline rotation and resize handles use screen coordinates correctly at Studio zoom', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await select(page);
  await inspector(page).getByRole('button', { name: 'Logo', exact: true }).click();
  const bp = await banner(page),
    original = layer(bp, 'logo');
  const box = await page.locator('.editor-artwork').boundingBox(),
    zoom = box.width / bp.width;
  expect(zoom).toBeGreaterThan(1);
  const center = {
    x: box.x + (original.x + original.width / 2) * zoom,
    y: box.y + (original.y + original.height / 2) * zoom,
  };
  const top = { x: center.x, y: box.y + original.y * zoom - 32 };
  await page.mouse.move(top.x, top.y);
  await page.mouse.down();
  await page.mouse.move(center.x + (original.height * zoom) / 2 + 32, center.y, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  expect(layer(await banner(page), 'logo').rotation).toBe(90);
  await inspector(page).getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect(layer(await banner(page), 'logo')).toEqual(original);
  const edge = { x: box.x + (original.x + original.width) * zoom, y: center.y };
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edge.x + 20 * zoom, edge.y, { steps: 8 });
  await page.mouse.up();
  await saved(page);
  expect(layer(await banner(page), 'logo').width).toBe(original.width + 20);
  await page.screenshot({ path: testInfo.outputPath('studio-inline-handles.png') });
});
