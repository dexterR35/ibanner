import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

// Create: Image → Analyze image → Qwen layout → formats. Every model is mocked; these tests
// check the workflow, not trained-model quality.
const florence = { ready: true, profileId: 'a'.repeat(64), deviceName: 'fixture CPU' };
// Fixture runs never call the real local cut-out model.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/subjects/tools/health', (r) =>
    r.fulfill({ status: 503, json: { detail: 'Image tools disabled in fixtures.' } }),
  );
});
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());

/** Qwen proposes the nearest example's boxes (its own reference for reference-linked sizes). */
async function mockLayout(page, calls = [], { delay = 0 } = {}) {
  await page.route('**/api/subjects/vision/layout', async (route) => {
    const payload = route.request().postDataJSON();
    calls.push(payload);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const targets = payload.targets.map((t) => {
      const svg = t.examples.at(-1)?.svg || '',
        boxes = {};
      for (const m of svg.matchAll(
        /<rect id="([a-z]+_\d+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g,
      ))
        if (t.elements.some((e) => e.id === m[1]))
          boxes[m[1]] = { x: +m[2], y: +m[3], width: +m[4], height: +m[5] };
      return { id: t.id, candidates: [{ complete: true, boxes }], raw: [svg] };
    });
    await route
      .fulfill({
        json: { schemaVersion: 1, method: 'postero-icl', targets, elapsedMs: 2400, provenance: {} },
      })
      .catch(() => {});
  });
}

async function seed(page, { qwen = true, florenceReady = true, campaign = {}, flow = null } = {}) {
  await page.route('**/api/subjects/vision/capabilities*', (r) =>
    r.fulfill({
      json: {
        qwen: qwen
          ? { ready: true, profileId: 'c'.repeat(64) }
          : { ready: false, message: 'Qwen offline in fixtures.' },
        florence: florenceReady
          ? florence
          : { ready: false, message: 'Florence-2 is not installed.' },
        ocr: { ready: false },
      },
    }),
  );
  await page.route('**/api/subjects/vision/reference', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        engine: 'florence2',
        width: 1024,
        height: 768,
        textRegions: [{ text: 'WIN TODAY', box: { x: 0.1, y: 0.1, width: 0.25, height: 0.08 } }],
        objects: [{ label: 'person', box: { x: 0.4, y: 0.1, width: 0.3, height: 0.8 } }],
        profileId: florence.profileId,
        provenance: {
          model: 'florence-community/Florence-2-base-ft',
          revision: 'b'.repeat(40),
          device: 'cpu',
          coordinateSpace: 'normalized-oriented-preview',
          tasks: ['<OCR_WITH_REGION>', '<OD>'],
        },
      },
    }),
  );
  await page.route('**/api/subjects/health', (r) =>
    r.fulfill({
      json: {
        service: 'bannerflow-sam3',
        schemaVersion: 1,
        engine: 'florence',
        ready: false,
        state: 'unavailable',
        loaded: false,
        device: 'CPU',
        issues: [],
      },
    }),
  );
  await page.goto('/');
  await saved(page);
  await page.evaluate(
    async ({ campaign, flow }) => {
      const { initialProject } = await import('/src/data/defaults.js');
      const { saveProject, storeAsset } = await import('/src/core/storage.js');
      const p = initialProject();
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 900;
      const c = canvas.getContext('2d');
      c.fillStyle = '#5f84af';
      c.fillRect(0, 0, 1200, 900);
      c.fillStyle = '#efd8aa';
      c.fillRect(450, 150, 300, 700);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const asset = await storeAsset(
        new File([blob], 'original-hero.png', { type: 'image/png' }),
        'hero',
      );
      p.assets.push(asset);
      Object.assign(p.campaigns.BANNER1, {
        heroAssetId: asset.id,
        headline: 'WIN TODAY',
        subtitle: '',
        cta: 'PLAY NOW',
        legal: '18+',
        autoSubject: false,
        autoArrange: false,
        keepBlueprintBoxes: false,
        typography: 'outfit',
        ...campaign,
      });
      if (flow) p.generationFlows = { BANNER1: flow };
      await saveProject(p);
    },
    { campaign, flow },
  );
  await page.goto('/generate?market=BANNER1');
  await expect(page.getByRole('button', { name: 'Generate layouts' })).toBeEnabled();
  // Initial mount autosaves the loaded project; fixture edits must wait for that writer.
  await saved(page);
}
const formats = ['300 × 250', '728 × 90', '1080 × 1920'];
const outputNode = (page, n) => page.locator(`.react-flow__node[data-id="output-${n}"]`);
async function generated(page) {
  for (let i = 1; i <= 3; i++)
    await expect(outputNode(page, i)).toContainText('Layout:', { timeout: 60000 });
}

test('image and exact copy inputs can be updated from Create without losing originals', async ({
  page,
}) => {
  await seed(page);
  const before = await page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    return { id: p.campaigns.BANNER1.heroAssetId, b2: p.campaigns.BANNER2.headline };
  });
  await page.locator('.react-flow__node[data-id="copy"]').click();
  await page.getByRole('textbox', { name: 'Banner 1 headline' }).fill('NEW OFFER');
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    canvas.getContext('2d').fillRect(0, 0, 200, 200);
    return canvas.toDataURL('image/png');
  });
  await page.getByLabel('Upload campaign image from node').setInputFiles({
    name: 'replacement.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataUrl.split(',')[1], 'base64'),
  });
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const p = await (await import('/src/core/storage.js')).loadProject();
        return p.campaigns.BANNER1.heroAssetId;
      }),
    )
    .not.toBe(before.id);
  const after = await page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    const { getAsset } = await import('/src/core/storage.js');
    return {
      headline: p.campaigns.BANNER1.headline,
      b2: p.campaigns.BANNER2.headline,
      oldAsset: Boolean(
        await getAsset(p.assets.find((asset) => asset.id !== p.campaigns.BANNER1.heroAssetId).id),
      ),
    };
  });
  expect(after).toEqual({ headline: 'NEW OFFER', b2: before.b2, oldAsset: true });
});
test('asset corrections and analyses survive verified backup restore; fenced jobs discard stale commits', async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { loadProject } = await import('/src/core/storage.js');
    const { saveCorrection, getRecord, enqueueJob, leaseJob, commitJob, cancelJob } =
      await import('/src/core/generation/store.js');
    const { backupProject, importProject } = await import('/src/core/export.js');
    const p = await loadProject(),
      id = p.assets[0].id;
    await saveCorrection(id, {
      tags: ['football', 'rotiri'],
      focal: { x: 0.3, y: 0.1, width: 0.4, height: 0.8 },
      ocrText: 'Baked offer',
    });
    const archive = await backupProject(p);
    const { set } = await import('/node_modules/.vite/deps/idb-keyval.js');
    await set(`asset:${id}`, new Blob(['corrupted cache']));
    const restored = await importProject(archive);
    const { getAsset, putAsset } = await import('/src/core/storage.js');
    const { digest } = await import('/src/core/generation/fingerprint.js');
    if ((await digest(await (await getAsset(id)).arrayBuffer())) !== id)
      throw new Error('Original repair failed');
    let rejected = false;
    try {
      await putAsset(id, new Blob(['forged bytes']));
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('Immutable write accepted forged bytes');
    const { assertBatchCorrectionsCurrent } = await import('/src/core/generation/batch.js');
    let stale = false;
    try {
      await assertBatchCorrectionsCurrent({
        snapshot: { campaign: { heroAssetId: id } },
        correction: null,
      });
    } catch {
      stale = true;
    }
    if (!stale) throw new Error('Stale corrections were accepted');
    await enqueueJob('fixture', { a: 1 }, 0);
    const old = await leaseJob('fixture', 'old', 0, 10);
    const fresh = await leaseJob('fixture', 'new', 11, 10);
    const late = await commitJob('fixture', 'old', old.token, { bad: true }, 12);
    const good = await commitJob('fixture', 'new', fresh.token, { good: true }, 12);
    await enqueueJob('cancel', {});
    const job = await leaseJob('cancel', 'worker');
    await cancelJob('cancel');
    const cancelled = await commitJob('cancel', 'worker', job.token, {});
    return {
      same: restored.assets[0].id === id,
      correction: await getRecord(`correction:${id}`),
      late,
      good,
      cancelled,
    };
  });
  expect(result.same).toBe(true);
  expect(result.correction.value.tags).toContain('rotiri');
  expect(result.late).toBe(false);
  expect(result.good).toBe(true);
  expect(result.cancelled).toBe(false);
  await page.goto('/assets?market=BANNER1');
  await page.getByLabel('Search assets').fill('rotiri');
  await expect(page.getByRole('heading', { name: 'original-hero.png' })).toBeVisible();
});

test('GIF import preserves original bytes and creates reusable timestamped frames', async ({
  page,
}, info) => {
  await seed(page);
  await page.goto('/assets?market=BANNER1');
  const { default: gifenc } = await import('gifenc');
  const { GIFEncoder } = gifenc;
  const gif = GIFEncoder();
  const palette = [
    [20, 40, 60],
    [220, 80, 20],
  ];
  gif.writeFrame(new Uint8Array(64 * 48).fill(0), 64, 48, { palette, delay: 70 });
  gif.writeFrame(new Uint8Array(64 * 48).fill(1), 64, 48, { palette, delay: 130 });
  gif.finish();
  const bytes = Buffer.from(gif.bytes());
  await page
    .getByLabel('Import GIF or video frames')
    .setInputFiles({ name: 'timed-source.gif', mimeType: 'image/gif', buffer: bytes });
  await expect(
    page.getByText(
      'Original media and sampled PNG frames saved. Choose a frame to use in a campaign.',
    ),
  ).toBeVisible();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const media = await page.evaluate(async () => {
    const s = await import('/src/core/storage.js');
    const p = await s.loadProject(),
      source = p.assets.find((a) => a.kind === 'media');
    return {
      source,
      original: Array.from(new Uint8Array(await (await s.getAsset(source.id)).arrayBuffer())),
      frames: p.assets.filter((a) => a.derivedFrom === source.id),
    };
  });
  expect(media.original).toEqual([...bytes]);
  expect(media.frames.map((f) => f.timestampMs)).toEqual([0, 70]);
  expect(media.frames.map((f) => f.durationMs)).toEqual([70, 130]);
  await page
    .locator('.intelligence-card')
    .filter({ hasText: 'timed-source.gif-frame-1-70ms.png' })
    .getByRole('button', { name: 'Use in campaign image', exact: true })
    .click();
  await expect(page.getByText('Asset bound to Banner 1.')).toBeVisible();
  await page.screenshot({ path: info.outputPath('asset-library.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('asset-library-mobile.png'), fullPage: true });
});

test('explicit retry after temporary Qwen failure gets a new fenced result revision', async ({
  page,
}) => {
  await seed(page);
  const result = await page.evaluate(async () => {
    const { enqueueJob, leaseJob, commitJob, getRecord } =
      await import('/src/core/generation/store.js');
    const key = 'planner-retry-fixture';
    await enqueueJob(key, {});
    const first = await leaseJob(key, 'first');
    await commitJob(key, 'first', first.token, {
      planner: { fallback: true, reason: 'Insufficient free VRAM' },
    });
    await enqueueJob(key, {}, Date.now(), { retryFallback: true });
    const second = await leaseJob(key, 'second');
    const stale = await commitJob(key, 'first', first.token, { planner: { plan: {} } });
    const accepted = await commitJob(key, 'second', second.token, {
      planner: { plan: { explanation: 'Memory is now available.' } },
    });
    await enqueueJob(key, {}, Date.now(), { retryFallback: true });
    const cached = (await getRecord('ledger')).jobs[key];
    return { first: first.token, second: second.token, stale, accepted, cached: cached.state };
  });
  expect(result.second).toBeGreaterThan(result.first);
  expect(result.stale).toBe(false);
  expect(result.accepted).toBe(true);
  expect(result.cached).toBe('succeeded');
});

test('all market sizes are data-driven and adding them twice keeps unique outputs', async ({
  page,
}) => {
  await seed(page);
  const before = await page.evaluate(
    async () => (await (await import('/src/core/storage.js')).loadProject()).blueprints,
  );
  await page.getByRole('button', { name: 'Add all market sizes', exact: true }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const sizes = await page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    return {
      requested: p.blueprints
        .filter((entry) => entry.marketId === 'BANNER1')
        .map((entry) => {
          const bp = entry.versions.find((v) => v.id === entry.activeVersionId).blueprint;
          return `${bp.width}x${bp.height}`;
        }),
      outputs: p.generationFlows.BANNER1.nodes
        .filter((node) => node.kind === 'output')
        .map((node) => `${node.data.width}x${node.data.height}`),
      blueprints: p.blueprints,
    };
  });
  expect(sizes.outputs).toEqual(expect.arrayContaining(sizes.requested));
  expect(new Set(sizes.outputs).size).toBe(sizes.outputs.length);
  expect(sizes.blueprints).toEqual(before);
  const count = await page.locator('.react-flow__node-create').count();
  await page.getByRole('button', { name: 'Add all market sizes', exact: true }).click();
  await expect(page.locator('.react-flow__node-create')).toHaveCount(count);
});

test('the flow has no Compose node and every connected size gets a Qwen-placed draft', async ({
  page,
}) => {
  const calls = [];
  await mockLayout(page, calls);
  await seed(page);
  await expect(page.locator('.react-flow__node')).toHaveCount(7);
  await expect(page.getByText('Compose layouts')).toHaveCount(0);
  await expect(page.locator('.react-flow__node[data-id="planner"]')).toContainText('Qwen layout');
  await page.getByRole('button', { name: 'Generate layouts' }).click();
  await generated(page);
  await expect(page.locator('.react-flow__node[data-id="planner"]')).toContainText(
    'Qwen placed layouts in 2 s',
  );
  await expect(page.locator('.react-flow__node[data-id="planner"]')).toContainText('3 of 3 drafts');
  expect(calls).toHaveLength(1);
  expect(calls[0].targets).toHaveLength(3);
  expect(calls[0].targets.every((t) => t.examples.length >= 1 && t.examples.length <= 4)).toBe(
    true,
  );
  expect(calls[0].targets[0].description).toContain('person');
  await saved(page);
  const p = await project(page);
  const batch = p.generationBatches.at(-1);
  expect(batch.snapshot.engine).toBe('qwen-layout-1');
  expect(batch.items.map((i) => i.state)).toEqual(['succeeded', 'succeeded', 'succeeded']);
  expect(
    batch.items.every((i) =>
      ['design', 'reference', 'qwen', 'qwen+reference-photo'].includes(i.source),
    ),
  ).toBe(true);
});

test('without Qwen or Florence every size still gets a draft from the saved design or nearest reference', async ({
  page,
}) => {
  await seed(page, { qwen: false, florenceReady: false });
  await page.getByRole('button', { name: 'Generate layouts' }).click();
  await generated(page);
  await expect(page.locator('.react-flow__node[data-id="planner"]')).toContainText('Qwen not used');
  await saved(page);
  const batch = (await project(page)).generationBatches.at(-1);
  expect(batch.items.every((i) => i.state === 'succeeded')).toBe(true);
  expect(batch.items.every((i) => ['design', 'reference'].includes(i.source))).toBe(true);
  expect(batch.analysis.notices.join(' ')).toContain('Florence-2 unavailable');
});

test('copy that is too long never blocks: the draft shrinks it and Qwen can shorten it for one size', async ({
  page,
}) => {
  await mockLayout(page);
  await page.route('**/api/subjects/vision/shorten', (r) =>
    r.fulfill({
      json: { suggestions: ['WIN BIG'], role: 'headline', maxChars: 8, provenance: {} },
    }),
  );
  await seed(page, {
    campaign: {
      headline:
        'WIN TODAY AND EVERY SINGLE MATCH DAY OF THE WHOLE SEASON WITH BRANDX, ALL THE BEST DEALS, NEWS AND EXTRAS FOR EVERY LEAGUE YOU FOLLOW, EVERY WEEK, ALL YEAR LONG',
    },
  });
  await page.getByRole('button', { name: 'Generate layouts' }).click();
  await generated(page);
  await saved(page);
  const batch = (await project(page)).generationBatches.at(-1);
  expect(batch.items.every((i) => i.state === 'succeeded' && i.scene)).toBe(true);
  const index = batch.items.findIndex((i) =>
    i.copyIssues?.some((issue) => issue.role === 'headline'),
  );
  expect(index).toBeGreaterThanOrEqual(0);
  const node = outputNode(page, index + 1);
  await expect(node).toContainText('copy too long');
  await node.getByRole('button', { name: 'Suggest shorter headline' }).click();
  await node.getByRole('button', { name: /Use "WIN BIG"/ }).click();
  await expect
    .poll(async () => Object.keys((await project(page)).campaigns.BANNER1.copyFits || {}).length)
    .toBe(1);
  const p = await project(page);
  const size = `${batch.items[index].target.width}x${batch.items[index].target.height}`;
  expect(p.campaigns.BANNER1.copyFits[size].headline).toBe('WIN BIG');
  expect(p.campaigns.BANNER1.headline).toContain('EVERY SINGLE MATCH');
});

test('a format node generates, downloads, goes to Studio and opens; undo restores the banner', async ({
  page,
}) => {
  await mockLayout(page);
  await seed(page);
  const before = (await project(page)).banners['BANNER1-300x250'];
  const node = outputNode(page, 1);
  await node.getByRole('button', { name: 'Generate 300 × 250 only' }).click();
  await expect(node).toContainText('Layout:', { timeout: 60000 });
  const download = page.waitForEvent('download');
  await node.getByRole('button', { name: 'Download 300 × 250 PNG' }).click();
  const png = new Uint8Array(await readFile(await (await download).path()));
  const view = new DataView(png.buffer);
  expect(view.getUint32(16)).toBe(300);
  expect(view.getUint32(20)).toBe(250);
  await node.getByRole('button', { name: 'Use 300 × 250 in Studio' }).click();
  await expect(node.getByRole('button', { name: 'Edit 300 × 250 in Studio' })).toBeVisible();
  await saved(page);
  const accepted = (await project(page)).banners['BANNER1-300x250'];
  expect(accepted.override.id).toBe('BANNER1-300x250');
  expect(accepted.generation.variant).toBeTruthy();
  await page.getByRole('button', { name: 'Undo generation' }).click();
  await saved(page);
  expect((await project(page)).banners['BANNER1-300x250']).toEqual(before);
  await node.getByRole('button', { name: 'Use 300 × 250 in Studio' }).click();
  await node.getByRole('button', { name: 'Edit 300 × 250 in Studio' }).click();
  await expect(page).toHaveURL(/\/campaign\/[^/]+\/edit\?market=BANNER1/);
});

test('all drafts go to Studio and export with a manifest of every size', async ({ page }) => {
  await mockLayout(page);
  await seed(page);
  await page.getByRole('button', { name: 'Generate layouts' }).click();
  await generated(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export generated drafts' }).click();
  const zip = unzipSync(new Uint8Array(await readFile(await (await download).path())));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  expect(manifest.engine).toBe('qwen-layout-1');
  expect(manifest.counts.succeeded).toBe(3);
  expect(Object.keys(zip).filter((name) => name.endsWith('.png'))).toHaveLength(3);
  await page.getByRole('button', { name: 'Use all drafts in Studio' }).click();
  await expect(page.getByText(/Drafts added to Studio/)).toBeVisible();
  await expect
    .poll(async () => Boolean((await project(page)).banners['BANNER1-728x90'].override))
    .toBe(true);
  const p = await project(page);
  for (const id of ['BANNER1-300x250', 'BANNER1-728x90'])
    expect(p.banners[id].override).toBeTruthy();
  // 1080×1920 is not an BANNER1 blueprint yet: it becomes one, seeded from the nearest reference.
  expect(p.blueprints.some((e) => e.id === 'BANNER1-1080x1920')).toBe(true);
});

test('cancelling while Qwen works keeps the previous drafts and publishes nothing late', async ({
  page,
}) => {
  await mockLayout(page, [], { delay: 4000 });
  await seed(page);
  await page.getByRole('button', { name: 'Generate layouts' }).click();
  await expect(page.getByRole('button', { name: 'Cancel generation' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel generation' }).first().click();
  await expect(page.getByRole('button', { name: 'Generate layouts' })).toBeEnabled();
  await page.waitForTimeout(4500);
  await saved(page);
  expect((await project(page)).generationBatches || []).toHaveLength(0);
});

test('a saved flow with the old Compose node opens as the new flow', async ({ page }) => {
  const edge = (source, sourceHandle, target, targetHandle) => ({
    id: `edge-${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  const node = (id, kind, data = {}) => ({ id, kind, position: { x: 0, y: 0 }, data });
  const flow = {
    version: 1,
    layoutVersion: 2,
    nodes: [
      node('image', 'image'),
      node('copy', 'copy', { brief: '' }),
      node('analysis', 'analysis'),
      node('planner', 'planner', { enabled: true }),
      node('compose', 'compose', { policy: { version: 1, mode: 'strict' }, manualLayouts: false }),
      node('output-1', 'output', { marketId: 'BANNER1', width: 300, height: 250 }),
    ],
    edges: [
      edge('image', 'image', 'analysis', 'image'),
      edge('analysis', 'analyzed', 'planner', 'analyzed'),
      edge('copy', 'copy', 'planner', 'copy'),
      edge('analysis', 'analyzed', 'compose', 'analyzed'),
      edge('copy', 'copy', 'compose', 'copy'),
      edge('planner', 'plan', 'compose', 'plan'),
      edge('compose', 'drafts', 'output-1', 'drafts'),
    ],
  };
  await mockLayout(page);
  await seed(page, { flow });
  await expect(page.getByText('Compose layouts')).toHaveCount(0);
  await expect(page.locator('.react-flow__node')).toHaveCount(5);
  await outputNode(page, 1).getByRole('button', { name: 'Generate 300 × 250 only' }).click();
  await expect(outputNode(page, 1)).toContainText('Layout:', { timeout: 60000 });
  await saved(page);
  const saved_ = (await project(page)).generationFlows.BANNER1;
  expect(saved_.nodes.some((n) => n.kind === 'compose')).toBe(false);
  expect(saved_.edges.some((e) => e.source === 'planner' && e.target === 'output-1')).toBe(true);
});
