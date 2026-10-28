import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlueprint,
  initialProject,
  activeRevision,
  resolveBanner,
} from '../src/data/defaults.js';
import { reserveLegalFooter } from '../src/core/legal-footer.js';
import { applyBlueprintCorrections } from '../src/core/blueprint-corrections.js';

const heroOf = (bp) => bp.layers.find((l) => l.id === 'hero');
const legalOf = (bp) => bp.layers.find((l) => l.id === 'legal');
test('footer clearance applies across sizes without changing legal copy, fade, crop or GIF timing', () => {
  for (const market of ['BANNER1', 'BANNER2', 'RO'])
    for (const [w, h] of [
      [300, 250],
      [300, 600],
      [160, 600],
      [320, 480],
      [728, 90],
      [300, 100],
    ]) {
      const bp = createBlueprint(market, w, h),
        before = structuredClone(bp);
      heroOf(bp).height = bp.height - heroOf(bp).y;
      const normalized = reserveLegalFooter(bp);
      assert.ok(
        heroOf(normalized).y + heroOf(normalized).height <=
          legalOf(normalized).y - (h <= 100 ? 2 : 4),
      );
      assert.deepEqual(legalOf(normalized), legalOf(before));
      assert.deepEqual(normalized.scenes, before.scenes);
      for (const key of ['x', 'y', 'width', 'focalX', 'focalY', 'zoom', 'fade', 'fadeDirection'])
        assert.equal(heroOf(normalized)[key], heroOf(before)[key]);
      assert.strictEqual(reserveLegalFooter(normalized), normalized);
    }
  const separatePart = createBlueprint('BANNER1', 320, 50);
  assert.strictEqual(reserveLegalFooter(separatePart), separatePart);
});

test('legacy referenced drafts append corrected boxes and old banner snapshots resolve safely without rewriting history', () => {
  const project = initialProject(),
    entry = project.blueprints.find((e) => e.id === 'BANNER1-300x250');
  const old = activeRevision(entry);
  heroOf(old.blueprint).height = 138;
  project.banners[entry.id].override = structuredClone(old.blueprint);
  const before = structuredClone(project);
  const next = applyBlueprintCorrections(project),
    updated = next.blueprints.find((e) => e.id === entry.id);
  assert.equal(updated.versions.length, 2);
  assert.deepEqual(
    updated.versions[0],
    before.blueprints.find((e) => e.id === entry.id).versions[0],
  );
  assert.deepEqual(next.banners, before.banners);
  assert.deepEqual(project, before);
  const bp = resolveBanner(updated, next.banners[entry.id]);
  assert.ok(heroOf(bp).y + heroOf(bp).height <= legalOf(bp).y - 4);
  assert.deepEqual(heroOf(activeRevision(updated).blueprint), heroOf(bp));
  assert.strictEqual(applyBlueprintCorrections(next), next);
});
