import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, activeRevision, resolveBanner } from '../src/data/defaults.js';
import { matchMarketBlueprints } from '../src/core/match-blueprints.js';
import { arrangeBanner, layoutKey } from '../src/core/auto-layout.js';
import { validateProject } from '../src/core/storage.js';

test('matching blueprints restores boxes and alignment while preserving content, treatment, history and other markets', () => {
  const p = initialProject();
  const entry = p.blueprints.find((item) => item.id === 'BANNER2-300x600');
  const local = structuredClone(activeRevision(entry).blueprint);
  Object.assign(
    local.layers.find((layer) => layer.id === 'headline'),
    {
      x: 5,
      width: 130,
      align: 'left',
      textOverride: 'MY LOCAL COPY',
      glow: { enabled: true, blur: 8, opacity: 0.8, color: '#ff162d' },
    },
  );
  Object.assign(
    local.layers.find((layer) => layer.id === 'hero'),
    { focalX: 0.7, zoom: 2, fade: 0.8 },
  );
  p.banners[entry.id].override = local;
  const before = structuredClone(p);
  const matched = matchMarketBlueprints(p, 'BANNER2');
  assert.deepEqual(p, before);
  assert.strictEqual(matched.blueprints, p.blueprints);
  assert.strictEqual(matched.assets, p.assets);
  assert.strictEqual(matched.campaigns.BANNER1, p.campaigns.BANNER1);
  assert.equal(matched.campaigns.BANNER2.keepBlueprintBoxes, true);
  const banner = matched.banners[entry.id];
  assert.equal(banner.history.length, 2);
  assert.deepEqual(banner.history[0].blueprint, local);
  const headline = banner.override.layers.find((layer) => layer.id === 'headline');
  assert.equal(headline.x, 30);
  assert.equal(headline.width, 240);
  assert.equal(headline.align, 'center');
  assert.equal(headline.textOverride, 'MY LOCAL COPY');
  assert.deepEqual(headline.glow, local.layers.find((layer) => layer.id === 'headline').glow);
  for (const key of ['focalX', 'zoom', 'fade'])
    assert.equal(
      banner.override.layers.find((layer) => layer.id === 'hero')[key],
      local.layers.find((layer) => layer.id === 'hero')[key],
    );
  assert.deepEqual(banner.override.scenes, local.scenes);
  for (const item of p.blueprints.filter((item) => item.marketId === 'BANNER1'))
    assert.strictEqual(matched.banners[item.id], p.banners[item.id]);
  assert.equal(matchMarketBlueprints(matched, 'BANNER2').banners[entry.id].history.length, 2);
  validateProject(structuredClone(matched));
  matched.campaigns.BANNER2.keepBlueprintBoxes = 'yes';
  assert.throws(() => validateProject(matched), /blueprint box setting/);
});

test('fixed boxes retain geometry on every size while normal font fitting handles new copy', () => {
  const p = matchMarketBlueprints(initialProject(), 'BANNER2');
  const campaign = { ...p.campaigns.BANNER2, headline: 'NEW WORDS AND A LONGER CAMPAIGN HEADLINE' };
  assert.notEqual(layoutKey(campaign), layoutKey({ ...campaign, keepBlueprintBoxes: false }));
  for (const entry of p.blueprints.filter((item) => item.marketId === 'BANNER2')) {
    const bp = resolveBanner(entry, p.banners[entry.id]);
    const arranged = arrangeBanner(
      bp,
      campaign,
      { hero: { width: 2000, height: 500 } },
      { context: {} },
    );
    assert.deepEqual(arranged, bp);
  }
});
