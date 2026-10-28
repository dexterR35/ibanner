import { setAutoArrange } from './helpers/campaign.js';
import { moveSelectedToX } from './helpers/editor.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const settled = async (page) => {
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeEnabled();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
};

test('Match blueprints fixes legacy custom text, keeps uploads and styles, and stays aligned after copy edits and export', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER2');
  await settled(page);
  await page.getByLabel('Auto find subject on upload').click();
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.getByText('photo-300x600.png added. Original preserved.')).toBeVisible();
  await settled(page);
  await page.getByRole('button', { name: 'Edit banner 300x600', exact: true }).click();
  await moveSelectedToX(page, 'headline', 4);
  await page.getByLabel('Alignment', { exact: true }).selectOption('left');
  await page.getByLabel('Text / rows for this format', { exact: true }).fill('LOCAL HEADLINE');
  await page.getByLabel('Text glow', { exact: true }).check();
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await settled(page);
  const before = await project(page);
  await page.getByRole('button', { name: 'Match blueprints', exact: true }).click();
  await settled(page);
  await expect(page.getByRole('button', { name: 'Match blueprints', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const matched = await project(page);
  expect(matched.blueprints).toEqual(before.blueprints);
  expect(matched.assets).toEqual(before.assets);
  expect(matched.campaigns.BANNER2.heroAssetId).toBe(before.campaigns.BANNER2.heroAssetId);
  expect(matched.campaigns.BANNER1).toEqual(before.campaigns.BANNER1);
  const headline = matched.banners['BANNER2-300x600'].override.layers.find(
    (layer) => layer.id === 'headline',
  );
  expect(headline.textOverride).toBe('LOCAL HEADLINE');
  expect(headline.glow.enabled).toBe(true);
  expect(headline.align).toBe('center');
  expect(headline.x).toBe(30);
  await page.getByLabel('Headline', { exact: true }).fill('MATCH DAY WITH BRANDX');
  await settled(page);
  await setAutoArrange(page, true);
  await expect(
    page.getByRole('button', { name: 'Automatic arrangement', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await settled(page);
  const after = await project(page);
  for (const entry of after.blueprints.filter((item) => item.marketId === 'BANNER2')) {
    const standard = entry.versions.find(
      (version) => version.id === entry.activeVersionId,
    ).blueprint;
    const arrangement = after.banners[entry.id].arrangement;
    for (const layer of standard.layers) {
      const actual = arrangement.layers.find((item) => item.id === layer.id);
      for (const key of ['x', 'y', 'width', 'height', 'align', 'rotation', 'verticalAlign'])
        expect(actual[key], `${entry.id}/${layer.id}/${key}`).toEqual(layer[key]);
    }
  }
  await page.screenshot({
    path: testInfo.outputPath('studio-matched-blueprints.png'),
    fullPage: true,
  });
  const card = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Edit banner 300x600', exact: true }) });
  const pixels = await card.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  const downloaded = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export 300x600', exact: true }).click();
  const file = await downloaded;
  expect(`data:image/png;base64,${(await readFile(await file.path())).toString('base64')}`).toEqual(
    pixels,
  );
  await page.reload();
  await settled(page);
  await expect(page.getByRole('button', { name: 'Match blueprints', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await project(page)).banners['BANNER2-160x600'].arrangement).toEqual(
    after.banners['BANNER2-160x600'].arrangement,
  );
  await page.getByRole('button', { name: 'Match blueprints', exact: true }).click();
  await settled(page);
  expect((await project(page)).banners['BANNER2-160x600'].arrangement).not.toEqual(
    after.banners['BANNER2-160x600'].arrangement,
  );
});
