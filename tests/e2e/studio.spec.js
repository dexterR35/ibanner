import { offlineAI } from './helpers/campaign.js';
import { readBlueprint, moveSelectedToX } from './helpers/editor.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
test.beforeEach(async ({ page }) => offlineAI(page));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Edit banner 300x250', exact: true }),
  ).toBeEnabled();
});
test('campaign edits persist, new markets and sizes remain independent', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.locator('.banner-card')).toHaveCount(8);
  await page.getByLabel('Headline', { exact: true }).fill('A SHORT TEST');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue('A SHORT TEST');
  await page.getByRole('button', { name: 'Banner 2' }).click();
  await expect(page.getByLabel('Headline', { exact: true })).not.toHaveValue('A SHORT TEST');
  await expect(page.getByPlaceholder('Enter market-specific legal copy')).toHaveValue('');
  await page.getByRole('button', { name: 'Add size', exact: true }).click();
  await page.getByLabel('Width (px)').fill('500');
  await page.getByLabel('Height (px)').fill('300');
  await page.getByRole('button', { name: 'Create blueprint', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit blueprint BANNER2 / 500 × 300' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).click();
  await page.getByRole('button', { name: 'Campaign studio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit banner 500x300' })).toBeVisible();
  await page.getByRole('button', { name: 'Add market', exact: true }).click();
  await page.getByLabel('Market name', { exact: true }).fill('Banner 4');
  await page.getByLabel('Market code').fill('BANNER4');
  await page.getByRole('button', { name: 'Create market' }).click();
  await expect(page.locator('.banner-card')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Banner 4', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test('editor saves an override and adds a timed GIF part without altering the master', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Edit banner 320x50', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Edit banner/ })).toBeVisible();
  await moveSelectedToX(page, 'headline', 40);
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByLabel('Part name').fill('Closing scene');
  await page.getByLabel('Duration (ms)', { exact: true }).fill('2400');
  await page.getByRole('button', { name: 'Save banner' }).click();
  await page.getByRole('button', { name: 'Edit banner 320x50', exact: true }).click();
  await expect(page.getByRole('button', { name: /Closing scene/ })).toBeVisible();
  expect((await readBlueprint(page)).layers.find((layer) => layer.id === 'headline').x).toBe(40);
  await page.getByRole('button', { name: 'Back to formats' }).click();
  await page.getByRole('button', { name: 'Blueprint library 8' }).click();
  await page.getByRole('button', { name: 'View blueprint 320x50', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Starting GIF timing' })).toBeVisible();
  await expect(page.getByText('Closing scene')).toHaveCount(0);
  const entry = await page.evaluate(async () => {
    const { loadProject } = await import('/src/core/storage.js');
    return (await loadProject()).blueprints.find((entry) => entry.id === 'BANNER1-320x50');
  });
  expect(entry.versions).toHaveLength(1);
  expect(entry.versions[0].blueprint.layers.find((layer) => layer.id === 'headline').x).not.toBe(
    40,
  );
});
test('ZIP export has all exact-size outputs and measured GIF timings', async ({
  page,
}, testInfo) => {
  await page.getByRole('button', { name: 'Export campaign 8' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export draft set' }).click();
  const file = await downloaded;
  const bytes = await readFile(await file.path()),
    zip = unzipSync(bytes),
    manifest = JSON.parse(strFromU8(zip['manifest.json']));
  expect(manifest.outputs).toHaveLength(8);
  for (const output of manifest.outputs) {
    expect(output.draft).toBe(true);
    expect(output.bytes).toBe(zip[output.filename].length);
    if (output.filename.endsWith('.png')) {
      const data = new DataView(zip[output.filename].buffer);
      expect(data.getUint32(16)).toBe(output.width);
      expect(data.getUint32(20)).toBe(output.height);
    }
  }
  for (const [size, delays] of [
    ['320x50', [2000, 2000, 1800]],
    ['300x100', [2000, 1800]],
    ['728x90', [3000, 1800]],
  ]) {
    const name = Object.keys(zip).find(
        (n) => n.startsWith(`BANNER1-${size}`) && n.endsWith('.gif'),
      ),
      data = zip[name];
    expect(String.fromCharCode(...data.slice(0, 6))).toBe('GIF89a');
    const found = [];
    for (let i = 0; i < data.length - 7; i++)
      if (data[i] === 0x21 && data[i + 1] === 0xf9 && data[i + 2] === 4 && data[i + 7] === 0)
        found.push((data[i + 4] + data[i + 5] * 256) * 10);
    expect(found).toEqual(delays);
  }
  await file.saveAs(testInfo.outputPath('campaign.zip'));
});
test('upload originals, analyze the photo, and restore a portable backup', async ({
  page,
}, testInfo) => {
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page.locator('.upload-zone input').setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.getByText('photo-300x600.png added. Original preserved.')).toBeVisible();
  await page.getByText('Photo analysis', { exact: true }).click();
  await page.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(page.locator('.analysis-result')).toContainText('OpenCV', { timeout: 40000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up workspace' }).click();
  const backup = await dl,
    path = testInfo.outputPath('backup.zip');
  await backup.saveAs(path);
  await page.getByLabel('Headline', { exact: true }).fill('REPLACEMENT');
  await page.locator('.import-label input').setInputFiles(path);
  await expect(page.getByText('Project imported.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Headline', { exact: true })).not.toHaveValue('REPLACEMENT');
});
test('format search, filters and responsive review surfaces work together', async ({
  page,
}, testInfo) => {
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-desktop.png'), fullPage: true });
  await page.getByRole('textbox', { name: 'Find a format' }).fill('320 × 50');
  await expect(page.locator('.banner-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Edit banner 320x50', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Static', exact: true }).click();
  await expect(page.getByText('No formats match your search.')).toBeVisible();
  await page.getByRole('button', { name: 'Show all formats', exact: true }).click();
  await expect(page.locator('.banner-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Animated', exact: true }).click();
  await expect(page.locator('.banner-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'All formats 8', exact: true }).click();
  await page.setViewportSize({ width: 900, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('studio-tablet.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath('studio-mobile.png') });
});
