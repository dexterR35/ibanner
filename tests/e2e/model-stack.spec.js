import { test, expect } from '@playwright/test';
import { fixtureDataUrl } from './helpers/fixtures.js';
import { readFile } from 'node:fs/promises';

// Opt-in trained-model smoke, using an isolated workspace and a bundled photo crop.
test('default trained stack creates a draft with Florence, BiRefNet and Qwen without SAM', async ({
  page,
}, info) => {
  test.skip(
    process.env.BANNERFLOW_REAL_STACK !== '1',
    'Requires installed Florence, BiRefNet and Qwen weights.',
  );
  test.setTimeout(300_000);
  const requests = [];
  const selectedModel = 'qwen3-vl-8b';
  const sourceImage = process.env.BANNERFLOW_STACK_SOURCE
    ? (await readFile(process.env.BANNERFLOW_STACK_SOURCE)).toString('base64')
    : null;
  const allSizes = process.env.BANNERFLOW_STACK_ALL === '1';
  page.on('request', (request) => {
    if (request.url().includes('/api/subjects/')) requests.push(request.url());
  });
  await page.goto('/campaign?market=BANNER1');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const before = await page.evaluate(
    async ({ selectedModel, sourceImage, allSizes, fixture }) => {
      const { loadProject, saveProject, storeAsset } = await import('/src/core/storage.js');
      const { defaultFlow } = await import('/src/core/generation/flow.js');
      const p = await loadProject();
      const image = await createImageBitmap(await (await fetch(fixture)).blob());
      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 210;
      canvas.getContext('2d').drawImage(image, 0, 340, 300, 210, 0, 0, 300, 210);
      image.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const asset = await storeAsset(
        new File([blob], 'stack-hero.png', { type: 'image/png' }),
        'hero',
      );
      let boundAsset = asset;
      if (sourceImage) {
        const source = await (await fetch('data:image/png;base64,' + sourceImage)).blob();
        boundAsset = await storeAsset(
          new File([source], 'blue-players.png', { type: 'image/png' }),
          'hero',
        );
      }
      p.assets.push(boundAsset);
      Object.assign(p.campaigns.BANNER1, {
        heroAssetId: boundAsset.id,
        autoSubject: false,
        autoArrange: false,
        headline: 'WIN TODAY',
        subtitle: '',
        cta: 'PLAY',
        legal: '18+',
        typography: 'outfit',
      });
      const flow = defaultFlow('BANNER1');
      flow.nodes.find((n) => n.kind === 'planner').data.modelVariant = selectedModel;
      const first = flow.nodes.find(
        (n) => n.kind === 'output' && n.data.width === 300 && n.data.height === 250,
      );
      if (!allSizes)
        flow.nodes = flow.nodes.filter((n) => n.kind !== 'output' || n.id === first.id);
      flow.edges = flow.edges.filter((e) => flow.nodes.some((n) => n.id === e.target));
      p.generationFlows = { ...p.generationFlows, BANNER1: flow };
      await saveProject(p);
      return { assetId: boundAsset.id, blueprints: p.blueprints };
    },
    { selectedModel, sourceImage, allSizes, fixture: fixtureDataUrl('photo-300x600.png') },
  );
  await page.goto('/generate?market=BANNER1');
  await page.getByRole('button', { name: 'Analyze image', exact: true }).click();
  await expect(
    page.getByText('Image analyzed. Review the detected subjects, then generate layouts.'),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Generate layouts', exact: true }).click();
  await expect(page.locator('.react-flow__node[data-id="planner"]')).toContainText(
    allSizes ? '3 of 3 drafts' : '1 of 1 drafts',
    { timeout: 200_000 },
  );
  await expect(page.locator('.react-flow__node[data-id="planner"]')).toContainText(
    'Qwen placed layouts',
  );
  // One layout job for every connected size; the removed planner endpoint is never called.
  expect(requests.filter((url) => new URL(url).pathname.endsWith('/layout'))).toHaveLength(1);
  expect(requests.some((url) => new URL(url).pathname.endsWith('/plan'))).toBe(false);
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const after = await page.evaluate(async () => {
    const { loadProject, getAsset } = await import('/src/core/storage.js');
    const p = await loadProject();
    const blob = await getAsset(p.campaigns.BANNER1.heroAssetId);
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(
      '',
    );
    return {
      campaign: p.campaigns.BANNER1,
      blueprints: p.blueprints,
      batch: p.generationBatches.at(-1),
      hash,
    };
  });
  expect(after.hash).toBe(before.assetId);
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.campaign.heroCutout.engine).toBe('birefnet');
  expect(after.campaign.heroCutout.sourceAssetId).toBe(before.assetId);
  expect(after.batch.analysis.focusSource).toBe('florence');
  expect(after.batch.items[0].state).toBe('succeeded');
  expect(
    requests.some(
      (url) =>
        new URL(url).pathname.endsWith('/detect') && new URL(url).searchParams.has('precision'),
    ),
  ).toBe(false);
  expect(after.batch.layout.provenance.variant).toBe(selectedModel);
  expect(requests.some((url) => new URL(url).pathname.endsWith('/detect'))).toBe(false);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download 300 × 250 PNG' }).click();
  await (await download).saveAs(info.outputPath('default-stack-native.png'));
  await page.screenshot({ path: info.outputPath('default-stack-create.png'), fullPage: true });
  await info.attach('stack-evidence', {
    body: JSON.stringify({
      cutout: after.campaign.heroCutout,
      analysis: after.batch.analysis.focusSource,
      layout: after.batch.layout,
      sources: after.batch.items.map((item) => [item.target.id, item.source, item.score]),
    }),
    contentType: 'application/json',
  });
});
