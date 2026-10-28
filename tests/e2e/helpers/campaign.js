import { expect } from '@playwright/test';

export async function setAutoArrange(page, enabled) {
  const button = page.getByRole('button', { name: 'Automatic arrangement', exact: true });
  await expect(button).toBeEnabled();
  if ((await button.getAttribute('aria-pressed')) !== String(enabled)) await button.click();
  await expect(button).toHaveAttribute('aria-pressed', String(enabled));
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
}

/** Hermetic tests: the local AI service (vision models, image tools) looks offline. */
export async function offlineAI(page) {
  await page.route('**/api/subjects/vision/**', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Local AI service offline in tests.' } }),
  );
  await page.route('**/api/subjects/tools/**', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Image tools offline in tests.' } }),
  );
}
