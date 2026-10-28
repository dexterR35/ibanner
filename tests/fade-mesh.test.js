import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFadeMesh,
  meshDepth,
  meshAlpha,
  moveMeshPoint,
  meshToLocal,
  localToMesh,
  resampleFadeMesh,
} from '../src/core/fade-mesh.js';
import { validateBlueprint } from '../src/core/schema.js';
import {
  createBlueprint,
  duplicateForSize,
  initialProject,
  activeRevision,
  resolveBanner,
} from '../src/data/defaults.js';
import { validateProject } from '../src/core/storage.js';
import { saveBlueprintFade } from '../src/core/blueprint-fade.js';
import { panImage } from '../src/core/image-position.js';
import { focusImage } from '../src/core/subject-position.js';

test('legacy fades remain opt-in and invalid meshes cannot enter saved blueprints', () => {
  const bp = createBlueprint('BANNER1', 300, 250),
    hero = bp.layers.find((l) => l.id === 'hero');
  assert.equal(validateBlueprint(bp).layers[0].fadeMesh, undefined);
  hero.fadeMesh = createFadeMesh();
  assert.equal(validateBlueprint(bp).layers[0].fadeMesh.points.length, 16);
  for (const mutate of [
    (m) => {
      m.softness = 0;
    },
    (m) => {
      m.softness = 1.1;
    },
    (m) => {
      m.points[1].x = 0;
    },
    (m) => {
      m.points[0].x = 0.1;
    },
    (m) => {
      m.points[5].y = NaN;
    },
    (m) => {
      m.points[5].y = -0.1;
    },
    (m) => {
      m.points.push({ x: 1, y: 1 });
    },
    (m) => {
      m.points = [m.points[0]];
    },
  ]) {
    hero.fadeMesh = createFadeMesh();
    mutate(hero.fadeMesh);
    assert.throws(() => validateBlueprint(bp));
  }
});

test('sixteen-point curves stay bounded, resample, map to all edges, and clamp drags without crossing', () => {
  const mesh = createFadeMesh();
  assert.equal(mesh.points.length, 16);
  assert(meshDepth(mesh.points, 0.5) > meshDepth(mesh.points, 0) + 0.3);
  assert(meshAlpha(mesh, 0.5, 0.35) > 0.99);
  assert(meshAlpha(mesh, 0, 0.35) < 0.01);
  for (let i = 0; i <= 100; i++)
    assert(meshDepth(mesh.points, i / 100) >= 0.2 && meshDepth(mesh.points, i / 100) <= 0.6);
  const moved = moveMeshPoint(mesh, 5, { x: 2, y: -1 });
  assert(moved.points[5].x < moved.points[6].x);
  assert.equal(moved.points[5].y, 0);
  assert.equal(moveMeshPoint(mesh, 0, { x: 0.6, y: 1 }).points[0].x, 0);
  assert.equal(moveMeshPoint(mesh, 15, { x: 0.1, y: 1 }).points[15].x, 1);
  assert.equal(resampleFadeMesh(mesh, 10).points.length, 10);
  for (const fadeDirection of ['top', 'bottom', 'left', 'right']) {
    const layer = { width: 400, height: 230, fadeDirection };
    const p = { x: 0.3, y: 0.7 },
      result = localToMesh(meshToLocal(p, layer), layer);
    assert(Math.abs(p.x - result.x) < 1e-12 && Math.abs(p.y - result.y) < 1e-12);
  }
});

test('mesh survives resizing, project validation, image panning and subject placement', () => {
  const p = initialProject(),
    entry = p.blueprints[0],
    bp = activeRevision(entry).blueprint;
  const hero = bp.layers.find((l) => l.id === 'hero');
  hero.fadeMesh = createFadeMesh();
  const original = structuredClone(hero);
  const duplicate = duplicateForSize(bp, 'NEW', 600, 500);
  assert.deepEqual(duplicate.layers[0].fadeMesh, hero.fadeMesh);
  assert.deepEqual(
    validateProject(p).blueprints[0].versions[0].blueprint.layers[0].fadeMesh,
    hero.fadeMesh,
  );
  const patch = panImage({ width: 1600, height: 1200 }, hero, null, 80, -40);
  assert.deepEqual(Object.keys(patch).sort(), ['focalX', 'focalY']);
  const focus = focusImage(
    bp,
    hero,
    { width: 1600, height: 1200 },
    { x: 0.3, y: 0.4, width: 0.2, height: 0.3 },
  );
  assert.deepEqual(Object.keys(focus.patch).sort(), ['focalX', 'focalY', 'zoom']);
  assert.deepEqual(hero, original);
});

test('saving a blueprint fade appends a draft revision, ignores unrelated edits and updates only its matching banner', () => {
  const p = initialProject(),
    before = structuredClone(p),
    entry = p.blueprints[0];
  const source = structuredClone(activeRevision(entry).blueprint);
  source.background = '#abcdef';
  source.layers[0].x = 100;
  source.layers[0].fadeMesh = createFadeMesh();
  const next = saveBlueprintFade(p, entry.id, source),
    updated = next.blueprints[0];
  assert.equal(updated.versions.length, entry.versions.length + 1);
  assert.equal(activeRevision(updated).status, 'draft');
  assert.deepEqual(updated.versions.slice(0, -1), entry.versions);
  assert.equal(
    activeRevision(updated).blueprint.background,
    activeRevision(entry).blueprint.background,
  );
  assert.equal(
    activeRevision(updated).blueprint.layers[0].x,
    activeRevision(entry).blueprint.layers[0].x,
  );
  for (const id of Object.keys(p.banners))
    if (id !== entry.id) assert.deepEqual(next.banners[id], p.banners[id]);
  assert.equal(next.banners[entry.id].blueprintVersionId, updated.activeVersionId);
  assert.deepEqual(next.campaigns, p.campaigns);
  assert.deepEqual(next.blueprints.slice(1), p.blueprints.slice(1));
  assert.deepEqual(
    resolveBanner(updated, next.banners[entry.id]),
    activeRevision(updated).blueprint,
  );
  assert.deepEqual(p, before);
  assert.equal(saveBlueprintFade(next, entry.id, activeRevision(updated).blueprint), next);
  validateProject(next);
});
