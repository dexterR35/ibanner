import { test, expect } from '@playwright/test';
import { readBlueprint } from './helpers/editor.js';

const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

test('blueprint image fade and shadow are editable, saved per size and shared with PNG export', async ({
  page,
}) => {
  // Banners start without a photo; upload one so the image effects have pixels to show.
  await page.goto('/campaign?market=BANNER3');
  await saved(page);
  await page.getByLabel('Auto find subject on upload').uncheck();
  await page
    .locator('.upload-zone input')
    .first()
    .setInputFiles('tests/fixtures/photo-300x600.png');
  await expect(page.getByText('photo-300x600.png added. Original preserved.')).toBeVisible();
  await saved(page);
  await page.goto('/blueprints/BANNER3-300x250/edit?market=BANNER3');
  await page.getByRole('button', { name: 'hero', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Fade shape', exact: true })).toHaveValue('mesh');
  await expect(page.getByLabel('Fade points', { exact: true })).toHaveValue('16');
  const before = await readBlueprint(page);
  expect(before.layers[0].fadeDirection).toBe('left');
  await page.getByRole('checkbox', { name: 'Image shadow', exact: true }).check();
  await page.getByLabel('Shadow color', { exact: true }).fill('#ee4466');
  await page.getByLabel('Shadow horizontal', { exact: true }).fill('-12');
  await page.getByLabel('Shadow blur', { exact: true }).fill('15');
  await page.getByRole('slider', { name: 'Fade softness', exact: true }).fill('0.4');
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).click();
  await saved(page);
  await page.goto('/campaign/BANNER3-300x250/edit?market=BANNER3');
  await page.getByRole('button', { name: 'hero', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Image shadow', exact: true })).toBeChecked();
  const result = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { resolveBanner } = await import('/src/data/defaults.js');
    const { renderFrame, canvasOf } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const p = await loadProject(),
      e = p.blueprints.find((e) => e.id === 'BANNER3-300x250'),
      bp = resolveBanner(e, p.banners[e.id]),
      r = await loadResources(p.campaigns.BANNER3);
    // Each step draws on its own canvas, as Studio's preview and the exporter do.
    const read = (canvas) => canvas.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
    const rendered = (blueprint) => {
      const canvas = canvasOf(bp.width, bp.height);
      renderFrame(canvas, blueprint, p.campaigns.BANNER3, r);
      return read(canvas);
    };
    const decoded = async (blob) => {
      const canvas = canvasOf(bp.width, bp.height);
      const image = await createImageBitmap(blob);
      canvas.getContext('2d').drawImage(image, 0, 0);
      image.close();
      return read(canvas);
    };
    // Chromium rasterizes the first shadow blur of a fresh page up to 4/255 differently;
    // every later draw, including the exporter's, is identical. Warm up once before comparing.
    rendered(bp);
    const a = rendered(bp);
    const b = await decoded(await renderOutput(bp, p.campaigns.BANNER3, r));
    const off = structuredClone(bp);
    off.layers[0].shadow.enabled = false;
    const noShadow = rendered(off);
    const gifPixels = await decoded(await renderOutput(bp, p.campaigns.BANNER3, r, 'gif'));
    const gifError =
      a.reduce((sum, value, i) => sum + Math.abs(value - gifPixels[i]), 0) / a.length;
    const other = p.blueprints.find((e) => e.id === 'BANNER3-180x150');
    return {
      equal: a.every((v, i) => v === b[i]),
      effect: a.some((v, i) => v !== noShadow[i]),
      otherShadow: resolveBanner(other, p.banners[other.id]).layers[0].shadow,
      versions: e.versions.length,
      gifError,
    };
  });
  expect(result.equal).toBe(true);
  expect(result.effect).toBe(true);
  expect(result.otherShadow).toBeUndefined();
  expect(result.versions).toBe(2);
  expect(result.gifError).toBeLessThan(6);
});

test('Banner 3 sizes keep native boxes and export exactly the preview pixels', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/campaign?market=BANNER3');
  await saved(page);
  await expect(page.locator('.banner-card')).toHaveCount(11);
  await expect(page.getByRole('button', { name: 'Match blueprints', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.banner-card canvas').first()).toBeVisible();
  const result = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { activeRevision } = await import('/src/data/defaults.js');
    const { arrangeMarket } = await import('/src/hooks/useAutoArrange.js');
    const { renderFrame, boundText } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { fitText } = await import('/src/core/text-fit.js');
    const project = await loadProject(),
      campaign = project.campaigns.BANNER3;
    const resources = await loadResources(campaign);
    const entries = project.blueprints.filter((e) => e.marketId === 'BANNER3');
    const arranged = arrangeMarket(project, 'BANNER3', resources);
    const changed = {
      ...project,
      campaigns: {
        ...project.campaigns,
        BANNER3: {
          ...campaign,
          headline: 'A much longer offer headline for every Banner 3 format',
        },
      },
    };
    const long = arrangeMarket(changed, 'BANNER3', resources);
    const checks = [];
    for (const entry of entries) {
      const bp = activeRevision(entry).blueprint;
      const canvas = document.createElement('canvas');
      canvas.width = bp.width;
      canvas.height = bp.height;
      renderFrame(canvas, bp, campaign, resources);
      const exported = await createImageBitmap(await renderOutput(bp, campaign, resources));
      const copy = document.createElement('canvas');
      copy.width = bp.width;
      copy.height = bp.height;
      copy.getContext('2d').drawImage(exported, 0, 0);
      exported.close();
      const a = canvas.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
      const b = copy.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
      checks.push({
        id: entry.id,
        equal: a.every((v, i) => v === b[i]),
        boxes:
          JSON.stringify(bp.layers) ===
          JSON.stringify(arranged.banners[entry.id].arrangement.layers),
        longBoxes:
          JSON.stringify(bp.layers) === JSON.stringify(long.banners[entry.id].arrangement.layers),
        fits: bp.layers
          .filter((l) => l.type === 'text')
          .every(
            (l) => !fitText(canvas.getContext('2d'), boundText(l, campaign), l, resources).overflow,
          ),
      });
    }
    return {
      checks,
      fiUnchanged:
        JSON.stringify(project.banners['BANNER1-300x250']) ===
        JSON.stringify(arranged.banners['BANNER1-300x250']),
    };
  });
  expect(result.fiUnchanged).toBe(true);
  expect(result.checks).toHaveLength(11);
  for (const check of result.checks) {
    expect(check.equal, check.id).toBe(true);
    expect(check.boxes, check.id).toBe(true);
    expect(check.longBoxes, check.id).toBe(true);
    expect(check.fits, check.id).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('Banner 3 shows nine GIF groups with editable parts, durations and persistent local timing', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER3');
  await saved(page);
  await expect(page.locator('.banner-card')).toHaveCount(11);
  await expect(page.locator('.gif-artboard-group')).toHaveCount(9);
  await expect(page.locator('.gif-part')).toHaveCount(21);
  await page.goto('/campaign/BANNER3-170x100/edit?market=BANNER3');
  const bp = await readBlueprint(page);
  expect(bp.scenes.map((s) => s.name)).toEqual(['Headline', 'Offer', 'Legal']);
  bp.scenes[1].durationMs = 3500;
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.locator('.json-editor').fill(JSON.stringify(bp));
  await page.getByRole('button', { name: 'Validate and apply', exact: true }).click();
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  const stored = await page.evaluate(async () => {
    const p = await (await import('/src/core/storage.js')).loadProject();
    return {
      banner: p.banners['BANNER3-170x100'].override,
      standard: p.blueprints.find((e) => e.id === 'BANNER3-170x100').versions[0].blueprint,
    };
  });
  expect(stored.banner.scenes[1].durationMs).toBe(3500);
  expect(stored.standard.scenes[1].durationMs).toBe(2000);
});

test('every Banner 3 layout has deterministic scene pixels and matching GIF frames and timing', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER3');
  await saved(page);
  const checks = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { BANNER3_LAYOUTS, createBanner3Blueprint } = await import('/src/data/banner3.js');
    const { renderFrame, canvasOf } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { sceneStart } = await import('/src/core/timeline.js');
    const p = await loadProject(),
      campaign = p.campaigns.BANNER3,
      resources = await loadResources(campaign);
    const checks = [];
    for (const layout of BANNER3_LAYOUTS) {
      const bp = createBanner3Blueprint(layout);
      const gif = await renderOutput(bp, campaign, resources, 'gif');
      const decoder = new ImageDecoder({ data: await gif.arrayBuffer(), type: 'image/gif' });
      await decoder.tracks.ready;
      const errors = [],
        durations = [];
      for (let i = 0; i < bp.scenes.length; i++) {
        const canvas = canvasOf(bp.width, bp.height);
        renderFrame(canvas, bp, campaign, resources, sceneStart(bp, i) + 1);
        const expected = canvas.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
        const frame = (await decoder.decode({ frameIndex: i })).image;
        durations.push(frame.duration / 1000);
        const decoded = canvasOf(bp.width, bp.height);
        decoded.getContext('2d').drawImage(frame, 0, 0);
        frame.close();
        const actual = decoded.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
        errors.push(
          expected.reduce((sum, v, j) => sum + Math.abs(v - actual[j]), 0) / actual.length,
        );
      }
      const a = canvasOf(bp.width, bp.height),
        b = canvasOf(bp.width, bp.height);
      renderFrame(a, bp, campaign, resources, 0);
      await new Promise((resolve) => setTimeout(resolve, 15));
      renderFrame(b, bp, campaign, resources, 0);
      checks.push({
        id: layout.id,
        frames: decoder.tracks.selectedTrack.frameCount,
        expected: bp.scenes.length,
        durations,
        expectedDurations: bp.scenes.map((s) => s.durationMs),
        errors,
        stable: a.toDataURL() === b.toDataURL(),
      });
      decoder.close();
    }
    return checks;
  });
  expect(checks).toHaveLength(11);
  for (const c of checks) {
    expect(c.frames, c.id).toBe(c.expected);
    expect(c.durations, c.id).toEqual(c.expectedDurations);
    expect(c.stable, c.id).toBe(true);
    for (const error of c.errors) expect(error, c.id).toBeLessThan(6);
  }
});

test('existing workspaces gain missing Banner 3 sizes and keep edits after reload', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  const before = await page.evaluate(async () => {
    const { loadProject, saveProject } = await import('/src/core/storage.js');
    const p = await loadProject();
    p.markets = p.markets.filter((m) => m.id !== 'BANNER3');
    delete p.campaigns.BANNER3;
    p.blueprints = p.blueprints.filter((e) => e.marketId !== 'BANNER3');
    p.banners = Object.fromEntries(
      Object.entries(p.banners).filter(([id]) => !id.startsWith('BANNER3')),
    );
    await saveProject(p);
    return p.blueprints;
  });
  await page.goto('/blueprints?market=BANNER3');
  await expect(page.locator('.blueprint-card')).toHaveCount(11);
  await saved(page);
  expect(
    await page.evaluate(async () => {
      const { loadProject } = await import('/src/core/storage.js');
      return (await loadProject()).blueprints.filter((e) => e.marketId !== 'BANNER3');
    }),
  ).toEqual(before);
  await page.goto('/blueprints/BANNER3-300x250?market=BANNER3');
  await expect(page.getByRole('link', { name: 'Open original' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
  await expect(page.locator('.editor')).toBeVisible();
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const json = page.locator('.json-editor');
  const bp = JSON.parse(await json.inputValue());
  bp.layers.find((l) => l.id === 'headline').textOverride = 'LOCAL OFFER';
  await json.fill(JSON.stringify(bp));
  await page.getByRole('button', { name: 'Validate and apply', exact: true }).click();
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await saved(page);
  await page.reload();
  await saved(page);
  const stored = await page.evaluate(async () => {
    const { loadProject } = await import('/src/core/storage.js');
    return await loadProject();
  });
  expect(
    stored.banners['BANNER3-300x250'].override.layers.find((l) => l.id === 'headline').textOverride,
  ).toBe('LOCAL OFFER');
  expect(stored.blueprints.filter((e) => e.marketId === 'BANNER3')).toHaveLength(11);
  expect(stored.blueprints.filter((e) => e.marketId !== 'BANNER3')).toEqual(before);
});

test('an older saved workspace loads cleaned: no example links, renamed GIF parts, user copy kept', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await saved(page);
  await page.evaluate(async () => {
    const { loadProject, saveProject } = await import('/src/core/storage.js');
    const legacy = await loadProject();
    legacy.campaigns.BANNER3.referencePack = 'oldpack';
    legacy.campaigns.BANNER2.headline = 'KEEP MY COPY';
    for (const e of legacy.blueprints) if (e.measured) e.reference = 'old.png';
    const gif = legacy.blueprints.find((e) => e.id === 'BANNER3-170x100').versions[0].blueprint;
    gif.scenes[0].name = 'Offer';
    gif.scenes[1].name = 'Free spins';
    await saveProject(legacy);
  });
  await page.goto('/campaign?market=BANNER3');
  await saved(page);
  await expect(page.getByRole('combobox', { name: 'Active market' })).toHaveValue('BANNER3');
  await expect(page.locator('.banner-card')).toHaveCount(11);
  const stored = JSON.parse(
    await page.evaluate(async () =>
      JSON.stringify(await (await import('/src/core/storage.js')).loadProject()),
    ),
  );
  expect(JSON.stringify(stored)).not.toMatch(/referencePack|"reference":|free spins/i);
  expect(
    stored.blueprints
      .find((e) => e.id === 'BANNER3-170x100')
      .versions[0].blueprint.scenes.map((s) => s.name),
  ).toEqual(['Headline', 'Offer', 'Legal']);
  expect(stored.campaigns.BANNER2.headline).toBe('KEEP MY COPY');
});
