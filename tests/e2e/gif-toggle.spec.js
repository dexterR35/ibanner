import { test, expect } from '@playwright/test';

test('only Create GIF exposes the timeline; parts survive toggling, undo, save and reload', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign/BANNER1-300x250/edit?market=BANNER1');
  const toggle = page.getByLabel('Create GIF', { exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.timeline')).toHaveCount(0);
  await expect(page.getByLabel('GIF repeat (0 = forever)')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('static-no-timeline.png'), fullPage: true });
  await toggle.check();
  await expect(page.locator('.timeline')).toBeVisible();
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByLabel('Part name').fill('Closing');
  await page.getByLabel('Duration (ms)', { exact: true }).fill('2400');
  await page.getByRole('button', { name: 'Play animation' }).click();
  await toggle.uncheck();
  await expect(page.locator('.timeline')).toHaveCount(0);
  await page.getByTitle('Undo', { exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('button', { name: 'Play animation' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Closing/ })).toBeVisible();
  await toggle.uncheck();
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const staticDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  expect((await staticDownload).suggestedFilename()).toMatch(/\.png$/);
  await page.reload();
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('.timeline')).toHaveCount(0);
  await toggle.check();
  await page.getByRole('button', { name: /Closing/ }).click();
  await expect(page.getByLabel('Duration (ms)', { exact: true })).toHaveValue('2400');
  await page.screenshot({ path: testInfo.outputPath('gif-with-timeline.png'), fullPage: true });
  await page.getByTitle('Remove part', { exact: true }).click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('.timeline')).toBeVisible();
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  const gifDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  expect((await gifDownload).suggestedFilename()).toMatch(/\.gif$/);
});
