import { test, expect } from '@playwright/test';
import { bindFixtureHero } from './helpers/fixtures.js';
import { readFile } from 'node:fs/promises';

async function blueprint(page) {
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const bp = JSON.parse(await page.locator('.json-editor').inputValue());
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return bp;
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await bindFixtureHero(page, ['BANNER1']);
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Edit banner/ })).toBeVisible();
});

test('dragging the image keeps its mask fixed, makes one undo step and persists only in that banner', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reposition image', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('WIDTH', { exact: true })).toBeDisabled();
  await page.getByRole('slider', { name: /^Zoom/ }).press('End');
  const original = (await blueprint(page)).layers.find((l) => l.id === 'hero');
  const stage = page.locator('.konvajs-content');
  const box = await page.locator('.editor-artwork').boundingBox(),
    scale = box.width / 300;
  const start = {
    x: box.x + (original.x + original.width / 2) * scale,
    y: box.y + (original.y + original.height / 2) * scale,
  };
  const beforePixels = await stage
    .locator('canvas')
    .first()
    .evaluate((c) => c.toDataURL());
  async function drag() {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 60, start.y + 30, { steps: 8 });
    await page.mouse.up();
  }
  await drag();
  const moved = (await blueprint(page)).layers.find((l) => l.id === 'hero');
  expect(moved.focalX).toBeLessThan(original.focalX);
  expect(moved.focalY).toBeLessThan(original.focalY);
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'fade', 'fadeDirection', 'zoom'])
    expect(moved[key]).toEqual(original[key]);
  expect(
    await stage
      .locator('canvas')
      .first()
      .evaluate((c) => c.toDataURL()),
  ).not.toEqual(beforePixels);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await blueprint(page)).layers.find((l) => l.id === 'hero')).toEqual(original);
  await drag();
  await page.getByRole('button', { name: 'Save banner' }).click();
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  expect((await blueprint(page)).layers.find((l) => l.id === 'hero')).toEqual(moved);
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('image-reposition.png') });
  await page.getByRole('button', { name: 'Edit frame', exact: true }).click();
  await expect(page.getByLabel('WIDTH', { exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Back to formats' }).click();
  await page.getByRole('button', { name: 'Blueprint library 8' }).click();
  await page.getByRole('button', { name: 'View blueprint 300x250', exact: true }).click();
  const master = await page.evaluate(async () => {
    const { loadProject } = await import('/src/core/storage.js');
    const { activeRevision } = await import('/src/data/defaults.js');
    const entry = (await loadProject()).blueprints.find((entry) => entry.id === 'BANNER1-300x250');
    return activeRevision(entry).blueprint.layers.find((layer) => layer.id === 'hero');
  });
  expect(master.focalX).toBe(0.5);
  expect(master.focalY).toBe(0.5);
  expect(master.zoom).toBe(1);
});

test('glow switches off exactly, persists through reload and is present in exported pixels', async ({
  page,
}, testInfo) => {
  await expect(page.getByRole('checkbox', { name: 'Text glow', exact: true })).not.toBeChecked();
  const canvas = page.locator('.konvajs-content canvas').first();
  const before = await canvas.evaluate((c) => c.toDataURL());
  await page.getByRole('checkbox', { name: 'Text glow', exact: true }).check();
  await page.getByLabel('Glow radius (px)').fill('10');
  await expect(page.getByLabel('Glow color')).toHaveValue('#ff162d');
  const glowing = await canvas.evaluate((c) => c.toDataURL());
  expect(glowing).not.toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('text-glow.png') });
  await page.getByRole('checkbox', { name: 'Text glow', exact: true }).uncheck();
  expect(await canvas.evaluate((c) => c.toDataURL())).toEqual(before);
  await page.getByRole('checkbox', { name: 'Text glow', exact: true }).check();
  await page.getByRole('button', { name: 'Save banner' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  const card = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Edit banner 300x250', exact: true }) });
  await expect(card.getByRole('button', { name: 'Export 300x250' })).toBeEnabled();
  const preview = await card.locator('canvas').evaluate((c) => c.toDataURL());
  const wait = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export 300x250' }).click();
  const download = await wait,
    data = await readFile(await download.path());
  expect(`data:image/png;base64,${data.toString('base64')}`).toEqual(preview);
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Text glow', exact: true })).toBeChecked();
  await expect(page.getByLabel('Glow radius (px)')).toHaveValue('10');
});

test('glow extends beyond the text box and GIF rendering uses the same frame effect', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createBlueprint, campaignFor, DEFAULT_MARKETS } = await import('/src/data/defaults.js');
    const { renderFrame, canvasOf } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { loadResources } = await import('/src/core/storage.js');
    const bp = createBlueprint('BANNER1', 300, 250),
      campaign = campaignFor(DEFAULT_MARKETS[0]);
    bp.background = '#000000';
    const layer = bp.layers.find((l) => l.id === 'headline');
    Object.assign(layer, {
      x: 40,
      y: 50,
      width: 170,
      height: 42,
      fontSize: 40,
      minFontSize: 40,
      maxLines: 1,
      source: 'custom',
      text: 'GLOW',
      glow: { enabled: true, color: '#ff162d', blur: 12, opacity: 1 },
    });
    bp.layers = [layer];
    bp.scenes[0].tracks = {};
    const resources = await loadResources(campaign);
    const c = canvasOf(300, 250);
    renderFrame(c, bp, campaign, resources);
    const on = new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, 300, 250).data);
    const gif = await renderOutput(bp, campaign, resources, 'gif');
    const gifBytes = new Uint8Array(await gif.arrayBuffer());
    layer.glow.enabled = false;
    renderFrame(c, bp, campaign, resources);
    const off = c.getContext('2d').getImageData(0, 0, 300, 250).data;
    let outsideHalo = 0;
    for (let y = 40; y < 105; y++)
      for (let x = 25; x < 225; x++) {
        if (x >= 40 && x < 210 && y >= 50 && y < 92) continue;
        const i = (y * 300 + x) * 4;
        if (on[i] > off[i] + 3 && on[i] > on[i + 1] * 2) outsideHalo++;
      }
    // Decode the emitted GIF's first frame through the browser, then compare the red halo.
    const url = URL.createObjectURL(gif),
      image = new Image();
    image.src = url;
    await image.decode();
    const decoded = canvasOf(300, 250);
    decoded.getContext('2d').drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const pixels = decoded.getContext('2d').getImageData(0, 0, 300, 250).data;
    let gifHalo = 0;
    for (let y = 40; y < 50; y++)
      for (let x = 40; x < 210; x++) {
        const i = (y * 300 + x) * 4;
        if (pixels[i] > 3 && pixels[i] > pixels[i + 1] * 2) gifHalo++;
      }
    return { outsideHalo, gifHalo, gifHeader: String.fromCharCode(...gifBytes.slice(0, 6)) };
  });
  expect(result.outsideHalo).toBeGreaterThan(30);
  expect(result.gifHalo).toBeGreaterThan(10);
  expect(result.gifHeader).toBe('GIF89a');
});
