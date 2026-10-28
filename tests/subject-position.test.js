import test from 'node:test';
import assert from 'node:assert/strict';
import { focusImage, assessSubject, focusBlueprint } from '../src/core/subject-position.js';
import {
  subjectSchema,
  subjectQuery,
  normalizeDetections,
  subjectLabels,
  preferredSubject,
} from '../src/core/subject-data.js';
import {
  createBlueprint,
  initialProject,
  campaignFor,
  DEFAULT_MARKETS,
} from '../src/data/defaults.js';
import { validateProject } from '../src/core/storage.js';
import { validateBlueprint } from '../src/core/schema.js';

test('focus avoids a CTA and fade while preserving the photo frame and master', () => {
  const bp = createBlueprint('BANNER1', 300, 250);
  bp.layers = bp.layers.filter((l) => ['hero', 'cta'].includes(l.id));
  const layer = bp.layers[0];
  Object.assign(layer, {
    x: 0,
    y: 0,
    width: 300,
    height: 250,
    fade: 0.3,
    fadeDirection: 'top',
    zoom: 1,
    focalX: 0.5,
    focalY: 0.5,
  });
  Object.assign(bp.layers[1], { x: 120, y: 70, width: 180, height: 60 });
  const image = { width: 900, height: 900 },
    box = { x: 0.7, y: 0.27, width: 0.12, height: 0.14 };
  const before = structuredClone(bp),
    prior = assessSubject(bp, layer, image, box);
  assert(prior.covered > 0.5);
  const result = focusImage(bp, layer, image, box);
  const after = assessSubject(bp, { ...layer, ...result.patch }, image, box);
  assert(after.covered < 0.01);
  assert(after.clipped < 0.01);
  assert(after.faded < 0.01);
  assert.deepEqual(Object.keys(result.patch).sort(), ['focalX', 'focalY', 'zoom']);
  assert.deepEqual(bp, before);
});

test('impossible cover crops are reported and moving/rotated photo frames are preserved', () => {
  const bp = createBlueprint('BANNER1', 320, 50),
    layer = bp.layers.find((l) => l.id === 'hero');
  const image = { width: 100, height: 1000 },
    box = { x: 0, y: 0, width: 1, height: 1 };
  const result = focusImage(bp, layer, image, box);
  assert(assessSubject(bp, { ...layer, ...result.patch }, image, box).clipped > 0.5);
  layer.rotation = 15;
  assert.deepEqual(focusImage(bp, layer, image, box).patch, {});
});

test('subject metadata is bounded, scoped to the asset, deduplicated and portable', () => {
  const raw = [
    { label: 'person', score: 0.7, box: { xmin: 0.1, ymin: 0.2, xmax: 0.6, ymax: 0.9 } },
    { label: 'person', score: 0.6, box: { xmin: 0.11, ymin: 0.2, xmax: 0.6, ymax: 0.9 } },
    { label: 'human face', score: 0.3, box: { xmin: 0.2, ymin: 0.22, xmax: 0.3, ymax: 0.32 } },
    { label: 'person', score: 0.04, box: { xmin: 0, ymin: 0, xmax: 1, ymax: 1 } },
    { label: 'bad', score: 0.9, box: { xmin: NaN, ymin: 0, xmax: 1, ymax: 1 } },
  ];
  const results = normalizeDetections(raw);
  assert.equal(results.length, 2);
  assert.equal(preferredSubject(results).label, 'human face');
  assert(subjectLabels('person, playing card').includes('human face'));
  results.forEach((r) => subjectSchema.parse(r));
  const p = initialProject(),
    id = 'a'.repeat(64);
  p.assets.push({ id, kind: 'hero', name: 'test.png', type: 'image/png' });
  Object.assign(p.campaigns.BANNER1, {
    heroAssetId: id,
    subjectFocus: { ...results[0], assetId: id },
    subjectSearch: { assetId: id, query: 'person', results },
  });
  assert.deepEqual(
    validateProject(structuredClone(p)).campaigns.BANNER1.subjectFocus,
    p.campaigns.BANNER1.subjectFocus,
  );
  p.campaigns.BANNER1.subjectFocus.box.width = 1;
  assert.throws(() => validateProject(p));
  const bp = createBlueprint('BANNER1', 300, 250),
    c = { ...campaignFor(DEFAULT_MARKETS[0]), subjectFocus: { ...results[1], assetId: id } };
  assert.equal(focusBlueprint(bp, c, { hero: { width: 800, height: 600 } }).blueprint, bp);
});

test('switching GIF off preserves valid animation parts for re-enabling', () => {
  const bp = createBlueprint('BANNER1', 320, 50),
    scenes = structuredClone(bp.scenes);
  bp.mode = 'static';
  assert.deepEqual(validateBlueprint(bp).scenes, scenes);
  bp.mode = 'animated';
  assert.deepEqual(validateBlueprint(bp).scenes, scenes);
});

test('subject providers survive backups while legacy metadata remains valid', () => {
  const p = initialProject(),
    id = 'b'.repeat(64);
  p.assets.push({ id, kind: 'hero', name: 'test.png', type: 'image/png' });
  Object.assign(p.campaigns.BANNER1, {
    heroAssetId: id,
    subjectEngine: 'auto',
    subjectSearch: {
      assetId: id,
      query: 'person',
      results: [],
      engine: 'sam3',
      preference: 'auto',
    },
  });
  assert.deepEqual(
    validateProject(structuredClone(p)).campaigns.BANNER1.subjectSearch,
    p.campaigns.BANNER1.subjectSearch,
  );
  p.campaigns.BANNER1.subjectEngine = 'remote';
  assert.throws(() => validateProject(structuredClone(p)), /Invalid subject finder engine/);
  delete p.campaigns.BANNER1.subjectEngine;
  delete p.campaigns.BANNER1.subjectSearch.engine;
  delete p.campaigns.BANNER1.subjectSearch.preference;
  assert.doesNotThrow(() => validateProject(p));
  assert.equal(subjectQuery(null), 'person');
});
