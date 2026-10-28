import { test, expect } from '@playwright/test';
import { fixtureDataUrl } from './helpers/fixtures.js';

// HTTP fixtures verify integration, storage and rendering. They do not measure model quality;
// the real local models were checked separately (see docs/STATUS.md).
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const panel = (page) => page.getByRole('region', { name: 'Automatic enhancements' });
const samHealth = {
  service: 'bannerflow-sam3',
  schemaVersion: 1,
  engine: 'florence',
  ready: true,
  state: 'available',
  loaded: false,
  device: 'test fixture',
  issues: [],
};
const toolsHealth = {
  service: 'bannerflow-tools',
  schemaVersion: 1,
  state: 'available',
  device: 'test fixture',
  tools: {
    cutout: { ready: true, issues: [], selection: 'box' },
    extend: { ready: true, issues: [] },
    upscale: { ready: true, issues: [] },
  },
};

/** Canvas-made PNG fixtures, returned as bytes to the Node route handlers. */
const png = (page, width, height, paint) =>
  page
    .evaluate(
      ([width, height, paint]) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        new Function('context', 'width', 'height', paint)(context, width, height);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      [width, height, paint],
    )
    .then((data) => Buffer.from(data, 'base64'));

async function fixtures(page, calls) {
  await page.route('**/api/subjects/health', (route) => route.fulfill({ json: samHealth }));
  await page.route('**/api/subjects/detect?*', (route) =>
    route.fulfill({
      json: {
        service: 'bannerflow-sam3',
        schemaVersion: 1,
        engine: 'florence',
        detections: [{ label: 'person', score: 0.95, box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } }],
      },
    }),
  );
  await page.route('**/api/subjects/tools/health', (route) => route.fulfill({ json: toolsHealth }));
  await page.route('**/api/subjects/tools/cutout?*', async (route) => {
    calls.push(new URL(route.request().url()).searchParams.toString());
    route.fulfill({
      body: await png(
        page,
        150,
        105,
        "context.fillStyle = '#ff00ff'; context.fillRect(0, 0, width, height);",
      ),
      headers: {
        'content-type': 'image/png',
        'x-bannerflow-box': '0,0,1,1',
        'x-bannerflow-engine': 'birefnet',
      },
    });
  });
  await page.route('**/api/subjects/tools/upscale?*', async (route) => {
    calls.push('upscale');
    route.fulfill({
      body: await png(
        page,
        600,
        420,
        "context.fillStyle = '#3366ff'; context.fillRect(0, 0, width, height);",
      ),
      headers: { 'content-type': 'image/png', 'x-bannerflow-engine': 'real-esrgan-x2' },
    });
  });
  await page.route('**/api/subjects/tools/extend?*', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    calls.push(`extend:${params}`);
    const grow = (a, b) => 1 + Number(params.get(a)) + Number(params.get(b));
    route.fulfill({
      body: await png(
        page,
        Math.round(600 * grow('left', 'right')),
        Math.round(420 * grow('top', 'bottom')),
        "context.fillStyle = '#22aa44'; context.fillRect(0, 0, width, height);",
      ),
      headers: { 'content-type': 'image/png', 'x-bannerflow-engine': 'lama' },
    });
  });
}

async function uploadHero(page) {
  const hero = await png(
    page,
    300,
    210,
    "context.fillStyle = '#f4f4f4'; context.fillRect(0, 0, width, height); context.fillStyle = '#223366'; context.fillRect(90, 40, 120, 170);",
  );
  await page.locator('.upload-zone input').setInputFiles({
    name: 'bright-hero.png',
    mimeType: 'image/png',
    buffer: hero,
  });
  await expect(page.locator('.subject-panel [role="status"]')).toContainText('Subject placed', {
    timeout: 20_000,
  });
  await saved(page);
}

test('image tools store derived assets, keep the original and render the same pixels in export', async ({
  page,
}, testInfo) => {
  const calls = [],
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await fixtures(page, calls);
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await project(page);
  await uploadHero(page);
  const uploaded = await project(page);
  const original = uploaded.campaigns.BANNER1.heroAssetId;

  await panel(page)
    .getByRole('button', { name: /Cut out subject/ })
    .click();
  await expect(panel(page).getByRole('status')).toContainText('Subject cut out with BiRefNet');
  await expect(panel(page).getByLabel('Subject in front of text')).toBeChecked();
  expect(calls[0]).toContain('label=person');
  expect(calls[0]).toContain('xmin=0.000000');

  await panel(page)
    .getByRole('button', { name: /Upscale ×/ })
    .click();
  await expect(panel(page).getByRole('status')).toContainText('Upscaled');
  await panel(page).getByRole('button', { name: 'Extend background', exact: true }).click();
  await expect(panel(page).getByRole('status')).toContainText('Extended', { timeout: 20_000 });
  await saved(page);

  const after = await project(page);
  const c = after.campaigns.BANNER1;
  expect(c.heroAssetId).toBe(original);
  for (const key of ['heroCutout', 'heroUpscale']) {
    expect(c[key].sourceAssetId).toBe(original);
    expect(after.assets.find((a) => a.id === c[key].assetId)).toMatchObject({
      kind: 'derived',
      derivedFrom: original,
    });
  }
  expect(c.heroExtendWide.sourceAssetId).toBe(c.heroUpscale.assetId);
  expect(c.heroExtendTall.sourceAssetId).toBe(c.heroUpscale.assetId);
  // Masters and other markets are untouched; only Studio arrangements change.
  expect(after.blueprints).toEqual(before.blueprints);
  expect(after.campaigns.BANNER2).toEqual(before.campaigns.BANNER2);

  const check = await page.evaluate(async () => {
    const { loadProject, loadResources, getAsset } = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { heroFor } = await import('/src/core/hero-variants.js');
    const p = await loadProject(),
      c = p.campaigns.BANNER1,
      r = await loadResources(c);
    const withSubject = p.blueprints
      .map((e) => resolveBanner(e, p.banners[e.id]))
      .filter((bp) => bp.layers.some((l) => l.type === 'cutout'));
    const wide = resolveBanner(
      p.blueprints.find((e) => e.id === 'BANNER1-728x90'),
      p.banners['BANNER1-728x90'],
    );
    const bp = withSubject[0];
    const preview = canvasOf(bp.width, bp.height),
      exported = canvasOf(bp.width, bp.height);
    renderFrame(preview, bp, c, r, 0);
    const image = await createImageBitmap(await renderOutput(bp, c, r, 'png'));
    exported.getContext('2d').drawImage(image, 0, 0);
    const a = preview.getContext('2d').getImageData(0, 0, bp.width, bp.height).data,
      b = exported.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
    const photo = wide.layers.find((l) => l.type === 'image');
    return {
      banners: withSubject.map((item) => item.id),
      order: bp.layers.map((l) => l.type),
      match: a.every((v, i) => v === b[i]),
      originalKept: (await getAsset(c.heroAssetId)).size > 0 && r.heroSource.width === 300,
      upscaled: r.hero.width,
      wideUsesVariant: heroFor(photo, r).image === r.heroWide.image,
    };
  });
  expect(check.banners.length).toBeGreaterThan(0);
  expect(check.order.indexOf('cutout')).toBeGreaterThan(check.order.indexOf('text'));
  expect(check.match).toBe(true);
  expect(check.originalKept).toBe(true);
  expect(check.upscaled).toBe(600);
  expect(check.wideUsesVariant).toBe(true);

  // Turning the treatment off removes only the automatic subject layers.
  await panel(page).getByLabel('Subject in front of text').uncheck();
  await saved(page);
  const off = await project(page);
  expect(
    Object.values(off.banners).some((b) => b.arrangement?.layers.some((l) => l.type === 'cutout')),
  ).toBe(false);
  await page.reload();
  await saved(page);
  expect((await project(page)).campaigns.BANNER1.heroCutout).toEqual(c.heroCutout);
  await panel(page).screenshot({ path: testInfo.outputPath('automation-panel.png') });
  expect(errors).toEqual([]);
});

test('readability halos, photo colour suggestions and a file-size limit apply to exports', async ({
  page,
}, testInfo) => {
  await fixtures(page, []);
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await uploadHero(page);
  // Put one headline over the bright photo and keep blueprint boxes, so arrangement cannot
  // move it into clear space: that copy then fails contrast.
  await page.evaluate(async () => {
    const storage = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const p = await storage.loadProject();
    const e = p.blueprints.find((item) => item.id === 'BANNER1-300x250');
    const bp = resolveBanner(e, { ...p.banners[e.id], arrangement: null });
    const photo = bp.layers.find((l) => l.type === 'image');
    const override = {
      ...bp,
      layers: bp.layers.map((l) =>
        l.id === 'headline'
          ? { ...l, x: photo.x + 10, y: photo.y + 10, width: 150, height: 40 }
          : l,
      ),
    };
    p.banners[e.id] = { ...p.banners[e.id], override, arrangement: null };
    p.campaigns.BANNER1.keepBlueprintBoxes = true;
    await storage.saveProject(p);
  });
  await page.reload();
  await saved(page);
  await panel(page).getByLabel('Keep text readable').check();
  await saved(page);
  const halo = await page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    return p.banners['BANNER1-300x250'].arrangement.layers.find((l) => l.id === 'headline').glow;
  });
  expect(halo).toMatchObject({ enabled: true, auto: true });
  await panel(page).getByLabel('Keep text readable').uncheck();
  await saved(page);
  expect(
    (await project(page)).banners['BANNER1-300x250'].arrangement.layers.find(
      (l) => l.id === 'headline',
    ).glow.enabled,
  ).toBe(false);

  const colours = panel(page).getByRole('group', { name: 'Colour suggestions' });
  await expect(colours.locator('.palette-swatches span').first()).toBeVisible();
  await colours.getByRole('button', { name: /Use for CTA/ }).click();
  await saved(page);
  const cta = (await project(page)).campaigns.BANNER1.ctaColor;
  expect(cta).toMatch(/^#[0-9a-f]{6}$/);

  await page.getByLabel('File size limit', { exact: true }).selectOption('custom');
  await page.getByLabel('KB', { exact: true }).fill('40');
  await saved(page);
  const report = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { exportSet, renderWithinLimit } = await import('/src/core/export.js');
    const { limitBytes } = await import('/src/data/output-limits.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const p = await loadProject(),
      c = p.campaigns.BANNER1,
      r = await loadResources(c);
    const entries = p.blueprints.filter((e) =>
      ['BANNER1-300x250', 'BANNER1-320x50'].includes(e.id),
    );
    const zip = await exportSet(entries, p, c, r, 'png', () => {});
    const outputs = [];
    for (const e of entries) {
      const bp = resolveBanner(e, p.banners[e.id]);
      const ext = bp.mode === 'animated' ? 'gif' : 'png';
      const { blob, limit } = await renderWithinLimit(bp, c, r, ext, limitBytes(c.outputLimit));
      outputs.push({ bytes: blob.size, sizeLimit: limit, gif: ext === 'gif' });
    }
    return { zip: zip.size, outputs };
  });
  expect(report.zip).toBeGreaterThan(0);
  for (const output of report.outputs) {
    expect(output.sizeLimit.maxBytes).toBe(40 * 1024);
    expect(output.sizeLimit.attempts.length).toBeGreaterThan(0);
    // Either it fits, or every reduction step was tried and the result is reported as over.
    if (output.sizeLimit.within) expect(output.bytes).toBeLessThanOrEqual(40 * 1024);
    // PNG: original + 4 palette sizes. GIF: original + 6 colour/frame reductions.
    else expect(output.sizeLimit.attempts.length).toBe(output.gif ? 7 : 5);
  }
  await page.screenshot({ path: testInfo.outputPath('automation-studio.png') });
});

test('Create GIF on a static banner generates introduction, offer and CTA parts', async ({
  page,
}) => {
  await page.route('**/api/subjects/**', (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await page.getByRole('button', { name: 'Fit all artboards', exact: true }).click();
  await page.getByRole('button', { name: 'Select banner 300x250', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected banner properties' });
  await inspector.getByLabel('Create GIF', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Auto parts', exact: true })).toBeVisible();
  await saved(page);
  const bp = await page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    const e = p.blueprints.find((e) => e.id === 'BANNER1-300x250');
    return (await import('/src/data/defaults.js')).resolveBanner(e, p.banners[e.id]);
  });
  expect(bp.mode).toBe('animated');
  expect(bp.scenes.map((s) => s.name)).toContain('Introduction');
  expect(bp.scenes.every((s) => s.tracks.legal?.visible !== false)).toBe(true);
});

test('a finished banner image becomes a draft blueprint without changing saved revisions', async ({
  page,
}, testInfo) => {
  const profileId = 'a'.repeat(64);
  await page.route('**/api/subjects/vision/capabilities*', (r) =>
    r.fulfill({ json: { florence: { ready: true, profileId, deviceName: 'fixture CPU' } } }),
  );
  await page.route('**/api/subjects/vision/reference', (r) =>
    r.fulfill({
      json: {
        schemaVersion: 1,
        engine: 'florence2',
        width: 300,
        height: 580,
        textRegions: [
          { text: 'Win today', box: { x: 0.12, y: 0.18, width: 0.5, height: 0.08 } },
          { text: 'Play now', box: { x: 0.15, y: 0.7, width: 0.3, height: 0.06 } },
        ],
        objects: [{ label: 'person', box: { x: 0.4, y: 0.2, width: 0.4, height: 0.5 } }],
        profileId,
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
  await page.goto('/blueprints?market=BANNER1');
  await saved(page);
  const before = await project(page);
  await page.getByRole('button', { name: 'New size', exact: true }).click();
  // A size the market does not have yet creates a new draft entry.
  const cropped = await page.evaluate(async (fixture) => {
    const image = await createImageBitmap(await (await fetch(fixture)).blob());
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 580;
    canvas.getContext('2d').drawImage(image, 0, 0, 300, 580, 0, 0, 300, 580);
    return canvas.toDataURL('image/png').split(',')[1];
  }, fixtureDataUrl('photo-300x600.png'));
  await page.getByLabel(/finished banner to suggest a layout/i).setInputFiles({
    name: 'finished-300x580.png',
    mimeType: 'image/png',
    buffer: Buffer.from(cropped, 'base64'),
  });
  await expect(page).toHaveURL(/\/blueprints\/BANNER1-300x580\/edit/);
  await expect
    .poll(async () => (await project(page)).blueprints.some((e) => e.id === 'BANNER1-300x580'))
    .toBe(true);
  const created = (await project(page)).blueprints.find((e) => e.id === 'BANNER1-300x580');
  // Florence fallback: roles are suggested from size and position; OCR text only names layers.
  const layers = created.versions[0].blueprint.layers;
  expect(layers.map((l) => l.source)).toEqual(['headline', 'subtitle']);
  expect(layers.map((l) => l.text)).toEqual(['', '']);
  expect(layers[0].name).toMatch(/^Headline · .*Win today/);
  expect(layers[1].name).toMatch(/^Offer \/ subtitle · .*Play now/);
  await page.screenshot({ path: testInfo.outputPath('detected-blueprint-editor.png') });

  // An existing size opens the proposal as unsaved changes only.
  await page.goto('/blueprints?market=BANNER1');
  await page.getByRole('button', { name: 'New size', exact: true }).click();
  await page
    .getByLabel(/finished banner to suggest a layout/i)
    .setInputFiles('tests/fixtures/photo-320x480.png');
  await expect(page).toHaveURL(/\/blueprints\/BANNER1-320x480\/edit/);
  await expect(page.getByText(/opened as unsaved changes/)).toBeVisible();
  const after = await project(page);
  expect(after.blueprints.find((e) => e.id === 'BANNER1-320x480')).toEqual(
    before.blueprints.find((e) => e.id === 'BANNER1-320x480'),
  );
  await page.getByRole('button', { name: 'Back to blueprint', exact: true }).click();
  await page.getByRole('button', { name: 'Edit blueprint', exact: true }).click();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const reopened = JSON.parse(await page.locator('.json-editor').inputValue());
  const entry = before.blueprints.find((e) => e.id === 'BANNER1-320x480');
  expect(reopened.layers.map((l) => l.name)).toEqual(
    entry.versions.find((v) => v.id === entry.activeVersionId).blueprint.layers.map((l) => l.name),
  );
});

test('PaddleOCR reference import suggests roles from campaign copy, colour and a button', async ({
  page,
}) => {
  const profileId = 'c'.repeat(64);
  // PaddleOCR (PP-OCRv6) line boxes; tests/fixtures/ocr-banner-300x600.png paints the same boxes.
  const read = [
    ['BrandX', 0.9999, 0.19, 0.045, 0.6133, 0.0733],
    ['OTTELUILTA', 0.9997, 0.1367, 0.1483, 0.76, 0.055],
    ['ALKAA.', 0.9997, 0.2467, 0.2383, 0.5267, 0.0483],
    ['TÄNÄÄN', 0.9806, 0.21, 0.2833, 0.58, 0.0467],
    ['UUDET', 0.9999, 0.2733, 0.35, 0.6767, 0.0517],
    ['TUOTTEET', 0.9999, 0.27, 0.3983, 0.6767, 0.0533],
    ['Rekisteröidy', 0.9998, 0.2867, 0.5033, 0.4133, 0.04],
    [
      '18+ | Pelaathan vastuullisesti I Käyttöehdot pātevät',
      0.9525,
      0.0267,
      0.9333,
      0.9467,
      0.0233,
    ],
    ['LIC/ABC/000/2026', 1, 0.3133, 0.9583, 0.3733, 0.02],
  ];
  const requests = [];
  await page.route('**/api/subjects/vision/capabilities*', (r) =>
    r.fulfill({
      json: {
        ocr: { ready: true, engine: 'rapidocr', profileId },
        florence: { ready: false, message: 'Florence is not needed.' },
      },
    }),
  );
  await page.route('**/api/subjects/vision/ocr', (r) => {
    requests.push(r.request().postDataJSON());
    return r.fulfill({
      json: {
        schemaVersion: 1,
        engine: 'rapidocr',
        width: 300,
        height: 600,
        lines: read.map(([text, confidence, x, y, width, height]) => ({
          text,
          confidence,
          box: { x, y, width, height },
        })),
        profileId,
        provenance: { engine: 'rapidocr', device: 'cpu' },
      },
    });
  });
  await page.goto('/blueprints?market=BANNER1');
  await saved(page);
  // Campaign copy lets the import match OCR lines to roles.
  await page.evaluate(async () => {
    const { loadProject, saveProject } = await import('/src/core/storage.js');
    const p = await loadProject();
    Object.assign(p.campaigns.BANNER1, {
      headline: 'OTTELUILTA\nALKAA TÄNÄÄN',
      subtitle: 'UUDET\nTUOTTEET',
      cta: 'Rekisteröidy',
      legal: '18+ | Pelaathan vastuullisesti | Käyttöehdot pätevät | LIC/ABC/000/2026',
    });
    await saveProject(p);
  });
  await page.reload();
  await saved(page);
  const before = await project(page);
  await page.getByRole('button', { name: 'New size', exact: true }).click();
  await page
    .getByLabel(/finished banner to suggest a layout/i)
    .setInputFiles('tests/fixtures/ocr-banner-300x600.png');
  await expect(page).toHaveURL(/\/blueprints\/BANNER1-300x600\/edit/);
  await expect(
    page.getByText(
      'PaddleOCR read 9 text lines and suggested logo, headline, subtitle, CTA and legal. Proposal opened as unsaved changes; review the roles and boxes.',
    ),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].profileId).toBe(profileId);
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const proposal = JSON.parse(await page.locator('.json-editor').inputValue());
  const byId = Object.fromEntries(proposal.layers.map((l) => [l.id, l]));
  expect(proposal.layers.map((l) => l.id)).toEqual([
    'logo',
    'headline',
    'headline-support',
    'subtitle',
    'cta',
    'legal',
  ]);
  expect(byId.headline).toMatchObject({
    source: 'headline',
    sourcePart: 'first-line',
    fill: '#ffffff',
  });
  // The pale-blue supporting line keeps its sampled colour, as in the hand-made BANNER1 layout.
  expect(byId['headline-support']).toMatchObject({
    source: 'headline',
    sourcePart: 'remaining-lines',
    fill: '#c5e6ff',
    maxLines: 2,
  });
  expect(byId.cta).toMatchObject({ type: 'button', source: 'cta', textFill: '#ffffff' });
  expect(byId.cta.fill).toMatch(/^#d[c-f]1c2[0-9a-f]$/);
  // The button box follows the red pill, wider than the text alone.
  expect(byId.cta.width).toBeGreaterThan(Math.round(0.4133 * 300));
  expect(byId.legal).toMatchObject({ source: 'legal', fontWeight: 'normal', maxLines: 2 });
  expect(proposal.layers.every((l) => l.text === '')).toBe(true);
  // The saved revision is unchanged until the proposal is saved.
  expect((await project(page)).blueprints.find((e) => e.id === 'BANNER1-300x600')).toEqual(
    before.blueprints.find((e) => e.id === 'BANNER1-300x600'),
  );
});

test('Blueprint reference import makes no proposal when Florence is unavailable', async ({
  page,
}) => {
  await page.route('**/api/subjects/vision/capabilities*', (r) =>
    r.fulfill({ json: { florence: { ready: false, message: 'Florence checkpoint is missing.' } } }),
  );
  await page.goto('/blueprints?market=BANNER1');
  await saved(page);
  const before = (await project(page)).blueprints.length;
  await page.getByRole('button', { name: 'New size', exact: true }).click();
  await page
    .getByLabel(/finished banner to suggest a layout/i)
    .setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.getByText('Florence checkpoint is missing.')).toBeVisible();
  expect((await project(page)).blueprints).toHaveLength(before);
  await expect(page).toHaveURL(/\/blueprints\?market=BANNER1/);
});
