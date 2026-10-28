import { test, expect } from '@playwright/test';

test('nested outlet navigation preserves market, campaign and filter state, with back and reload', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?market=BANNER2');
  await expect(page).toHaveURL(/\/campaign\?market=BANNER2$/);
  await expect(page.getByRole('combobox', { name: 'Active market' })).toHaveValue('BANNER2');
  await page.getByLabel('Headline', { exact: true }).fill('A ROUTED CAMPAIGN');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Find a format' }).fill('320');
  await expect(page.locator('.banner-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  await expect(page).toHaveURL(/\/assets\?market=BANNER2$/);
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
  // No bundled example banners: the library only holds uploaded originals.
  await expect(page.locator('img[src^="/references/"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('assets-page.png'), fullPage: true });
  await page.goBack();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue('A ROUTED CAMPAIGN');
  await expect(page.getByRole('textbox', { name: 'Find a format' })).toHaveValue('320');
  await page.getByRole('button', { name: 'Blueprint library 8', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Active market' })).toHaveValue('BANNER2');
  await expect(page.getByRole('heading', { name: 'Blueprint library', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Campaign studio', exact: true }).click();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue('A ROUTED CAMPAIGN');
  expect(errors).toEqual([]);
});

test('editor deep links select their own market and unknown routes have a recovery action', async ({
  page,
}) => {
  await page.goto('/campaign/BANNER2-320x50/edit');
  await expect(page.getByRole('heading', { name: 'Edit banner BANNER2 / 320 × 50' })).toBeVisible();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const bp = JSON.parse(await page.locator('.json-editor').inputValue());
  expect(bp.marketId).toBe('BANNER2');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Save banner' }).click();
  await expect(page).toHaveURL(/\/campaign\?market=BANNER2$/);
  await expect(page.getByRole('combobox', { name: 'Active market' })).toHaveValue('BANNER2');
  await page.goto('/blueprints/BANNER1-300x250/edit');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Edit blueprint BANNER1 / 300 × 250' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to blueprint', exact: true }).click();
  await expect(page).toHaveURL(/\/blueprints\/BANNER1-300x250\?market=BANNER1$/);
  await page.getByRole('button', { name: 'Back to blueprints' }).click();
  await expect(page).toHaveURL(/\/blueprints\?market=BANNER1$/);
  await page.goto('/campaign/does-not-exist/edit');
  await expect(page.getByRole('heading', { name: 'Banner not found' })).toBeVisible();
  await page.getByRole('button', { name: 'Open campaign studio' }).click();
  await expect(page.locator('.banner-card')).toHaveCount(8);
  await page.goto('/unknown-page');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.getByRole('button', { name: 'Open campaign studio' }).click();
  await expect(page.locator('.banner-card')).toHaveCount(8);
});
