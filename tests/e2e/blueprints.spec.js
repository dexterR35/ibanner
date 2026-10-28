import { test, expect } from '@playwright/test';
import { readBlueprint } from './helpers/editor.js';

const storedBlueprints = (page) =>
  page.evaluate(async () => {
    const { loadProject } = await import('/src/core/storage.js');
    return (await loadProject()).blueprints;
  });

test('BANNER1 layout diagrams stay fixed after campaign uploads, text changes and Studio edits', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/blueprints?market=BANNER1');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const original = page.getByRole('img', { name: 'Layout diagram 300 by 250', exact: true });
  await expect(original).toBeVisible();
  await expect(page.locator('.blueprint-diagram')).toHaveCount(8);
  await expect(page.locator('.blueprint-card img')).toHaveCount(0);
  const originalPixels = await original.screenshot();
  const baseline = await storedBlueprints(page);
  await expect(page.getByRole('button', { name: /^Edit blueprint/ })).toHaveCount(8);
  await expect(page.locator('.banner-grid canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Campaign studio', exact: true }).click();
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page.getByLabel('Headline', { exact: true }).fill('CAMPAIGN CONTENT ONLY');
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.getByText('photo-300x600.png added. Original preserved.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await page.getByLabel('Text flow', { exact: true }).selectOption('auto');
  await page.getByLabel('Text / rows for this format', { exact: true }).fill('LOCAL BANNER COPY');
  await page.getByLabel('Text glow', { exact: true }).check();
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Blueprint library 8', exact: true }).click();
  expect(await original.screenshot()).toEqual(originalPixels);
  expect(await storedBlueprints(page)).toEqual(baseline);
  await page.screenshot({
    path: testInfo.outputPath('blueprints-banner1-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'View blueprint 300x250', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Blueprint BANNER1 / 300 × 250' })).toBeVisible();
  await expect(page.getByText('Reusable blueprint', { exact: true })).toBeVisible();
  await expect(page.locator('.blueprint-reference-art img')).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Layout diagram 300 by 250' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open original' })).toHaveCount(0);
  await expect(page.locator('.editor, .timeline, .inspector')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Starting GIF timing' })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('blueprint-banner1-detail.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
  await expect(page.getByLabel('Text / rows for this format', { exact: true })).toHaveValue(
    'LOCAL BANNER COPY',
  );
  await expect(page.getByLabel('Text glow', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Text flow', { exact: true })).toHaveValue('auto');
  await page.getByLabel('Text flow', { exact: true }).selectOption('single-line');
  await page.getByLabel('Text / rows for this format', { exact: true }).fill('ONE LINE');
  await expect(page.getByLabel('Text flow', { exact: true })).toHaveValue('single-line');
  const rows = await page.evaluate(
    async (bp) => {
      const { loadProject, loadResources } = await import('/src/core/storage.js');
      const { fitText } = await import('/src/core/text-fit.js');
      const { boundText } = await import('/src/core/render.js');
      const campaign = (await loadProject()).campaigns.BANNER1;
      const layer = bp.layers.find((l) => l.id === 'headline');
      return fitText(
        document.createElement('canvas').getContext('2d'),
        boundText(layer, campaign),
        layer,
        await loadResources(campaign),
      ).lines;
    },
    await readBlueprint(page),
  );
  expect(rows).toHaveLength(1);
  await page.getByRole('button', { name: 'Use campaign copy', exact: true }).click();
  await expect(page.getByLabel('Text / rows for this format', { exact: true })).toHaveValue(
    'CAMPAIGN CONTENT ONLY',
  );
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reposition image', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('blueprint editor links use their own market and pages show layout diagrams', async ({
  page,
}, testInfo) => {
  await page.goto('/blueprints/BANNER2-300x600/edit?market=BANNER1');
  await expect(
    page.getByRole('heading', { name: 'Edit blueprint BANNER2 / 300 × 600' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Blueprint editing canvas' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to blueprint', exact: true }).click();
  await expect(page).toHaveURL(/\/blueprints\/BANNER2-300x600\?market=BANNER2$/);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Active market' })).toHaveValue('BANNER2');
  await expect(page.getByRole('img', { name: 'Layout diagram 300 by 600' })).toBeVisible();
  await expect(page.getByText('Layout diagram', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|Publish|JSON/ })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('blueprint-banner2-detail.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('blueprint-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
  await expect(page).toHaveURL(/\/campaign\/BANNER2-300x600\/edit\?market=BANNER2$/);
  await expect(
    page.getByRole('heading', { name: 'Edit banner BANNER2 / 300 × 600' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to formats' }).click();
  await page.goto('/blueprints/BANNER2-320x50');
  await expect(page.getByRole('combobox', { name: 'Active market' })).toHaveValue('BANNER2');
  await expect(page.getByRole('heading', { name: 'Starting GIF timing' })).toBeVisible();
  await expect(page.locator('.timeline')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Active market' }).selectOption('BANNER1');
  await expect(page).toHaveURL(/\/blueprints\?market=BANNER1$/);
  await page.getByRole('button', { name: 'Animated', exact: true }).click();
  await expect(page.locator('.blueprint-card')).toHaveCount(3);
  await page.getByRole('textbox', { name: 'Find a format' }).fill('320x50');
  await expect(page.locator('.blueprint-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'View blueprint 320x50', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Layout diagram 320 by 50' })).toBeVisible();
  await expect(page.locator('.blueprint-timing')).toContainText('1.8s');
  await page.goto('/blueprints/missing/edit');
  await expect(page.getByRole('heading', { name: 'Banner not found' })).toBeVisible();
});
