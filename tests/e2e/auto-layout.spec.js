import { offlineAI, setAutoArrange } from './helpers/campaign.js';
import { bindFixtureHero } from './helpers/fixtures.js';
import { moveSelectedToX } from './helpers/editor.js';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => offlineAI(page));

const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
async function settled(page) {
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeEnabled();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
}

test('copy and image uploads automatically arrange every market format and export the same saved layout', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await settled(page);
  const before = await project(page);
  await page
    .getByLabel('Headline', { exact: true })
    .fill('PLAY EVERY MATCH YOUR WAY WITH BRANDX THIS WEEKEND');
  await settled(page);
  let arranged = await project(page);
  expect(arranged.blueprints).toEqual(before.blueprints);
  for (const entry of arranged.blueprints.filter((e) => e.marketId === 'BANNER1'))
    expect(arranged.banners[entry.id].arrangement).toBeTruthy();
  for (const entry of arranged.blueprints.filter((e) => e.marketId === 'BANNER2'))
    expect(arranged.banners[entry.id]).toEqual(before.banners[entry.id]);
  const first = arranged.banners;
  await expect(page.getByRole('button', { name: /Generate all/ })).toHaveCount(0);
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-160x600.png');
  await expect(
    page.getByText('photo-160x600.png added. Original preserved.', { exact: true }),
  ).toBeVisible();
  await settled(page);
  arranged = await project(page);
  expect(arranged.campaigns.BANNER1.heroAssetId).toBeTruthy();
  expect(arranged.banners['BANNER1-320x50'].layoutKey).toContain(
    arranged.campaigns.BANNER1.heroAssetId,
  );
  // Every format is re-arranged for the new image. The saved design is kept when the copy
  // still reads well in it, so a new photo need not move any boxes.
  for (const id of Object.keys(first).filter((id) => id.startsWith('BANNER1-'))) {
    expect(arranged.banners[id].layoutKey).toContain(arranged.campaigns.BANNER1.heroAssetId);
    expect(arranged.banners[id].arrangement).toBeTruthy();
  }
  await expect(page.getByRole('status', { name: 'Automatic arrangement status' })).toContainText(
    '8 formats ready',
  );
  await page.screenshot({
    path: testInfo.outputPath('automatic-layout-right-panel.png'),
    fullPage: true,
  });
  const match = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const p = await loadProject(),
      e = p.blueprints.find((e) => e.id === 'BANNER1-320x50');
    const bp = resolveBanner(e, p.banners[e.id]),
      c = p.campaigns.BANNER1,
      r = await loadResources(c);
    const preview = canvasOf(bp.width, bp.height),
      exported = canvasOf(bp.width, bp.height);
    renderFrame(preview, bp, c, r, 0);
    const image = await createImageBitmap(await renderOutput(bp, c, r, 'png'));
    exported.getContext('2d').drawImage(image, 0, 0);
    image.close();
    const a = preview.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
    const b = exported.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
    return a.every((v, i) => v === b[i]);
  });
  expect(match).toBe(true);
  await page.reload();
  await settled(page);
  expect((await project(page)).banners['BANNER1-320x50'].arrangement).toEqual(
    arranged.banners['BANNER1-320x50'].arrangement,
  );
});

test('automatic layout can be toggled without drift and respects saved editor adjustments', async ({
  page,
}) => {
  await page.goto('/');
  await settled(page);
  await setAutoArrange(page, false);
  await bindFixtureHero(page, ['BANNER1']);
  await settled(page);
  await page.getByLabel('Headline', { exact: true }).fill('MATCH DAY');
  await settled(page);
  expect((await project(page)).banners['BANNER1-300x250'].arrangement).toBeFalsy();
  await page.getByRole('button', { name: 'Arrange now', exact: true }).click();
  await settled(page);
  const first = (await project(page)).banners['BANNER1-300x250'].arrangement;
  await setAutoArrange(page, false);
  await page
    .getByLabel('Headline', { exact: true })
    .fill('PLAY EVERY MATCH YOUR WAY WITH BRANDX THIS WEEKEND');
  await settled(page);
  expect((await project(page)).banners['BANNER1-300x250'].arrangement).toEqual(first);
  await page.getByRole('button', { name: 'Arrange now', exact: true }).click();
  await settled(page);
  const second = (await project(page)).banners['BANNER1-300x250'].arrangement;
  expect(second).not.toEqual(first);
  await setAutoArrange(page, false);
  await page.getByRole('button', { name: 'Arrange now', exact: true }).click();
  await settled(page);
  expect((await project(page)).banners['BANNER1-300x250'].arrangement).toEqual(second);
  await setAutoArrange(page, true);
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await moveSelectedToX(page, 'headline', 80);
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await settled(page);
  await page.reload();
  await settled(page);
  const saved = (await project(page)).banners['BANNER1-300x250'];
  expect(saved.arrangement).toBeNull();
  expect(saved.override.layers.find((l) => l.id === 'headline').x).toBe(80);
});
