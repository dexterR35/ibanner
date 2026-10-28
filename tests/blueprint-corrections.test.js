import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, activeRevision, createBlueprint } from '../src/data/defaults.js';
import { applyBlueprintCorrections } from '../src/core/blueprint-corrections.js';
import { validateProject } from '../src/core/storage.js';

test('centered BANNER2 headline revisions preserve old versions, campaign layouts and other formats', () => {
  const project = initialProject();
  const entry = project.blueprints.find((item) => item.id === 'BANNER2-300x600');
  const old = activeRevision(entry);
  Object.assign(
    old.blueprint.layers.find((layer) => layer.id === 'headline'),
    { x: 56, align: 'left' },
  );
  entry.draft = structuredClone(old.blueprint);
  const banner = project.banners[entry.id];
  banner.override = structuredClone(old.blueprint);
  banner.arrangement = structuredClone(old.blueprint);
  banner.history.push({ id: 'old-override', blueprint: structuredClone(old.blueprint) });
  const before = structuredClone(project);
  const corrected = applyBlueprintCorrections(project);
  const updated = corrected.blueprints.find((item) => item.id === entry.id);
  const current = activeRevision(updated);
  assert.deepEqual(project, before);
  assert.deepEqual(updated.versions[0], old);
  assert.equal(current.number, 2);
  assert.notEqual(current.id, old.id);
  assert.equal(current.status, 'draft');
  const headline = current.blueprint.layers.find((layer) => layer.id === 'headline');
  assert.equal(headline.x, 30);
  assert.equal(headline.x + headline.width / 2, current.blueprint.width / 2);
  assert.equal(headline.align, 'center');
  assert.deepEqual(
    current.blueprint.layers.filter((layer) => layer.id !== 'headline'),
    old.blueprint.layers.filter((layer) => layer.id !== 'headline'),
  );
  assert.deepEqual(current.blueprint.scenes, old.blueprint.scenes);
  assert.deepEqual(updated.draft, entry.draft);
  assert.strictEqual(corrected.banners, project.banners);
  assert.strictEqual(corrected.campaigns, project.campaigns);
  assert.strictEqual(corrected.assets, project.assets);
  assert.deepEqual(
    corrected.blueprints.filter((item) => item.id !== entry.id),
    before.blueprints.filter((item) => item.id !== entry.id),
  );
  assert.strictEqual(applyBlueprintCorrections(corrected), corrected);
  assert.doesNotThrow(() => validateProject(structuredClone(corrected)));
});

test('fresh BANNER2 standard is centered, while measured, published and moving layouts stay unchanged', () => {
  const fresh = createBlueprint('BANNER2', 300, 600);
  const headline = fresh.layers.find((layer) => layer.id === 'headline');
  assert.equal(headline.x, 30);
  assert.equal(headline.align, 'center');
  assert.strictEqual(applyBlueprintCorrections(initialProject()).blueprints.length, 27);
  for (const kind of ['measured', 'published', 'rotated', 'moving']) {
    const project = initialProject();
    const entry = project.blueprints.find((item) => item.id === 'BANNER2-300x600');
    const active = activeRevision(entry);
    const layer = active.blueprint.layers.find((item) => item.id === 'headline');
    layer.x = 56;
    if (kind === 'measured') entry.measured = true;
    if (kind === 'published') active.status = 'published';
    if (kind === 'rotated') layer.rotation = 10;
    if (kind === 'moving') active.blueprint.scenes[0].tracks.headline.dx = 10;
    assert.strictEqual(applyBlueprintCorrections(project), project);
  }
});
