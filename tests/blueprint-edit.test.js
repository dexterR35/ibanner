import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, activeRevision, resolveBanner } from '../src/data/defaults.js';
import { saveBlueprintStandard, syncSavedBlueprintFades } from '../src/core/blueprint-edit.js';
import { saveBlueprintFade } from '../src/core/blueprint-fade.js';
import { applyBlueprintCorrections } from '../src/core/blueprint-corrections.js';
import { validateProject } from '../src/core/storage.js';
import { createFadeMesh } from '../src/core/fade-mesh.js';

const layer = (bp, id) => bp.layers.find((l) => l.id === id);
function fixture() {
  const project = initialProject(),
    entry = project.blueprints.find((e) => e.id === 'BANNER2-300x600');
  const local = structuredClone(resolveBanner(entry, project.banners[entry.id]));
  Object.assign(layer(local, 'headline'), { textOverride: 'LOCAL COPY', fill: '#abcdef' });
  Object.assign(layer(local, 'hero'), { focalX: 0.72, focalY: 0.3, zoom: 2 });
  project.banners[entry.id].override = local;
  return { project, entry, local };
}

test('saving a standard merges edited fields into its banner and preserves local content, crops, history and other markets', () => {
  const { project, entry, local } = fixture(),
    before = structuredClone(project);
  const bp = structuredClone(activeRevision(entry).blueprint);
  layer(bp, 'headline').x += 17;
  layer(bp, 'headline').width -= 20;
  layer(bp, 'hero').fadeMesh = createFadeMesh();
  const result = saveBlueprintStandard(project, entry.id, bp);
  const updatedEntry = result.blueprints.find((e) => e.id === entry.id);
  const actual = resolveBanner(updatedEntry, result.banners[entry.id]);
  assert.equal(layer(actual, 'headline').x, layer(bp, 'headline').x);
  assert.equal(layer(actual, 'headline').width, layer(bp, 'headline').width);
  assert.equal(layer(actual, 'headline').textOverride, 'LOCAL COPY');
  assert.equal(layer(actual, 'headline').fill, '#abcdef');
  assert.equal(layer(actual, 'hero').focalX, 0.72);
  assert.equal(layer(actual, 'hero').zoom, 2);
  assert.deepEqual(layer(actual, 'hero').fadeMesh, layer(bp, 'hero').fadeMesh);
  assert.deepEqual(updatedEntry.versions.slice(0, -1), entry.versions);
  assert.equal(result.banners[entry.id].history.length, 2);
  assert.deepEqual(result.banners[entry.id].history[0].blueprint, local);
  for (const id of Object.keys(project.banners))
    if (id !== entry.id) assert.equal(result.banners[id], project.banners[id]);
  assert.equal(result.campaigns, project.campaigns);
  assert.equal(result.assets, project.assets);
  assert.deepEqual(project, before);
  assert.equal(saveBlueprintStandard(result, entry.id, bp), result);
  validateProject(result);
  assert.equal(applyBlueprintCorrections(result), result);
  const fadeChange = structuredClone(bp);
  layer(fadeChange, 'hero').fadeMesh.softness = 0.4;
  const fadeResult = saveBlueprintFade(result, entry.id, fadeChange);
  assert.equal(applyBlueprintCorrections(fadeResult), fadeResult);
});

test('new, removed and reordered standard layers and GIF timing reach Studio without losing extra local layers', () => {
  const { project, entry, local } = fixture();
  local.layers.push({
    ...layer(local, 'subtitle'),
    id: 'local-only',
    source: 'custom',
    text: 'Local',
  });
  const bp = structuredClone(activeRevision(entry).blueprint);
  const extra = { ...layer(bp, 'subtitle'), id: 'standard-extra', name: 'Extra text' };
  bp.layers = [extra, ...bp.layers.filter((l) => l.id !== 'subtitle').reverse()];
  bp.mode = 'animated';
  bp.scenes[0].durationMs = 2300;
  bp.scenes[0].tracks = {};
  const next = saveBlueprintStandard(project, entry.id, bp);
  const updated = resolveBanner(
    next.blueprints.find((e) => e.id === entry.id),
    next.banners[entry.id],
  );
  assert.deepEqual(
    updated.layers.map((l) => l.id),
    [...bp.layers.map((l) => l.id), 'local-only'],
  );
  assert.equal(updated.mode, 'animated');
  assert.equal(updated.scenes[0].durationMs, 2300);
  validateProject(next);
  for (const patch of [{ width: 400 }, { marketId: 'BANNER1' }, { id: 'different' }])
    assert.throws(
      () => saveBlueprintStandard(project, entry.id, { ...bp, ...patch }),
      /Add a new size/,
    );
});

test('older saved mesh standards reach only the active market once, preserving existing overrides and later local fades', () => {
  const { project, entry, local } = fixture();
  for (const target of [entry, project.blueprints.find((e) => e.id === 'BANNER1-300x250')]) {
    const bp = structuredClone(activeRevision(target).blueprint);
    layer(bp, 'hero').fadeMesh = createFadeMesh();
    layer(bp, 'hero').fadeDirection = 'bottom';
    layer(bp, 'headline').x += 20; // The legacy migration must only adopt fades.
    const revision = {
      ...activeRevision(target),
      id: `legacy-${target.id}`,
      number: 2,
      blueprint: bp,
    };
    target.versions.push(revision);
    target.activeVersionId = revision.id;
  }
  const next = syncSavedBlueprintFades(project, 'BANNER2');
  assert.equal(next.banners['BANNER1-300x250'], project.banners['BANNER1-300x250']);
  const actual = resolveBanner(entry, next.banners[entry.id]);
  assert.deepEqual(layer(actual, 'headline'), layer(local, 'headline'));
  assert.equal(layer(actual, 'hero').focalX, 0.72);
  assert.equal(layer(actual, 'hero').fadeDirection, 'bottom');
  assert.deepEqual(layer(actual, 'hero').fadeMesh, createFadeMesh());
  assert.equal(syncSavedBlueprintFades(next, 'BANNER2'), next);
  layer(next.banners[entry.id].override, 'hero').fadeMesh.softness = 0.9;
  assert.equal(syncSavedBlueprintFades(next, 'BANNER2'), next);
  validateProject(next);
});

test('standard typography changes keep locally overridden font bounds valid', () => {
  const { project, entry, local } = fixture();
  Object.assign(layer(local, 'headline'), { fontSize: 70, minFontSize: 60 });
  const bp = structuredClone(activeRevision(entry).blueprint);
  layer(bp, 'headline').fontSize = 20;
  layer(bp, 'headline').minFontSize = 10;
  const next = saveBlueprintStandard(project, entry.id, bp);
  const merged = resolveBanner(
    next.blueprints.find((e) => e.id === entry.id),
    next.banners[entry.id],
  );
  assert(layer(merged, 'headline').minFontSize <= layer(merged, 'headline').fontSize);
  validateProject(next);
});
