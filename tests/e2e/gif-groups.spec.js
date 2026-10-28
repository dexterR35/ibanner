import { test, expect } from '@playwright/test';

test('GIF artboards group native-size parts vertically and select their timeline moment', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.getByLabel('Find a format', { exact: true }).fill('320x50');
  const group = page.locator('.gif-artboard-group');
  await expect(group).toHaveCount(1);
  await expect(group.locator('.gif-part')).toHaveCount(3);
  const primary = await group.locator('.artboard-preview').first().boundingBox();
  let bottom = primary.y + primary.height;
  for (const part of await group.locator('.gif-part-preview').all()) {
    const bounds = await part.boundingBox();
    expect(bounds.width).toBeCloseTo(primary.width, 1);
    expect(bounds.height).toBeCloseTo(primary.height, 1);
    expect(bounds.y).toBeGreaterThan(bottom);
    bottom = bounds.y + bounds.height;
  }
  const pixels = await group.locator('.gif-part-preview canvas').evaluateAll(async (canvases) => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const { renderFrame, canvasOf } = await import('/src/core/render.js');
    const { sceneStart } = await import('/src/core/timeline.js');
    const project = await loadProject();
    const entry = project.blueprints.find((entry) => entry.id === 'BANNER1-320x50');
    const bp = resolveBanner(entry, project.banners[entry.id]);
    const campaign = project.campaigns.BANNER1;
    const resources = await loadResources(campaign);
    return canvases.map((canvas, index) => {
      const expected = canvasOf(bp.width, bp.height);
      renderFrame(
        expected,
        bp,
        campaign,
        resources,
        sceneStart(bp, index) + bp.scenes[index].durationMs / 2,
      );
      return (
        canvas.width === bp.width &&
        canvas.height === bp.height &&
        canvas.toDataURL() === expected.toDataURL()
      );
    });
  });
  expect(pixels).toEqual([true, true, true]);
  await page.screenshot({ path: testInfo.outputPath('gif-group.png') });
  await group.locator('.gif-part-preview').nth(1).click();
  await expect(page.getByLabel('Timeline position')).toHaveValue('3000');
  await expect(page.getByLabel('Part name')).toHaveValue('The offer');
  await page.getByLabel('Part name').fill('Updated offer');
  await expect(group.locator('.gif-part-heading').nth(1)).toContainText('Updated offer');
  await page.getByLabel('Create GIF', { exact: true }).uncheck();
  await expect(page.locator('.gif-parts')).toHaveCount(0);
  await page.getByLabel('Create GIF', { exact: true }).check();
  await expect(page.locator('.gif-part')).toHaveCount(3);
  await page.getByRole('button', { name: 'Deselect banner', exact: true }).click();
  await page.getByLabel('Find a format', { exact: true }).fill('300x250');
  await expect(page.locator('.gif-parts')).toHaveCount(0);
});
