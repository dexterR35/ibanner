import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialProject,
  createBlueprint,
  resolveBanner,
  activeRevision,
  PRESETS,
  duplicateForSize,
} from '../src/data/defaults.js';
import { validateProject } from '../src/core/storage.js';
import { validateBlueprint } from '../src/core/schema.js';
import { sceneAt, layerAt, totalDuration, animationSamples } from '../src/core/timeline.js';
import { fitText } from '../src/core/text-fit.js';
import { panImage } from '../src/core/image-position.js';
import { cropFor } from '../src/core/render.js';

test('all market seeds and custom size boundaries satisfy the renderer contract', () => {
  const project = initialProject();
  assert.equal(project.blueprints.length, 27);
  for (const e of project.blueprints)
    assert.equal(validateBlueprint(activeRevision(e).blueprint).marketId, e.marketId);
  for (const [w, h] of [...PRESETS, [32, 32], [2048, 32], [32, 2048], [500, 333]])
    assert.equal(createBlueprint('NEW', w, h).width, w);
  assert.equal(project.campaigns.BANNER2.legal, '');
  assert.notDeepEqual(
    createBlueprint('BANNER1', 300, 250).layers,
    createBlueprint('BANNER2', 300, 250).layers,
  );
});
test('GIF cut scenes preserve reference delays and final legal frame', () => {
  for (const [w, h, delays] of [
    [320, 50, [2000, 2000, 1800]],
    [300, 100, [2000, 1800]],
    [728, 90, [3000, 1800]],
  ]) {
    const bp = createBlueprint('BANNER1', w, h);
    assert.deepEqual(
      animationSamples(bp).map((s) => s.delay),
      delays,
    );
    assert.equal(
      totalDuration(bp),
      delays.reduce((a, b) => a + b),
    );
    const ending = sceneAt(bp, totalDuration(bp) - 1);
    assert.equal(ending.index, bp.scenes.length - 1);
    assert.equal(
      layerAt(
        bp.layers.find((l) => l.id === 'legal'),
        ending.scene,
        ending.local,
      ).visible,
      true,
    );
    assert.equal(sceneAt(bp, totalDuration(bp)).index, 0);
  }
});
test('schema rejects duplicate layers, orphan tracks, reversed timing and excessive fades', () => {
  const make = () => createBlueprint('BANNER1', 300, 250);
  let bp = make();
  bp.layers.push(bp.layers[0]);
  assert.throws(() => validateBlueprint(bp));
  bp = make();
  bp.scenes[0].tracks.missing = { visible: true };
  assert.throws(() => validateBlueprint(bp));
  bp = make();
  bp.scenes[0].tracks.hero.startMs = 3500;
  assert.throws(() => validateBlueprint(bp));
  bp = make();
  bp.scenes[0].tracks.hero.fadeInMs = 2000;
  bp.scenes[0].tracks.hero.fadeOutMs = 2000;
  assert.throws(() => validateBlueprint(bp));
});
test('layer in/out/fades and sample boundaries are deterministic', () => {
  const bp = createBlueprint('BANNER1', 300, 250),
    scene = bp.scenes[0],
    hero = bp.layers[0];
  scene.tracks.hero = {
    visible: true,
    startMs: 50,
    endMs: 2250,
    fadeInMs: 200,
    fadeOutMs: 200,
    dx: 20,
    dy: 0,
  };
  assert.equal(layerAt(hero, scene, 49).visible, false);
  assert.equal(layerAt(hero, scene, 150).opacity, 0.5);
  assert.equal(layerAt(hero, scene, 2250).visible, false);
  const samples = animationSamples(bp);
  assert(samples.some((s) => s.time === 50));
  assert(samples.some((s) => s.time === 2250));
  assert.equal(
    samples.reduce((n, s) => n + s.delay, 0),
    3000,
  );
});
test('generated banners remain pinned when a master changes; overrides do not mutate it', () => {
  const project = initialProject(),
    entry = project.blueprints[0],
    banner = project.banners[entry.id],
    original = structuredClone(resolveBanner(entry, banner));
  const next = {
    ...activeRevision(entry),
    id: 'v2',
    number: 2,
    blueprint: structuredClone(original),
  };
  next.blueprint.background = '#ffffff';
  entry.versions.push(next);
  entry.activeVersionId = 'v2';
  assert.deepEqual(resolveBanner(entry, banner), original);
  banner.override = structuredClone(original);
  banner.override.layers[0].opacity = 0.3;
  assert.equal(resolveBanner(entry, banner).layers[0].opacity, 0.3);
  assert.equal(entry.versions[0].blueprint.layers[0].opacity, 1);
});
test('text auto-fit preserves explicit lines and shrinks long legal copy', () => {
  const context = {
    font: '',
    measureText(text) {
      const size = Number(this.font.match(/([\d.]+)px/)[1]);
      return { width: text.length * size * 0.5 };
    },
  };
  const layer = {
    width: 120,
    height: 60,
    fontSize: 24,
    minFontSize: 10,
    maxLines: 2,
    lineHeight: 1,
    fontWeight: 'bold',
  };
  assert.deepEqual(fitText(context, 'ONE\nTWO', layer).lines, ['ONE', 'TWO']);
  assert.equal(
    fitText(context, 'averylongunbreakablelegalsentence', { ...layer, width: 30, minFontSize: 10 })
      .belowMinimum,
    true,
  );
});
test('duplicating to a new market and size preserves the original and scales timing movement', () => {
  const source = createBlueprint('BANNER1', 300, 250),
    original = structuredClone(source);
  source.scenes[0].tracks.hero.dx = 10;
  const next = duplicateForSize(source, 'RO', 600, 500);
  assert.equal(next.id, 'RO-600x500');
  assert.equal(next.layers[1].width, source.layers[1].width * 2);
  assert.equal(next.scenes[0].tracks.hero.dx, 20);
  assert.deepEqual(source.layers, original.layers);
  assert.notEqual(next.scenes[0].id, source.scenes[0].id);
});
test('project imports normalize defaults and reject dangling versions and asset bindings', () => {
  const p = initialProject();
  delete p.blueprints[0].versions[0].blueprint.layers[0].opacity;
  assert.equal(validateProject(p).blueprints[0].versions[0].blueprint.layers[0].opacity, 1);
  p.banners[p.blueprints[0].id].blueprintVersionId = 'missing';
  assert.throws(() => validateProject(p));
  const badAsset = initialProject();
  badAsset.campaigns.BANNER1.heroAssetId = 'missing';
  assert.throws(() => validateProject(badAsset));
});

test('image panning changes only crop focus, clamps coverage and leaves the frame/fade untouched', () => {
  const image = { width: 1600, height: 1200 };
  const layer = createBlueprint('BANNER1', 300, 250).layers[0];
  layer.zoom = 2;
  const original = structuredClone(layer);
  const move = panImage(image, layer, null, 40, -30);
  assert(move.focalX < 0.5 && move.focalY > 0.5);
  assert.deepEqual(layer, original);
  assert.deepEqual(Object.keys(move).sort(), ['focalX', 'focalY']);
  const edge = { ...layer, ...panImage(image, layer, null, -100000, 100000) };
  assert.equal(edge.focalX, 1);
  assert.equal(edge.focalY, 0);
  const [sx, sy, width, height] = cropFor(image, edge);
  assert(sx >= 0 && sy >= 0 && sx + width <= 1600 && sy + height <= 1200);
});

test('panning respects reference-crop bounds, rotation and axes without spare pixels', () => {
  const image = { width: 300, height: 600 };
  const layer = { width: 300, height: 100, zoom: 1, focalX: 0.5, focalY: 0.5, rotation: 0 };
  const crop = [0, 340, 300, 210];
  const move = panImage(image, layer, crop, 50, -20);
  assert.equal(move.focalX, 0.5);
  assert(move.focalY > 0.5);
  const [sx, sy, width, height] = cropFor(image, { ...layer, ...move }, crop);
  assert(sx >= 0 && sx + width <= 300 && sy >= 340 && sy + height <= 550);
  const rotated = panImage(image, { ...layer, rotation: 90 }, crop, 20, 0);
  assert(rotated.focalY > 0.5);
  assert.equal(rotated.focalX, 0.5);
});

test('legacy blueprints retain their appearance and validate bounded opt-in glow', () => {
  const bp = createBlueprint('BANNER1', 300, 250);
  for (const layer of bp.layers) delete layer.glow;
  const parsed = validateBlueprint(bp);
  assert(parsed.layers.every((l) => l.glow.enabled === false));
  const headline = parsed.layers.find((l) => l.id === 'headline');
  headline.glow = { enabled: true, color: '#ff162d', blur: 12, opacity: 0.75 };
  assert.equal(validateBlueprint(parsed).layers.find((l) => l.id === 'headline').glow.blur, 12);
  const duplicated = duplicateForSize(parsed, 'BANNER1', 600, 500);
  assert.equal(duplicated.layers.find((l) => l.id === 'headline').glow.blur, 24);
  headline.glow.opacity = 2;
  assert.throws(() => validateBlueprint(parsed));
});
