import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readBlueprint } from './helpers/editor.js';

const logoOf = (bp) => bp.layers.find((layer) => layer.id === 'logo');
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test('selection anchors resize and rotate outside the artwork, with one undo per gesture and native-size export', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await page.evaluate(async () =>
    (await import('/src/core/storage.js')).loadProject(),
  );
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await page.getByRole('button', { name: 'Logo', exact: true }).click();
  for (const label of ['X', 'Y', 'Rotation'])
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  const bp = await readBlueprint(page),
    original = logoOf(bp);
  const box = await page.locator('.editor-artwork').boundingBox(),
    scale = box.width / bp.width;
  const point = (x, y) => ({ x: box.x + x * scale, y: box.y + y * scale });
  const center = point(original.x + original.width / 2, original.y + original.height / 2);
  const handle = point(original.x + original.width / 2, original.y);
  handle.y -= 32;
  expect(handle.y).toBeLessThan(box.y); // Previously clipped by the native-sized Stage.
  await page.screenshot({ path: testInfo.outputPath('selection-handles.png') });
  await drag(page, handle, { x: center.x + (original.height * scale) / 2 + 32, y: center.y });
  const rotated = logoOf(await readBlueprint(page));
  expect(rotated.rotation).toBe(90);
  expect(rotated.width).toBe(original.width);
  expect(rotated.height).toBe(original.height);
  // The center stays fixed while the saved top-left/angle follow the renderer's contract.
  expect(
    Math.abs(rotated.x - rotated.height / 2 - (original.x + original.width / 2)),
  ).toBeLessThanOrEqual(0.5);
  expect(
    Math.abs(rotated.y + rotated.width / 2 - (original.y + original.height / 2)),
  ).toBeLessThanOrEqual(0.5);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(logoOf(await readBlueprint(page))).toEqual(original);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await drag(page, center, { x: center.x + 12 * scale, y: center.y + 8 * scale });
  const moved = logoOf(await readBlueprint(page));
  expect(moved.x).toBe(original.x + 12);
  expect(moved.y).toBe(original.y + 8);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(logoOf(await readBlueprint(page))).toEqual(original);
  const edge = point(original.x + original.width, original.y + original.height / 2);
  await drag(page, edge, { x: edge.x + 20 * scale, y: edge.y });
  const resized = logoOf(await readBlueprint(page));
  expect(resized.width).toBe(original.width + 20);
  expect(resized.height).toBe(original.height);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(logoOf(await readBlueprint(page))).toEqual(original);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(logoOf(await readBlueprint(page))).toEqual(resized);
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  const after = await page.evaluate(async () =>
    (await import('/src/core/storage.js')).loadProject(),
  );
  expect(after.blueprints).toEqual(before.blueprints);
  for (const [id, banner] of Object.entries(before.banners))
    if (id !== 'BANNER1-300x250') expect(after.banners[id]).toEqual(banner);
  const card = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Edit banner 300x250', exact: true }) });
  const preview = await card.locator('canvas').evaluate((c) => c.toDataURL());
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  const file = await downloading;
  expect(`data:image/png;base64,${(await readFile(await file.path())).toString('base64')}`).toBe(
    preview,
  );
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  expect(logoOf(await readBlueprint(page))).toEqual(resized);
  expect(errors).toEqual([]);
});
