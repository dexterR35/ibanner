import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 45000,
  use: {
    baseURL: 'http://localhost:5178',
    viewport: { width: 1440, height: 1100 },
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5178', reuseExistingServer: true },
  reporter: 'list',
});
