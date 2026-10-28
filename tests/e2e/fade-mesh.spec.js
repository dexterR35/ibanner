import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readBlueprint } from './helpers/editor.js';

const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
async function hero(page) {
  return page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    return (await import('/src/data/defaults.js'))
      .resolveBanner(
        p.blueprints.find((e) => e.id === 'BANNER1-300x250'),
        p.banners['BANNER1-300x250'],
      )
      .layers.find((l) => l.id === 'hero');
  });
}
async function selectImage(page) {
  await page.getByRole('button', { name: 'Select banner 300x250', exact: true }).click();
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
}

test('Studio edits 16 fade points with live feedback, one-step undo, fixed photo mask, persistence and exact PNG output', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await project(page);
  await selectImage(page);
  await page.getByRole('combobox', { name: 'Fade shape', exact: true }).selectOption('mesh');
  await saved(page);
  await expect(page.getByLabel('Fade points', { exact: true })).toHaveValue('16');
  const original = await hero(page),
    p = original.fadeMesh.points[7];
  const box = await page.locator('.editor-artwork').boundingBox(),
    z = box.width / 300;
  const x = box.x + (original.x + p.x * original.width) * z;
  const y = box.y + (original.y + p.y * original.height) * z;
  const stage = page.locator('.konvajs-content canvas').first();
  const pixels = await stage.evaluate((c) => c.toDataURL());
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 3 * z, y + 18 * z, { steps: 10 });
  expect(await stage.evaluate((c) => c.toDataURL())).not.toBe(pixels);
  await page.mouse.up();
  await saved(page);
  const moved = await hero(page);
  expect(moved.fadeMesh.points[7].y).toBeCloseTo(p.y + 18 / original.height, 2);
  expect(moved.fadeMesh.points[7].x).toBeCloseTo(p.x + 3 / original.width, 2);
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'focalX', 'focalY', 'zoom'])
    expect(moved[key]).toEqual(original[key]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(page);
  expect((await hero(page)).fadeMesh).toEqual(original.fadeMesh);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await saved(page);
  expect((await hero(page)).fadeMesh).toEqual(moved.fadeMesh);
  await page.screenshot({ path: testInfo.outputPath('studio-fade-16-points.png') });
  await page.getByRole('button', { name: 'Done editing fade', exact: true }).click();
  await page.getByRole('slider', { name: /^Zoom/ }).press('End');
  await saved(page);
  const image = await hero(page);
  await page.mouse.move(box.x + 80 * z, box.y + (image.y + image.height * 0.8) * z);
  await page.mouse.down();
  await page.mouse.move(box.x + 110 * z, box.y + (image.y + image.height * 0.8) * z, { steps: 5 });
  await page.mouse.up();
  await saved(page);
  expect((await hero(page)).fadeMesh).toEqual(moved.fadeMesh);
  const after = await project(page);
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.campaigns).toEqual(before.campaigns);
  for (const id of Object.keys(before.banners))
    if (id !== 'BANNER1-300x250') expect(after.banners[id]).toEqual(before.banners[id]);
  await page.reload();
  await saved(page);
  expect((await hero(page)).fadeMesh).toEqual(moved.fadeMesh);
  const card = page.getByRole('article', { name: '300 by 250 artboard', exact: true });
  const preview = await card.locator('canvas').evaluate((c) => c.toDataURL());
  const wait = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  expect(
    `data:image/png;base64,${(await readFile(await (await wait).path())).toString('base64')}`,
  ).toBe(preview);
  expect(errors).toEqual([]);
});

test('blueprint fade editor changes only the standard fade, retains old revisions and updates Studio automatically', async ({
  page,
}, testInfo) => {
  await page.goto('/blueprints/BANNER1-300x250?market=BANNER1');
  await saved(page);
  const before = await project(page),
    original = before.blueprints.find((e) => e.id === 'BANNER1-300x250');
  await page.getByRole('button', { name: 'Edit blueprint fade', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Fade shape', exact: true }).selectOption('mesh');
  await expect(dialog.getByRole('button', { name: /^Fade point \d+$/ })).toHaveCount(16);
  const point = dialog.getByRole('button', { name: 'Fade point 8', exact: true }),
    b = await point.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  await point.press('ArrowDown');
  await page.screenshot({ path: testInfo.outputPath('blueprint-fade-16-points.png') });
  await dialog.getByRole('button', { name: 'Save blueprint fade', exact: true }).click();
  await saved(page);
  const after = await project(page),
    entry = after.blueprints.find((e) => e.id === original.id),
    revision = entry.versions.at(-1);
  expect(entry.versions.length).toBe(original.versions.length + 1);
  expect(entry.versions.slice(0, -1)).toEqual(original.versions);
  for (const id of Object.keys(before.banners))
    if (id !== original.id) expect(after.banners[id]).toEqual(before.banners[id]);
  expect(after.banners[original.id].blueprintVersionId).toBe(entry.activeVersionId);
  expect(after.campaigns).toEqual(before.campaigns);
  expect(revision.blueprint.layers[0].fadeMesh.points[7].y).toBeGreaterThan(0.7);
  await expect(page.locator('.blueprint-reference-art .fade-mesh-diagram')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit blueprint fade', exact: true }).click();
  await dialog.getByRole('button', { name: 'Arch', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('blueprint-fade-mobile.png') });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1100 });
  expect(await project(page)).toEqual(after);
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await selectImage(page);

  expect((await hero(page)).fadeMesh).toEqual(revision.blueprint.layers[0].fadeMesh);
  await page.reload();
  await saved(page);
  expect((await hero(page)).fadeMesh).toEqual(revision.blueprint.layers[0].fadeMesh);
});

test('focused editor drags a side fade in a rotated frame without moving the image or frame', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign/BANNER1-300x250/edit?market=BANNER1');
  await expect(page.getByRole('heading', { name: /Edit banner/ })).toBeVisible();
  const bp = await readBlueprint(page);
  Object.assign(
    bp.layers.find((l) => l.id === 'hero'),
    { x: 20, y: 120, width: 180, height: 80, rotation: 15, fadeDirection: 'right' },
  );
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.locator('.json-editor').fill(JSON.stringify(bp));
  await page.getByRole('button', { name: 'Validate and apply', exact: true }).click();
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await page.getByRole('combobox', { name: 'Fade shape', exact: true }).selectOption('mesh');
  const original = (await readBlueprint(page)).layers.find((l) => l.id === 'hero'),
    p = original.fadeMesh.points[7];
  const box = await page.locator('.editor-artwork').boundingBox(),
    z = box.width / 300,
    angle = Math.PI / 12;
  const local = { x: (1 - p.y) * original.width, y: p.x * original.height };
  const start = {
    x: box.x + (original.x + local.x * Math.cos(angle) - local.y * Math.sin(angle)) * z,
    y: box.y + (original.y + local.x * Math.sin(angle) + local.y * Math.cos(angle)) * z,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 12 * Math.cos(angle) * z, start.y - 12 * Math.sin(angle) * z, {
    steps: 8,
  });
  await page.mouse.up();
  const moved = (await readBlueprint(page)).layers.find((l) => l.id === 'hero');
  expect(moved.fadeMesh.points[7].y).toBeCloseTo(p.y + 12 / original.width, 2);
  expect(moved.fadeMesh.points[7].x).toBeCloseTo(p.x, 2);
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'focalX', 'focalY', 'zoom'])
    expect(moved[key]).toEqual(original[key]);
  await page.screenshot({ path: testInfo.outputPath('focused-fade-rotated.png') });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await readBlueprint(page)).layers.find((l) => l.id === 'hero')).toEqual(original);
});

test('all fade directions use the same soft U boundary in PNG and GIF, and disabling mesh restores linear pixels', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const result = await page.evaluate(async () => {
    const { createBlueprint, campaignFor, DEFAULT_MARKETS } = await import('/src/data/defaults.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const { createFadeMesh, meshToLocal } = await import('/src/core/fade-mesh.js');
    const { renderOutput } = await import('/src/core/export.js');
    const bp = createBlueprint('BANNER1', 300, 250),
      campaign = campaignFor(DEFAULT_MARKETS[0]);
    const layer = {
      ...bp.layers[0],
      x: 0,
      y: 0,
      width: 300,
      height: 250,
      fade: 0.35,
      fadeDirection: 'top',
    };
    bp.background = '#000000';
    bp.layers = [layer];
    bp.scenes[0].tracks = {};
    const image = canvasOf(300, 250);
    image.getContext('2d').fillStyle = '#ffffff';
    image.getContext('2d').fillRect(0, 0, 300, 250);
    const resources = { hero: image },
      canvas = canvasOf(300, 250);
    renderFrame(canvas, bp, campaign, resources);
    const linear = canvas.toDataURL();
    layer.fadeMesh = createFadeMesh();
    const sample = (c, direction, point) => {
      const p = meshToLocal(point, { ...layer, fadeDirection: direction });
      return c
        .getContext('2d')
        .getImageData(Math.min(299, Math.round(p.x)), Math.min(249, Math.round(p.y)), 1, 1).data[0];
    };
    const directions = [];
    for (const direction of ['top', 'bottom', 'left', 'right']) {
      layer.fadeDirection = direction;
      renderFrame(canvas, bp, campaign, resources);
      directions.push([
        sample(canvas, direction, { x: 0.5, y: 0.35 }),
        sample(canvas, direction, { x: 0.03, y: 0.4 }),
        sample(canvas, direction, { x: 0.5, y: 0.59 }),
      ]);
    }
    layer.fadeDirection = 'top';
    renderFrame(canvas, bp, campaign, resources);
    const png = canvas.toDataURL();
    const gif = await renderOutput(bp, campaign, resources, 'gif'),
      url = URL.createObjectURL(gif),
      decoded = new Image();
    decoded.src = url;
    await decoded.decode();
    const c = canvasOf(300, 250);
    c.getContext('2d').drawImage(decoded, 0, 0);
    URL.revokeObjectURL(url);
    const gifSamples = [
      sample(c, 'top', { x: 0.5, y: 0.35 }),
      sample(c, 'top', { x: 0.03, y: 0.4 }),
      sample(c, 'top', { x: 0.5, y: 0.59 }),
    ];
    layer.fadeMesh.enabled = false;
    renderFrame(canvas, bp, campaign, resources);
    return {
      directions,
      gifSamples,
      restored: canvas.toDataURL() === linear,
      changed: png !== linear,
    };
  });
  await test.info().attach('fade-render-samples.json', {
    body: JSON.stringify(result),
    contentType: 'application/json',
  });
  for (const [dark, clear, transition] of result.directions) {
    expect(dark).toBeLessThan(5);
    expect(clear).toBeGreaterThan(250);
    expect(transition).toBeGreaterThan(80);
    expect(transition).toBeLessThan(180);
  }
  // GIF's indexed palette quantizes these grayscale samples; the boundary must still agree.
  result.gifSamples.forEach((value, i) =>
    expect(Math.abs(value - result.directions[0][i])).toBeLessThan(16),
  );
  expect(result.restored).toBe(true);
  expect(result.changed).toBe(true);
});
