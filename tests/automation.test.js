import test from 'node:test';
import assert from 'node:assert/strict';
import { unzlibSync } from 'fflate';
import { contrastRatio, hexToRgb, withContrast } from '../src/core/color.js';
import { extractPalette, suggestColors } from '../src/core/palette.js';
import {
  activeVariants,
  effectiveBox,
  extensionFor,
  extensionFrame,
  heroFor,
  upscaleFor,
} from '../src/core/hero-variants.js';
import { validateBlueprint } from '../src/core/schema.js';
import { placeSubjectInFront, SUBJECT_LAYER_PREFIX } from '../src/core/subject-layer.js';
import { autoAnimate, needsAutoAnimation } from '../src/core/auto-animation.js';
import {
  blueprintFromRegions,
  classifyRegions,
  groupBlocks,
  mergeLines,
  photoRegion,
} from '../src/core/reference-extract.js';
import {
  clearAutomaticHalos,
  glyphContrast,
  haloPasses,
  improveReadability,
  targetFor,
} from '../src/core/readability.js';
import { encodeIndexedPng } from '../src/core/png-palette.js';
import { limitBytes, outputLimitSchema } from '../src/data/output-limits.js';
import { layoutKey } from '../src/core/auto-layout.js';
import { initialProject, createBlueprint, resolveBanner } from '../src/data/defaults.js';
import { validateProject } from '../src/core/storage.js';
import { blueprintFromFlorence } from '../src/core/florence-reference.js';

const H = (c) => c.repeat(64);

test('Florence import uses detected boxes, suggests roles and never copies OCR text', () => {
  const result = {
    schemaVersion: 1,
    engine: 'florence2',
    width: 300,
    height: 250,
    textRegions: [{ text: 'Offer', box: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 } }],
    objects: [{ label: 'person', box: { x: 0.5, y: 0.1, width: 0.3, height: 0.7 } }],
    profileId: H('a'),
    provenance: {
      model: 'florence-community/Florence-2-base-ft',
      revision: 'b'.repeat(40),
      device: 'cpu',
      coordinateSpace: 'normalized-oriented-preview',
      tasks: ['<OCR_WITH_REGION>', '<OD>'],
    },
  };
  const bp = blueprintFromFlorence(result, { marketId: 'BANNER1', width: 600, height: 500 });
  assert.equal(bp.layers.length, 1);
  // The only text is the largest, so it is the suggested headline (Florence keeps 1:1 sizing).
  assert.deepEqual(
    bp.layers.map(({ x, y, width, height, source, fontSize }) => ({
      x,
      y,
      width,
      height,
      source,
      fontSize,
    })),
    [{ x: 120, y: 150, width: 240, height: 50, source: 'headline', fontSize: 50 }],
  );
  assert.match(bp.layers[0].name, /^Headline · largest text · “Offer”$/);
  assert.equal(bp.layers[0].text, '');
  assert.throws(
    () =>
      blueprintFromFlorence(
        { ...result, textRegions: [] },
        { marketId: 'BANNER1', width: 600, height: 500 },
      ),
    /no text regions/i,
  );
  assert.throws(() =>
    blueprintFromFlorence(
      { ...result, engine: 'opencv' },
      { marketId: 'BANNER1', width: 600, height: 500 },
    ),
  );
});

test('WCAG contrast maths and contrast-seeking colour adjustment', () => {
  assert.equal(Math.round(contrastRatio([255, 255, 255], [0, 0, 0])), 21);
  assert.equal(contrastRatio([10, 10, 10], [10, 10, 10]), 1);
  const lifted = withContrast([120, 20, 30], hexToRgb('#070d1d'), 4.5);
  assert.ok(contrastRatio(lifted, hexToRgb('#070d1d')) >= 4.5);
  assert.equal(targetFor(20, true), 3);
  assert.equal(targetFor(12, true), 4.5);
});

test('palette extraction is deterministic, weighted and suggests readable colours', () => {
  const pixels = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i++) pixels.set(i < 70 ? [10, 12, 30, 255] : [220, 30, 40, 255], i * 4);
  const first = extractPalette(pixels, { k: 3 });
  assert.deepEqual(first, extractPalette(pixels, { k: 3 }));
  assert.equal(first.length, 2);
  assert.equal(first[0].color, '#0a0c1e');
  assert.ok(Math.abs(first[0].weight - 0.7) < 1e-9);
  const { accent, cta } = suggestColors(first, '#070d1d');
  assert.ok(contrastRatio(hexToRgb(accent), hexToRgb('#070d1d')) >= 3);
  assert.ok(contrastRatio(hexToRgb(cta), [255, 255, 255]) >= 4.5);
});

test('image variants apply only to the current image and map subject boxes', () => {
  const campaign = {
    heroAssetId: H('a'),
    heroUpscale: { assetId: H('b'), sourceAssetId: H('a'), scale: 2, engine: 'x' },
    heroExtendWide: {
      assetId: H('c'),
      sourceAssetId: H('b'),
      frame: { x: 0.25, y: 0, width: 0.5, height: 1 },
      engine: 'x',
    },
    heroExtendTall: {
      assetId: H('d'),
      sourceAssetId: H('f'),
      frame: { x: 0, y: 0, width: 1, height: 1 },
      engine: 'x',
    },
    heroCutout: {
      assetId: H('e'),
      sourceAssetId: H('9'),
      box: { x: 0, y: 0, width: 1, height: 1 },
      label: 'p',
      engine: 'x',
    },
  };
  const variants = activeVariants(campaign);
  assert.equal(variants.upscale.assetId, H('b'));
  assert.equal(variants.wide.assetId, H('c'));
  assert.equal(variants.tall, null, 'derived from an unrelated image');
  assert.equal(variants.cutout, null, 'stale cut-out from a replaced image');
  assert.deepEqual(
    effectiveBox({ x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, campaign.heroExtendWide.frame),
    {
      x: 0.5,
      y: 0.5,
      width: 0.1,
      height: 0.2,
    },
  );
  const resources = { hero: { width: 300, height: 200 }, heroWide: { image: 'wide', frame: {} } };
  assert.equal(heroFor({ width: 728, height: 90 }, resources).image, 'wide');
  assert.equal(heroFor({ width: 300, height: 250 }, resources).image, resources.hero);
  assert.equal(
    heroFor({ width: 160, height: 600 }, resources).image,
    resources.hero,
    'no tall variant',
  );
});

test('extension and upscale needs follow the market frames', () => {
  const needs = extensionFor(
    [
      { width: 728, height: 90 },
      { width: 160, height: 600 },
    ],
    300,
    200,
  );
  assert.ok(needs.wide.left > 0 && needs.wide.left === needs.wide.right && needs.wide.top === 0);
  assert.ok(needs.tall.top > 0 && needs.tall.left === 0);
  assert.equal(needs.wide.left + needs.wide.right, 1.5, 'growth is capped');
  assert.deepEqual(extensionFor([{ width: 300, height: 200 }], 300, 200), {
    wide: null,
    tall: null,
  });
  const frame = extensionFrame({ left: 0.5, right: 0.5, top: 0, bottom: 0 });
  assert.deepEqual(frame, { x: 0.25, y: 0, width: 0.5, height: 1 });
  assert.equal(upscaleFor([{ width: 300, height: 250, zoom: 1 }], 600, 500), null);
  assert.equal(upscaleFor([{ width: 300, height: 600, zoom: 1 }], 200, 400), 2);
  assert.equal(upscaleFor([{ width: 970, height: 250, zoom: 1.5 }], 300, 200), 4);
});

test('cut-out layers must follow an image placed below them', () => {
  const bp = createBlueprint('BANNER1', 300, 600);
  const cutout = {
    id: 'c',
    name: 'Subject',
    type: 'cutout',
    source: 'hero',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  };
  assert.throws(() =>
    validateBlueprint({ ...bp, layers: [{ ...cutout, linkedLayerId: 'hero' }, ...bp.layers] }),
  );
  assert.throws(() =>
    validateBlueprint({ ...bp, layers: [...bp.layers, { ...cutout, linkedLayerId: 'headline' }] }),
  );
  assert.equal(
    validateBlueprint({
      ...bp,
      layers: [...bp.layers, { ...cutout, linkedLayerId: 'hero' }],
    }).layers.at(-1).type,
    'cutout',
  );
});

test('subject goes in front of overlapping copy only, and re-application is idempotent', () => {
  const bp = createBlueprint('BANNER1', 300, 600);
  const photo = bp.layers.find((l) => l.id === 'hero');
  const image = { width: 1000, height: 1000 };
  const campaign = {
    heroAssetId: H('a'),
    subjectInFront: true,
    heroCutout: {
      assetId: H('e'),
      sourceAssetId: H('a'),
      box: { x: 0, y: 0, width: 1, height: 1 },
      label: 'p',
      engine: 'x',
    },
  };
  const resources = {
    hero: image,
    heroCrop: null,
    cutout: { image, box: campaign.heroCutout.box },
  };
  // Move the headline over the photo so the subject overlaps it.
  const overlapping = {
    ...bp,
    layers: bp.layers.map((l) => (l.id === 'headline' ? { ...l, y: photo.y + 10 } : l)),
  };
  const once = placeSubjectInFront(overlapping, campaign, resources);
  const inserted = once.layers.findIndex((l) => l.id.startsWith(SUBJECT_LAYER_PREFIX));
  assert.ok(inserted > once.layers.findIndex((l) => l.id === 'headline'));
  assert.ok(inserted < once.layers.findIndex((l) => l.id === 'cta'));
  validateBlueprint(once);
  assert.deepEqual(placeSubjectInFront(once, campaign, resources), once);
  // Copy that never meets the subject leaves the layout untouched.
  assert.equal(placeSubjectInFront(bp, campaign, resources).layers.length, bp.layers.length);
  const off = placeSubjectInFront(once, { ...campaign, subjectInFront: false }, resources);
  assert.equal(off.layers.length, bp.layers.length);
});

test('automatic GIF parts follow the BANNER1 rhythm and keep legal visible', () => {
  const bp = { ...createBlueprint('BANNER1', 300, 250), mode: 'static' };
  const single = { ...bp, scenes: [{ ...bp.scenes[0], tracks: {} }] };
  assert.equal(needsAutoAnimation(single), true);
  const campaign = { headline: 'A', subtitle: 'B', cta: 'Go', legal: '18+' };
  const animated = validateBlueprint(autoAnimate(single, campaign));
  assert.equal(animated.mode, 'animated');
  assert.ok(animated.scenes.length >= 2);
  assert.deepEqual(
    animated.scenes.slice(-1).map((s) => s.durationMs),
    [1800],
  );
  for (const scene of animated.scenes) assert.notEqual(scene.tracks.legal?.visible, false);
  assert.equal(animated.scenes[0].tracks.subtitle.visible, false);
  // Without subtitle copy the offer part is skipped.
  const noOffer = autoAnimate(single, { ...campaign, subtitle: '' });
  assert.ok(!noOffer.scenes.some((s) => s.name === 'The offer'));
  assert.equal(needsAutoAnimation(animated), false);
  // Seed layouts store explicit always-visible tracks; those still count as undesigned.
  assert.equal(needsAutoAnimation(createBlueprint('BANNER1', 300, 250)), true);
  const hidden = createBlueprint('BANNER1', 300, 50);
  assert.equal(needsAutoAnimation(hidden), false, 'a deliberately hidden layer is a design');
});

test('banner layout extraction groups text and builds a valid draft blueprint', () => {
  const rects = [
    { x: 100, y: 20, width: 40, height: 30 },
    { x: 145, y: 22, width: 60, height: 28 },
    { x: 60, y: 100, width: 180, height: 26 },
    { x: 60, y: 130, width: 170, height: 26 },
    { x: 40, y: 560, width: 220, height: 9 },
    { x: 60, y: 572, width: 180, height: 9 },
    { x: 10, y: 400, width: 12, height: 12 }, // compact blob: photo texture
  ];
  const lines = mergeLines(rects);
  assert.equal(lines.length, 5);
  const blocks = groupBlocks(lines);
  assert.equal(blocks.length, 3);
  const grid = {
    cols: 10,
    rows: 20,
    cell: 30,
    values: Array.from({ length: 200 }, (_, i) => (i >= 110 && i < 180 ? 1 : 0)),
  };
  const photo = photoRegion(grid, 300, 600);
  assert.equal(photo.y, 330);
  assert.equal(photo.fadeDirection, 'top');
  const roles = classifyRegions({
    width: 300,
    height: 600,
    blocks,
    logo: null,
    button: { x: 70, y: 250, width: 160, height: 40 },
    photo,
  });
  assert.ok(roles.logo && roles.logo.y === 20);
  assert.equal(roles.headline.y, 100);
  assert.equal(roles.legal.y, 560);
  const bp = blueprintFromRegions(roles, { marketId: 'BANNER1', background: '#040c1c' });
  assert.equal(bp.id, 'BANNER1-300x600');
  assert.deepEqual(
    bp.layers.map((l) => l.source),
    ['hero', 'logo', 'headline', 'cta', 'legal'],
  );
  assert.equal(bp.layers.find((l) => l.id === 'cta').radius, 20);
});

test('readability measures glyph contrast and manages only automatic halos', () => {
  const background = new Uint8ClampedArray([250, 250, 250, 255, 20, 20, 20, 255]);
  const mask = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
  assert.ok(glyphContrast(background, mask, '#ffffff') < 1.1, 'white text over a white patch');
  const bp = createBlueprint('BANNER1', 300, 250);
  const results = [
    { id: 'headline', pass: false, target: 3 },
    { id: 'subtitle', pass: true, target: 3 },
  ];
  const fixed = improveReadability(bp, results);
  const halo = fixed.layers.find((l) => l.id === 'headline').glow;
  assert.equal(halo.enabled, true);
  assert.equal(halo.auto, true);
  assert.equal(halo.color, bp.background);
  assert.ok(
    haloPasses(
      fixed.layers.find((l) => l.id === 'headline'),
      3,
    ),
  );
  validateBlueprint(fixed);
  const designed = {
    ...bp,
    layers: bp.layers.map((l) =>
      l.id === 'headline'
        ? { ...l, glow: { enabled: true, color: '#ff162d', blur: 8, opacity: 0.85 } }
        : l,
    ),
  };
  assert.equal(
    improveReadability(designed, results).layers.find((l) => l.id === 'headline').glow.color,
    '#ff162d',
  );
  assert.equal(
    clearAutomaticHalos(fixed).layers.find((l) => l.id === 'headline').glow.enabled,
    false,
  );
  assert.equal(clearAutomaticHalos(designed), designed);
});

test('indexed PNG encoder writes a valid palette image', async () => {
  const blob = encodeIndexedPng(
    new Uint8Array([0, 1, 1, 0]),
    [
      [255, 0, 0],
      [0, 0, 255],
    ],
    2,
    2,
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const text = new TextDecoder('latin1').decode(bytes);
  assert.ok(text.includes('IHDR') && text.includes('PLTE') && text.includes('IDAT'));
  const start = text.indexOf('IDAT') + 4,
    length = new DataView(bytes.buffer).getUint32(start - 8);
  assert.deepEqual([...unzlibSync(bytes.slice(start, start + length))], [0, 0, 1, 0, 1, 0]);
});

test('file-size limits are configurable data', () => {
  assert.equal(limitBytes(null), null);
  assert.equal(limitBytes({ preset: 'none', maxKB: null }), null);
  assert.equal(limitBytes(outputLimitSchema.parse({ preset: 'custom', maxKB: 90 })), 92160);
  assert.throws(() => outputLimitSchema.parse({ preset: 'custom', maxKB: 1 }));
});

test('derived assets and automatic settings validate with backups', () => {
  const project = initialProject();
  const campaign = project.campaigns.BANNER1;
  const base = layoutKey(campaign);
  project.assets.push(
    { id: H('a'), name: 'hero.png', kind: 'hero', type: 'image/png' },
    {
      id: H('b'),
      name: 'hero-cutout.png',
      kind: 'derived',
      type: 'image/png',
      derivedFrom: H('a'),
      operation: 'cutout',
    },
  );
  Object.assign(campaign, {
    heroAssetId: H('a'),
    heroCutout: {
      assetId: H('b'),
      sourceAssetId: H('a'),
      box: { x: 0.1, y: 0.1, width: 0.5, height: 0.8 },
      label: 'person',
      engine: 'sam3+birefnet',
    },
    subjectInFront: true,
    autoReadability: true,
    ctaColor: '#cc1122',
    outputLimit: { preset: 'display-150', maxKB: 150 },
  });
  const valid = validateProject(structuredClone(project));
  assert.equal(valid.campaigns.BANNER1.heroCutout.engine, 'sam3+birefnet');
  assert.notEqual(layoutKey(valid.campaigns.BANNER1), base);
  const missing = structuredClone(project);
  missing.assets.pop();
  assert.throws(() => validateProject(missing), /generated image binding/);
  const badOperation = structuredClone(project);
  badOperation.assets[1].operation = 'paint';
  assert.throws(() => validateProject(badOperation), /asset metadata/);
  const badColor = structuredClone(project);
  badColor.campaigns.BANNER1.ctaColor = 'red';
  assert.throws(() => validateProject(badColor), /CTA color/);
  // Existing campaigns without the new fields still validate unchanged.
  assert.equal(validateProject(initialProject()).campaigns.BANNER1.autoReadability, undefined);
  assert.ok(resolveBanner(valid.blueprints[0], valid.banners[valid.blueprints[0].id]));
});

test('a face focus cuts out the whole person that contains it', async () => {
  const { cutoutTarget } = await import('../src/core/subject-data.js');
  const face = {
    id: 'f',
    label: 'human face',
    source: 'detected',
    box: { x: 0.75, y: 0.37, width: 0.04, height: 0.06 },
  };
  const results = [
    face,
    {
      id: 'a',
      label: 'person',
      score: 0.98,
      source: 'detected',
      box: { x: 0.02, y: 0.1, width: 0.47, height: 0.8 },
    },
    {
      id: 'b',
      label: 'person',
      score: 0.97,
      source: 'detected',
      box: { x: 0.57, y: 0.3, width: 0.3, height: 0.4 },
    },
  ];
  assert.deepEqual(cutoutTarget(face, results), { box: results[2].box, label: 'person' });
  assert.deepEqual(cutoutTarget(face, [face]), { box: face.box, label: 'human face' });
  const manual = { id: 'manual', label: 'Manual focus', source: 'manual', box: face.box };
  assert.equal(cutoutTarget(manual, results).label, null);
  assert.equal(cutoutTarget(null, results), null);
});
