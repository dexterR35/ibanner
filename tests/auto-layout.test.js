import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlueprint,
  campaignFor,
  DEFAULT_MARKETS,
  PRESETS,
  initialProject,
  resolveBanner,
} from '../src/data/defaults.js';
import { arrangeBanner, layoutKey } from '../src/core/auto-layout.js';
import { validateBlueprint } from '../src/core/schema.js';
import { validateProject } from '../src/core/storage.js';
import { textObstacles } from '../src/core/text-layout.js';
import { boundText } from '../src/core/render.js';
import { fitText } from '../src/core/text-fit.js';

const context = {
  font: '',
  measureText(text) {
    return { width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.5 };
  },
};
const resources = { hero: { width: 1200, height: 800 } };
const intersects = (a, b) =>
  a.x < b.x + b.width - 0.01 &&
  a.x + a.width > b.x + 0.01 &&
  a.y < b.y + b.height - 0.01 &&
  a.y + a.height > b.y + 0.01;

test('automatic layouts fit long copy across markets and formats without changing masters, legal, logo or timing', () => {
  for (const market of DEFAULT_MARKETS)
    for (const [w, h] of PRESETS.slice(0, 8)) {
      const bp = createBlueprint(market.id, w, h),
        before = structuredClone(bp);
      const campaign = {
        ...campaignFor(market),
        headline: 'PLAY EVERY MATCH YOUR WAY WITH BRANDX THIS WEEKEND',
      };
      const result = arrangeBanner(bp, campaign, resources, { context });
      validateBlueprint(result);
      assert.deepEqual(bp, before);
      assert.deepEqual(result.scenes, bp.scenes);
      for (const id of ['logo', 'legal', 'cta'])
        assert.deepEqual(
          result.layers.find((l) => l.id === id),
          bp.layers.find((l) => l.id === id),
        );
      for (const layer of result.layers.filter((l) => ['headline', 'subtitle'].includes(l.id))) {
        assert.equal(
          textObstacles(result, layer).some((box) => intersects(layer, box)),
          false,
          `${bp.id}/${layer.id}`,
        );
        const fit = fitText(context, boundText(layer, campaign), layer);
        assert.equal(fit.overflow, false, `${bp.id}/${layer.id}`);
        assert.equal(fit.lines.join(' '), boundText(layer, campaign).replace(/\s+/g, ' '));
      }
    }
});

test('copy length and photo aspect influence composition while fixed crop focus and local rows survive', () => {
  const bp = createBlueprint('BANNER1', 300, 250),
    campaign = campaignFor(DEFAULT_MARKETS[0]);
  Object.assign(
    bp.layers.find((l) => l.id === 'hero'),
    { focalX: 0.8, focalY: 0.3, zoom: 2 },
  );
  const short = arrangeBanner(bp, { ...campaign, headline: 'MATCH DAY' }, resources, { context });
  const long = arrangeBanner(
    bp,
    { ...campaign, headline: 'PLAY EVERY MATCH YOUR WAY WITH BRANDX THIS WEEKEND' },
    resources,
    { context },
  );
  assert.notDeepEqual(short.layers, long.layers);
  const hero = long.layers.find((l) => l.id === 'hero');
  for (const key of ['focalX', 'focalY', 'zoom', 'fade', 'fadeDirection'])
    assert.equal(hero[key], bp.layers.find((l) => l.id === 'hero')[key]);
  const local = bp.layers.find((l) => l.id === 'headline');
  Object.assign(local, { textOverride: 'LOCAL\nROWS', textFlow: 'manual' });
  const result = arrangeBanner(bp, campaign, resources, {
    context,
    preserveFlow: true,
    resizeImage: false,
  });
  assert.equal(result.layers.find((l) => l.id === 'headline').textFlow, 'manual');
  assert.equal(result.layers.find((l) => l.id === 'headline').textOverride, 'LOCAL\nROWS');
  assert.deepEqual(
    result.layers.find((l) => l.id === 'hero'),
    bp.layers.find((l) => l.id === 'hero'),
  );
});

test('GIF parts can reuse text space and crossfades reserve co-visible text', () => {
  const bp = createBlueprint('BANNER1', 320, 50),
    campaign = campaignFor(DEFAULT_MARKETS[0]);
  let result = arrangeBanner(bp, campaign, resources, { context });
  assert(
    intersects(
      result.layers.find((l) => l.id === 'headline'),
      result.layers.find((l) => l.id === 'subtitle'),
    ),
  );
  bp.scenes[1].transitionMs = 300;
  result = arrangeBanner(bp, campaign, resources, { context });
  assert(
    !intersects(
      result.layers.find((l) => l.id === 'headline'),
      result.layers.find((l) => l.id === 'subtitle'),
    ),
  );
  assert.deepEqual(result.scenes, bp.scenes);
});

test('legacy projects keep their appearance and arranged snapshots are validated and resolved consistently', () => {
  const p = initialProject(),
    entry = p.blueprints[0],
    banner = p.banners[entry.id];
  delete p.campaigns.BANNER1.autoArrange;
  delete banner.layoutKey;
  const original = structuredClone(resolveBanner(entry, banner));
  validateProject(p);
  assert.equal(p.campaigns.BANNER1.autoArrange, true);
  assert.equal(banner.layoutKey, layoutKey(p.campaigns.BANNER1));
  assert.deepEqual(resolveBanner(entry, banner), original);
  banner.arrangement = arrangeBanner(original, p.campaigns.BANNER1, resources, { context });
  validateProject(p);
  assert.equal(resolveBanner(entry, banner), banner.arrangement);
  banner.arrangement.width += 1;
  assert.throws(() => validateProject(p), /Arranged layout identity/);
  assert.equal(
    layoutKey(p.campaigns.BANNER1),
    layoutKey({ ...p.campaigns.BANNER1, name: 'Renamed', accentColor: '#abcdef' }),
  );
});

test('the saved design is kept when the copy reads well in it, and the photo frame is not shrunk to reflow copy', async () => {
  const { arrangementSummary } = await import('../src/core/auto-layout.js');
  const { reserveLegalFooter } = await import('../src/core/legal-footer.js');
  for (const [w, h] of [
    [300, 600],
    [160, 600],
  ]) {
    const bp = createBlueprint('BANNER1', w, h),
      campaign = { ...campaignFor(DEFAULT_MARKETS[0]), headline: 'MATCH DAY' };
    const result = arrangeBanner(bp, campaign, resources, { context });
    const design = reserveLegalFooter(bp);
    const hero = (b) => b.layers.find((l) => l.id === 'hero');
    assert.deepEqual(
      [hero(result).width, hero(result).height],
      [hero(design).width, hero(design).height],
      `${w}x${h} photo frame`,
    );
    assert.notEqual(arrangementSummary(bp, result).kind, 'photo', `${w}x${h}`);
  }
});

test('reflowed copy keeps a side margin instead of running edge to edge', () => {
  for (const [w, h] of [
    [300, 250],
    [300, 600],
    [320, 480],
  ]) {
    const bp = createBlueprint('BANNER1', w, h),
      campaign = {
        ...campaignFor(DEFAULT_MARKETS[0]),
        headline: 'PLAY EVERY MATCH YOUR WAY WITH BRANDX THIS WEEKEND AND ALL SEASON',
      };
    const result = arrangeBanner(bp, campaign, resources, { context });
    for (const layer of result.layers.filter((l) => ['headline', 'subtitle'].includes(l.id))) {
      assert(layer.x >= Math.floor(w * 0.05) - 1, `${w}x${h}/${layer.id} left ${layer.x}`);
      assert(
        layer.x + layer.width <= w - Math.floor(w * 0.05) + 1,
        `${w}x${h}/${layer.id} right ${layer.x + layer.width}`,
      );
    }
  }
});

test('automation state labels design, reflow, photo, fixed, stale and edited banners', async () => {
  const { automationState, automationCounts } = await import('../src/core/automation-state.js');
  const p = initialProject(),
    entry = p.blueprints.find((e) => e.marketId === 'BANNER1'),
    campaign = p.campaigns.BANNER1,
    key = layoutKey(campaign);
  const design = resolveBanner(entry, { ...p.banners[entry.id], arrangement: null });
  const moved = (id, patch) => ({
    ...design,
    layers: design.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
  });
  const state = (banner, c = campaign) =>
    automationState(entry, { ...p.banners[entry.id], layoutKey: key, ...banner }, c)?.kind;
  assert.equal(state({ arrangement: design }), 'design');
  const headline = design.layers.find((l) => l.id === 'headline');
  assert.equal(state({ arrangement: moved('headline', { y: headline.y + 9 }) }), 'reflow');
  assert.equal(state({ arrangement: moved('hero', { height: 40 }) }), 'photo');
  const fixed = { ...campaign, keepBlueprintBoxes: true };
  assert.equal(state({ arrangement: design, layoutKey: layoutKey(fixed) }, fixed), 'fixed');
  assert.equal(
    state({ arrangement: design, layoutKey: 'old' }, { ...campaign, autoArrange: false }),
    'stale',
  );
  assert.equal(state({ arrangement: design, layoutKey: 'old' }), 'pending');
  assert.equal(state({ arrangement: null, override: design }), 'manual');
  const counts = automationCounts(
    [entry],
    { [entry.id]: { ...p.banners[entry.id], layoutKey: 'x' } },
    {
      ...campaign,
      autoArrange: false,
    },
  );
  assert.equal(counts.stale, 1);
});
