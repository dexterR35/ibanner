import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, resolveBanner } from '../src/data/defaults.js';
import { focusMarket } from '../src/core/focus-market.js';
import { layoutKey } from '../src/core/auto-layout.js';

test('explicit subject placement changes only crops, keeps current boxes and isolates the market', () => {
  const p = initialProject(),
    assetId = 'a'.repeat(64);
  Object.assign(p.campaigns.BANNER2, {
    autoArrange: false,
    heroAssetId: assetId,
    subjectFocus: {
      assetId,
      id: 'chosen',
      label: 'person',
      source: 'manual',
      box: { x: 0.8, y: 0.1, width: 0.1, height: 0.2 },
    },
  });
  const entry = p.blueprints.find((e) => e.id === 'BANNER2-300x600');
  p.banners[entry.id].override = structuredClone(resolveBanner(entry, p.banners[entry.id]));
  p.banners[entry.id].override.layers.find((l) => l.id === 'headline').textOverride = 'LOCAL COPY';
  p.banners[entry.id].arrangement = structuredClone(p.banners[entry.id].override);
  p.banners[entry.id].arrangement.layers.find((l) => l.id === 'headline').x = 47;
  const original = structuredClone(p);
  const focused = focusMarket(p, 'BANNER2', { hero: { width: 1200, height: 800 } });
  assert.deepEqual(p, original);
  assert.equal(focused.blueprints, p.blueprints);
  assert.equal(focused.campaigns, p.campaigns);
  let cropChanged = false;
  for (const e of p.blueprints) {
    if (e.marketId !== 'BANNER2') {
      assert.equal(focused.banners[e.id], p.banners[e.id]);
      continue;
    }
    const before = resolveBanner(e, p.banners[e.id]),
      after = resolveBanner(e, focused.banners[e.id]);
    assert.equal(focused.banners[e.id].override, p.banners[e.id].override);
    assert.equal(focused.banners[e.id].layoutKey, layoutKey(p.campaigns.BANNER2));
    const withoutCrop = (bp) => ({
      ...bp,
      layers: bp.layers.map(({ focalX, focalY, zoom, ...layer }) => layer),
    });
    assert.deepEqual(withoutCrop(after), withoutCrop(before));
    cropChanged ||= JSON.stringify(before) !== JSON.stringify(after);
  }
  assert(cropChanged);
  assert.deepEqual(
    focusMarket(focused, 'BANNER2', { hero: { width: 1200, height: 800 } }),
    focused,
  );
  assert.equal(focusMarket(p, 'BANNER1', { hero: { width: 1200, height: 800 } }), p);
  assert.equal(focusMarket(p, 'BANNER2', null), p);
});
