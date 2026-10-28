import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, activeRevision, resolveBanner } from '../src/data/defaults.js';
import { migrateLineSpacing } from '../src/core/line-spacing.js';
import { validateProject } from '../src/core/storage.js';
import { syncSavedBlueprintFades } from '../src/core/blueprint-edit.js';
import { createFadeMesh } from '../src/core/fade-mesh.js';

const normalized = (bp) => ({ ...bp, layers: bp.layers.map((l) => ({ ...l, lineHeight: 1 })) });

test('all markets, active blueprints, drafts, overrides and arrangements adopt spacing 1 without changing geometry or history', () => {
  const project = initialProject();
  project.blueprints.forEach((entry, index) => {
    const active = activeRevision(entry);
    active.blueprint.layers.forEach((l) => {
      l.lineHeight = index % 2 ? 1.05 : 1.3;
    });
    if (index === 0) active.origin = 'blueprint-editor';
    if (index === 1) active.status = 'published';
    entry.draft = structuredClone(active.blueprint);
    const b = project.banners[entry.id];
    if (index % 2) {
      b.override = structuredClone(active.blueprint);
      b.override.layers.find((l) => l.id === 'headline').textOverride = 'LOCAL WORDS';
      b.override.layers[0].focalX = 0.7;
      b.arrangement = structuredClone(b.override);
      b.arrangement.layers.find((l) => l.id === 'headline').x += 3;
      b.history.push({ id: `history-${index}`, blueprint: structuredClone(b.override) });
    }
  });
  const before = structuredClone(project),
    next = migrateLineSpacing(project);
  assert.deepEqual(project, before);
  assert.equal(next.campaigns, project.campaigns);
  assert.equal(next.assets, project.assets);
  for (const entry of next.blueprints) {
    const old = project.blueprints.find((e) => e.id === entry.id);
    assert.deepEqual(entry.versions.slice(0, -1), old.versions);
    assert.deepEqual(activeRevision(entry).blueprint, normalized(activeRevision(old).blueprint));
    assert.equal(activeRevision(entry).status, 'draft');
    assert.deepEqual(entry.draft, normalized(old.draft));
    const banner = next.banners[entry.id],
      previous = project.banners[entry.id];
    assert.deepEqual(resolveBanner(entry, banner), normalized(resolveBanner(old, previous)));
    assert.deepEqual(
      resolveBanner(entry, { ...banner, arrangement: null }),
      normalized(resolveBanner(old, { ...previous, arrangement: null })),
    );
    assert.deepEqual(banner.history.slice(0, previous.history.length), previous.history);
    assert.equal(banner.layoutKey, previous.layoutKey);
  }
  assert.equal(migrateLineSpacing(next), next);
  validateProject(structuredClone(next));
});

test('spacing migration does not replay a saved standard fade over a later local mesh', () => {
  const project = initialProject(),
    entry = project.blueprints[0],
    active = activeRevision(entry);
  active.blueprint.layers[0].fadeMesh = createFadeMesh();
  active.number = 2;
  const previous = structuredClone(active);
  previous.id = 'previous-standard';
  previous.number = 1;
  delete previous.blueprint.layers[0].fadeMesh;
  entry.versions.unshift(previous);
  active.blueprint.layers.forEach((l) => {
    l.lineHeight = 1.05;
  });
  const b = project.banners[entry.id];
  b.syncedBlueprintVersionId = active.id;
  b.override = structuredClone(active.blueprint);
  b.override.layers[0].fadeMesh.softness = 0.9;
  const next = migrateLineSpacing(project);
  assert.equal(syncSavedBlueprintFades(next, entry.marketId), next);
  assert.equal(next.banners[entry.id].override.layers[0].fadeMesh.softness, 0.9);
  validateProject(structuredClone(next));
});
