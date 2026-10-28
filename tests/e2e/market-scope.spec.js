import { offlineAI } from './helpers/campaign.js';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ page }) => offlineAI(page));

const health = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  ready: true,
  state: 'available',
  loaded: true,
  device: 'fixture',
  issues: [],
};
const result = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  detections: [
    { label: 'person', score: 0.9, box: { xmin: 0.65, ymin: 0.1, xmax: 0.85, ymax: 0.8 } },
  ],
};
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

async function seedMarkets(page, settings = {}) {
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: health }));
  await page.goto('/assets?market=BANNER1');
  await saved(page);
  return page.evaluate(async (settings) => {
    const { initialProject, campaignFor, createBlueprint, newEntry, PRESETS } =
      await import('/src/data/defaults.js');
    const { storeAsset, saveProject } = await import('/src/core/storage.js');
    const p = initialProject();
    for (const id of ['DE', 'FR', 'IT', 'ES', 'BR']) {
      const market = { id, name: id, locale: 'en', legal: '', flag: id, legalStatus: 'missing' };
      p.markets = [...p.markets, market];
      p.campaigns[id] = campaignFor(market);
      for (const [w, h] of PRESETS.slice(0, 8)) {
        const entry = newEntry(createBlueprint(id, w, h));
        p.blueprints.push(entry);
        p.banners[entry.id] = {
          blueprintVersionId: entry.activeVersionId,
          override: null,
          history: [],
          layoutKey: null,
        };
      }
    }
    for (const [index, market] of p.markets.entries()) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 2048;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = `hsl(${index * 45} 50% 30%)`;
      ctx.fillRect(0, 0, 2048, 2048);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const asset = await storeAsset(
        new File([blob], `${market.id}-2k.png`, { type: blob.type }),
        'hero',
      );
      p.assets.push(asset);
      Object.assign(p.campaigns[market.id], {
        heroAssetId: asset.id,
        subjectQuery: `person ${market.id}`,
        subjectEngine: 'florence',
        autoSubject: true,
        ...settings,
      });
    }
    await saveProject(p);
    return p;
  }, settings);
}

function unchangedMarkets(before, after, selected) {
  expect(after.assets).toEqual(before.assets);
  expect(after.blueprints).toEqual(before.blueprints);
  for (const market of before.markets.filter((m) => m.id !== selected)) {
    expect(after.campaigns[market.id]).toEqual(before.campaigns[market.id]);
    for (const entry of before.blueprints.filter((b) => b.marketId === market.id))
      expect(after.banners[entry.id]).toEqual(before.banners[entry.id]);
  }
}

for (const engine of ['florence']) {
  test(`${engine}: seven markets with 2K images only process and edit selected BANNER1`, async ({
    page,
  }, testInfo) => {
    const requests = [];
    await page.route('**/api/subjects/detect?*', (route) => {
      requests.push(new URL(route.request().url()).searchParams.get('query'));
      return route.fulfill({ json: result });
    });
    const before = await seedMarkets(page, { subjectEngine: engine });
    await page.goto('/campaign?market=BANNER1');
    await expect(page.getByRole('button', { name: 'Focus person 1', exact: true })).toBeVisible();
    await page.getByLabel('Headline', { exact: true }).fill('BANNER1 CAMPAIGN ONLY');
    await page.getByRole('button', { name: 'Match blueprints', exact: true }).click();
    await page.getByRole('button', { name: 'Arrange now', exact: true }).click();
    await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
    await expect(page.locator('.studio-subject-status')).toContainText(
      'Subject placed across all formats',
    );
    await saved(page);
    const after = await project(page);
    expect(after.campaigns.BANNER1.headline).toBe('BANNER1 CAMPAIGN ONLY');
    expect(after.campaigns.BANNER1.subjectSearch.engine).toBe(engine);
    expect(after.banners['BANNER1-300x250'].arrangement).toBeTruthy();
    unchangedMarkets(before, after, 'BANNER1');
    expect(requests).toEqual(['person BANNER1', 'person BANNER1']);
    if (engine === 'florence') {
      await expect(
        page.getByText('Shared across 8 BANNER1 formats', { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('market-scope-banner1.png') });
    }
  });
}

for (const query of ['', '?market=BANNER1']) {
  test(`editor deep link ${query || 'without query'} processes its BANNER2 market only`, async ({
    page,
  }) => {
    const requests = [];
    await page.route('**/api/subjects/detect?*', (route) => {
      requests.push(new URL(route.request().url()).searchParams.get('query'));
      return route.fulfill({ json: result });
    });
    const before = await seedMarkets(page);
    await page.goto(`/campaign/BANNER2-300x250/edit${query}`);
    await expect(
      page.getByRole('heading', { name: 'Edit banner BANNER2 / 300 × 250' }),
    ).toBeVisible();
    await expect
      .poll(async () => (await project(page)).campaigns.BANNER2.subjectSearch?.engine)
      .toBe('florence');
    await page.getByRole('button', { name: 'Save banner', exact: true }).click();
    await saved(page);
    unchangedMarkets(before, await project(page), 'BANNER2');
    expect(requests).toEqual(['person BANNER2']);
  });
}

test('switching markets cancels BANNER1 placement and rejects its late result while BANNER2 stays editable', async ({
  page,
}) => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const requests = [];
  await page.route('**/api/subjects/detect?*', async (route) => {
    const query = new URL(route.request().url()).searchParams.get('query');
    requests.push(query);
    if (query === 'person BANNER1') await pending;
    await route.fulfill({ json: result }).catch(() => {});
  });
  const before = await seedMarkets(page, { autoSubject: false, autoArrange: false });
  await page.goto('/campaign?market=BANNER1');
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect.poll(() => requests).toEqual(['person BANNER1']);
  await expect(page.getByLabel('Headline', { exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Active market' }).selectOption('BANNER2');
  await expect(page.getByLabel('Headline', { exact: true })).toBeEnabled();
  await expect(page.getByRole('progressbar', { name: 'Automatic subject placement' })).toHaveCount(
    0,
  );
  release();
  await page.getByLabel('Headline', { exact: true }).fill('BANNER2 CAMPAIGN ONLY');
  await page.getByRole('button', { name: 'Auto place subject', exact: true }).click();
  await expect(page.locator('.studio-subject-status')).toContainText(
    'Subject placed across all formats',
  );
  await saved(page);
  const after = await project(page);
  unchangedMarkets(before, after, 'BANNER2');
  expect(after.campaigns.BANNER2.subjectFocus.assetId).toBe(before.campaigns.BANNER2.heroAssetId);
  expect(requests).toEqual(['person BANNER1', 'person BANNER2']);
});
