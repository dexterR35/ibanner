import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readBlueprint } from './helpers/editor.js';

test('legal copy has its own footer below the image in diagrams, Studio, editor and PNG export', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.getByLabel('Auto find subject on upload').uncheck();
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 600;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#dd22aa';
    ctx.fillRect(0, 0, 600, 600);
    return c.toDataURL().split(',')[1];
  });
  await page.locator('.upload-zone input').setInputFiles({
    name: 'footer-proof.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  let bp = await readBlueprint(page);
  const legal = bp.layers.find((l) => l.id === 'legal');
  let hero = bp.layers.find((l) => l.id === 'hero');
  expect(hero.y + hero.height).toBeLessThanOrEqual(legal.y - 4);
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await page.getByRole('button', { name: 'Edit frame', exact: true }).click();
  await page.getByLabel('HEIGHT', { exact: true }).fill('500');
  bp = await readBlueprint(page);
  hero = bp.layers.find((l) => l.id === 'hero');
  expect(hero.y + hero.height).toBeLessThanOrEqual(legal.y - 4);
  await page.getByRole('button', { name: 'Market legal', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('legal-footer-editor.png') });
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const card = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Edit banner 300x250', exact: true }) });
  const pixels = await card.locator('canvas').evaluate((c) => ({
    url: c.toDataURL(),
    footer: [...c.getContext('2d').getImageData(0, 230, 1, 1).data],
  }));
  expect(pixels.footer).toEqual([7, 13, 29, 255]);
  const waiting = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  const file = await waiting;
  expect(`data:image/png;base64,${(await readFile(await file.path())).toString('base64')}`).toBe(
    pixels.url,
  );
  await page.getByRole('button', { name: 'Blueprint library 8', exact: true }).click();
  await page.getByRole('button', { name: 'View blueprint 300x250', exact: true }).click();
  const diagram = page.getByRole('img', { name: 'Layout diagram 300 by 250' });
  const imageBox = diagram
    .locator('g')
    .filter({ has: page.locator('text', { hasText: /^Image$/ }) });
  const transform = await imageBox.getAttribute('transform');
  const y = Number(transform.match(/translate\([^ ]+ ([^)]+)/)[1]);
  expect(y + Number(await imageBox.locator('rect').getAttribute('height'))).toBeLessThanOrEqual(
    legal.y - 4,
  );
  await page.screenshot({ path: testInfo.outputPath('legal-footer-blueprint.png') });
});
