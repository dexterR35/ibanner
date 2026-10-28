import { setAutoArrange } from './helpers/campaign.js';
import { readBlueprint, moveSelectedToX } from './helpers/editor.js';
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
async function settled(page) {
  await expect(page.getByRole('button', { name: 'Arrange now', exact: true })).toBeEnabled();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
}

test('Outfit waits for real font faces, applies role weights in BANNER1, and matches PNG/GIF output', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const fontRequests = [];
  await page.route('**/outfit-*-wght-normal.woff2*', async (route) => {
    fontRequests.push(route.request().url());
    await pending;
    await route.continue();
  });
  await page.goto('/campaign?market=BANNER1');
  await settled(page);
  const before = await project(page);
  await page.getByLabel('Banner typography', { exact: true }).selectOption('outfit');
  await expect.poll(() => fontRequests.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Export 300x250', exact: true })).toBeDisabled();
  release();
  await settled(page);
  const after = await project(page);
  expect(after.campaigns.BANNER1.typography).toBe('outfit');
  expect(after.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.assets).toEqual(before.assets);
  for (const entry of before.blueprints.filter((entry) => entry.marketId === 'BANNER2'))
    expect(after.banners[entry.id]).toEqual(before.banners[entry.id]);

  const proof = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const { renderOutput, backupProject, importProject } = await import('/src/core/export.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const p = await loadProject(),
      // New campaigns start without a legal line; give this render one to check its weight.
      campaign = { ...p.campaigns.BANNER1, legal: '18+ | Terms apply' };
    const resources = await loadResources(campaign);
    const entry = p.blueprints.find((entry) => entry.id === 'BANNER1-300x250');
    const bp = resolveBanner(entry, p.banners[entry.id]);
    const draws = [],
      proto = CanvasRenderingContext2D.prototype,
      original = proto.fillText;
    proto.fillText = function (text, ...args) {
      if (String(text).trim()) draws.push({ text: String(text), font: this.font });
      return original.call(this, text, ...args);
    };
    let gif;
    try {
      renderFrame(canvasOf(bp.width, bp.height), bp, campaign, resources);
      gif = await renderOutput(bp, campaign, resources, 'gif');
    } finally {
      proto.fillText = original;
    }
    const restored = await importProject(
      new File([await backupProject(p)], 'typography.zip', { type: 'application/zip' }),
    );
    return {
      draws,
      loaded: [...document.fonts]
        .filter((face) => face.family.includes('Outfit'))
        .map((face) => face.status),
      gifHeader: String.fromCharCode(...new Uint8Array(await gif.arrayBuffer()).slice(0, 6)),
      restored: restored.campaigns.BANNER1.typography,
    };
  });
  expect(proof.loaded).toEqual(['loaded', 'loaded']);
  for (const [text, weight] of [
    ['HEADLINE', '800'],
    ['OFFER', '600'],
    ['Call to action', '800'],
    ['18+', '400'],
  ]) {
    const draws = proof.draws.filter((draw) => draw.text.includes(text));
    expect(draws.length).toBeGreaterThanOrEqual(2); // preview and encoded GIF
    for (const draw of draws) {
      // Canvas serializes 400 as "normal" or omits it.
      expect(draw.font).toContain('Outfit Variable');
      if (weight === '400') expect(draw.font).not.toMatch(/(?:600|800|bold)/);
      else expect(draw.font).toMatch(new RegExp(`^${weight} `));
    }
  }
  expect(proof.gifHeader).toBe('GIF89a');
  expect(proof.restored).toBe('outfit');
  const card = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Edit banner 300x250', exact: true }) });
  const preview = await card.locator('canvas').evaluate((canvas) => canvas.toDataURL());
  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export 300x250', exact: true }).click();
  const data = await readFile(await (await downloadPromise).path());
  expect(`data:image/png;base64,${data.toString('base64')}`).toBe(preview);
  await page.getByLabel('Banner typography', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('outfit-banner1-studio.png') });
  await page.reload();
  await settled(page);
  await expect(page.getByLabel('Banner typography', { exact: true })).toHaveValue('outfit');
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit banner BANNER1 / 300 × 250' }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('outfit-banner1-editor.png') });
  expect(errors).toEqual([]);
});

test('switching typography retains frozen geometry and can restore the original appearance', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await settled(page);
  await setAutoArrange(page, false);
  await settled(page);
  const before = await project(page);
  const canvas = page
    .locator('.banner-card')
    .filter({ has: page.getByRole('button', { name: 'Edit banner 300x250', exact: true }) })
    .locator('canvas');
  const pixels = await canvas.evaluate((canvas) => canvas.toDataURL());
  await page.getByLabel('Banner typography', { exact: true }).selectOption('outfit');
  await settled(page);
  expect((await project(page)).banners).toEqual(before.banners);
  expect(await canvas.evaluate((canvas) => canvas.toDataURL())).not.toBe(pixels);
  await page.getByLabel('Banner typography', { exact: true }).selectOption('original');
  await settled(page);
  expect(await canvas.evaluate((canvas) => canvas.toDataURL())).toBe(pixels);
});

test('the logo is an uploaded image: replacement and typography changes retain unsaved editor layout', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await settled(page);
  const before = await project(page);
  const first =
    '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="60"><rect x="10" y="10" width="190" height="40" fill="#22ff55"/></svg>';
  const second =
    '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="60"><circle cx="105" cy="30" r="28" fill="#33aaff"/></svg>';
  await page
    .getByLabel('Logo', { exact: true })
    .setInputFiles({ name: 'logo-one.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(first) });
  await settled(page);
  const firstId = (await project(page)).campaigns.BANNER1.logoAssetId;
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await page.getByRole('button', { name: 'Logo', exact: true }).click();
  await moveSelectedToX(page, 'logo', 32);
  await page.getByLabel('Banner typography', { exact: true }).selectOption('outfit');
  await expect(page.getByRole('button', { name: 'Save banner', exact: true })).toBeEnabled();
  expect((await readBlueprint(page)).layers.find((layer) => layer.id === 'logo').x).toBe(32);
  await page.getByLabel('Logo', { exact: true }).setInputFiles({
    name: 'logo-two.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(second),
  });
  await expect(page.getByText('logo-two.svg', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save banner', exact: true })).toBeEnabled();
  expect((await readBlueprint(page)).layers.find((layer) => layer.id === 'logo').x).toBe(32);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Stacked fallback wordmark', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('logo-upload-editor.png') });
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await settled(page);
  const after = await project(page);
  expect(after.campaigns.BANNER1.logoAssetId).not.toBe(firstId);
  expect(
    after.banners['BANNER1-300x250'].override.layers.find((layer) => layer.type === 'logo').x,
  ).toBe(32);
  expect(after.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);
  expect(after.blueprints).toEqual(before.blueprints);
  for (const entry of before.blueprints.filter((entry) => entry.marketId === 'BANNER2'))
    expect(after.banners[entry.id]).toEqual(before.banners[entry.id]);
  const proof = await page.evaluate(
    async ({ firstId }) => {
      const { loadProject, loadResources, getAsset } = await import('/src/core/storage.js');
      const { resolveBanner } = await import('/src/data/defaults.js');
      const { canvasOf, renderFrame } = await import('/src/core/render.js');
      const p = await loadProject(),
        campaign = p.campaigns.BANNER1;
      const entry = p.blueprints.find((entry) => entry.id === 'BANNER1-300x250');
      const original = resolveBanner(entry, p.banners[entry.id]);
      const bp = { ...original, layers: original.layers.filter((layer) => layer.type === 'logo') };
      const resources = await loadResources(campaign),
        canvas = canvasOf(bp.width, bp.height);
      renderFrame(canvas, bp, campaign, resources);
      const outfit = canvas.toDataURL();
      renderFrame(canvas, bp, campaign, { ...resources, typography: 'original', fontFamily: null });
      return {
        sameLogo: canvas.toDataURL() === outfit,
        width: resources.logo.width,
        firstBytes: await (await getAsset(firstId)).text(),
      };
    },
    { firstId },
  );
  expect(proof.sameLogo).toBe(true);
  expect(proof.width).toBe(210);
  expect(proof.firstBytes).toBe(first);
});
