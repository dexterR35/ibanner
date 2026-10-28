import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialProject,
  addMissingMarketSizes,
  activeRevision,
  campaignFor,
} from '../src/data/defaults.js';
import { BANNER3_LAYOUTS, createBanner3Blueprint } from '../src/data/banner3.js';
import { validateProject } from '../src/core/storage.js';
import { reserveLegalFooter } from '../src/core/legal-footer.js';
import { animationSamples } from '../src/core/timeline.js';
import { validateBlueprint } from '../src/core/schema.js';
import { saveBlueprintStandard } from '../src/core/blueprint-edit.js';
import { migrateLegacyProject, fnv } from '../src/core/legacy-migration.js';

test('image shadows validate and standard effects synchronize only the matching market and size', () => {
  const p = initialProject(),
    entry = p.blueprints.find((e) => e.id === 'BANNER3-300x250');
  const bp = structuredClone(activeRevision(entry).blueprint);
  bp.layers[0].shadow = {
    enabled: true,
    color: '#442244',
    opacity: 0.6,
    blur: 12,
    offsetX: -5,
    offsetY: 4,
  };
  bp.layers[0].fadeMesh.softness = 0.4;
  const next = saveBlueprintStandard(p, entry.id, bp);
  assert.deepEqual(
    activeRevision(p.blueprints.find((e) => e.id === entry.id)).blueprint.layers[0].shadow,
    undefined,
  );
  assert.equal(
    activeRevision(next.blueprints.find((e) => e.id === entry.id)).blueprint.layers[0].shadow.blur,
    12,
  );
  assert.deepEqual(next.banners['BANNER1-300x250'], p.banners['BANNER1-300x250']);
  assert.deepEqual(next.banners['BANNER3-180x150'], p.banners['BANNER3-180x150']);
  bp.layers[0].shadow.blur = 100;
  assert.throws(() => validateBlueprint(bp));
});

test('Banner 3 has one measured blueprint per size with native boxes and GIF timing', () => {
  const project = initialProject();
  assert.equal(BANNER3_LAYOUTS.length, 11);
  const entries = project.blueprints.filter((e) => e.marketId === 'BANNER3');
  assert.equal(entries.length, 11);
  for (const layout of BANNER3_LAYOUTS) {
    const entry = entries.find((e) => e.id === `BANNER3-${layout.width}x${layout.height}`);
    assert.ok(entry, layout.id);
    assert.equal(entry.measured, true);
    const bp = activeRevision(entry).blueprint;
    assert.deepEqual([bp.width, bp.height], [layout.width, layout.height]);
    assert.equal(bp.mode, layout.durationsMs.length > 1 ? 'animated' : 'static');
    if (layout.durationsMs.length > 1)
      assert.deepEqual(
        animationSamples(bp).map((s) => s.delay),
        layout.durationsMs,
      );
    assert.deepEqual(reserveLegalFooter(bp), bp, 'measured frames already respect the footer');
    for (const l of bp.layers) {
      assert.ok(
        l.x >= 0 && l.y >= 0 && l.x + l.width <= bp.width && l.y + l.height <= bp.height,
        `${bp.id}/${l.id}`,
      );
      if (l.type === 'button') assert.equal(l.textFill, '#080607');
      if (l.type === 'logo') assert.equal(l.name, 'Logo');
    }
  }
  assert.doesNotThrow(() => validateProject(structuredClone(project)));
});

test('new workspaces start from scratch: neutral copy, no legal line and no brand assets', () => {
  const project = initialProject();
  assert.deepEqual(
    project.markets.map((m) => m.id),
    ['BANNER1', 'BANNER2', 'BANNER3'],
  );
  for (const market of project.markets) {
    const campaign = project.campaigns[market.id];
    assert.equal(market.legal, '');
    assert.equal(campaign.legal, '');
    assert.equal(campaign.heroAssetId, null);
    assert.equal(campaign.logoAssetId, null);
    assert.equal(campaign.headline, 'YOUR HEADLINE\nGOES HERE');
    assert.equal('referencePack' in campaign, false);
  }
  const text = JSON.stringify(project);
  assert.doesNotMatch(text, /"reference"|resourcePreset|referencePack/);
});

test('adding missing markets is idempotent and preserves existing campaigns, standards and overrides', () => {
  const old = initialProject();
  old.markets = old.markets.filter((m) => m.id !== 'BANNER3');
  old.blueprints = old.blueprints.filter((e) => e.marketId !== 'BANNER3');
  delete old.campaigns.BANNER3;
  old.banners = Object.fromEntries(
    Object.entries(old.banners).filter(([id]) => !id.startsWith('BANNER3')),
  );
  old.banners['BANNER1-300x250'].override = structuredClone(
    activeRevision(old.blueprints[0]).blueprint,
  );
  old.banners['BANNER1-300x250'].override.layers[0].focalX = 0.8;
  const before = structuredClone(old),
    next = addMissingMarketSizes(old);
  assert.deepEqual(old, before);
  assert.deepEqual(next.blueprints.slice(0, 16), before.blueprints);
  assert.deepEqual(next.banners['BANNER1-300x250'], before.banners['BANNER1-300x250']);
  assert.deepEqual(next.campaigns.BANNER1, before.campaigns.BANNER1);
  assert.equal(next.campaigns.BANNER3.keepBlueprintBoxes, true);
  assert.equal(next.campaigns.BANNER3.autoArrange, true);
  assert.strictEqual(addMissingMarketSizes(next), next);
  assert.doesNotThrow(() => validateProject(structuredClone(next)));
});

test('Banner 3 frame visibility matches headline, offer, CTA and legal sequences', () => {
  for (const layout of BANNER3_LAYOUTS) {
    const bp = createBanner3Blueprint(layout);
    const visible = (i) =>
      bp.layers.filter((l) => bp.scenes[i].tracks[l.id].visible).map((l) => l.source);
    assert.ok(visible(0).includes('headline'));
    if (bp.mode === 'static') continue;
    if (layout.boxes.sequence === 'headline-and-offer-cta') {
      assert.ok(visible(0).includes('subtitle'));
      assert.ok(visible(1).includes('cta'));
      assert.ok(!visible(1).includes('headline'));
    } else {
      assert.ok(!visible(0).includes('subtitle'));
      assert.ok(visible(1).includes('subtitle'));
      assert.ok(!visible(1).includes('headline'));
    }
    if (layout.boxes.sequence.endsWith('-legal')) {
      assert.deepEqual(visible(2), ['hero', 'legal']);
      assert.ok(!visible(0).includes('legal'));
    }
    if (layout.boxes.sequence === 'headline-offer-cta') {
      assert.ok(!visible(0).includes('cta'));
      assert.deepEqual(visible(2), ['hero', 'logo', 'cta', 'legal']);
    }
  }
});

test('legacy workspaces are renamed to Banner 3, unlinked from example images and keep user copy', () => {
  const current = initialProject();
  // A stand-in for the old market name; the real names exist only as hashes in the migration.
  const terms = {
    ids: { [fnv('OLDMK9')]: 'BANNER3', [fnv('Oldmk9')]: 'Banner 3' },
    logos: [fnv('Oldmk9'), fnv('Oldbrand')],
    keys: [fnv('oldmk9')],
    markets: { [fnv('OLDA')]: 'BANNER1', [fnv('OLDB')]: 'BANNER2' },
    names: { [fnv('Old A')]: 'Banner 1' },
  };
  // Build an old-style workspace from the current one.
  const legacy = JSON.parse(
    JSON.stringify(current)
      .replace(/BANNER3/g, 'OLDMK9')
      .replace(/BANNER1/g, 'OLDA')
      .replace(/BANNER2/g, 'OLDB')
      .replace(/Banner 1/g, 'Old A'),
  );
  legacy.markets.find((m) => m.id === 'OLDMK9').name = 'Oldmk9';
  legacy.campaigns.OLDA.name = 'My campaign';
  legacy.campaigns.OLDA.headline = 'MATCH DAY.\nYOUR WAY.'; // old shipped value
  legacy.campaigns.OLDA.cta = 'Join us today';
  legacy.campaigns.OLDA.copyFits = { '728x90': { headline: 'MATCH DAY', cta: 'Go' } };
  legacy.campaigns.OLDB.headline = 'MY OWN HEADLINE';
  legacy.campaigns.OLDMK9.referencePack = 'oldpack';
  const b1 = legacy.blueprints.find((e) => e.id === 'OLDA-300x250');
  delete b1.measured;
  b1.reference = '300x250.png';
  activeRevision(b1).blueprint.layers.find((l) => l.id === 'logo').name = 'Oldbrand logo';
  // Old Banner 3 GIF parts were named after a casino offer.
  const gif = activeRevision(legacy.blueprints.find((e) => e.id === 'OLDMK9-170x100')).blueprint;
  gif.scenes[0].name = 'Offer';
  gif.scenes[1].name = 'Free spins';
  // Shorter BANNER2 subtitle approved for copy that is now the untouched placeholder.
  legacy.campaigns.OLDB.copyFits = { '320x50': { subtitle: 'OLD OFFER' } };
  const old = legacy.blueprints.find((e) => e.id === 'OLDMK9-300x250');
  activeRevision(old).blueprint.resourcePreset = 'OLDMK9-300x250-a';

  const migrated = validateProject(migrateLegacyProject(legacy, campaignFor, terms));
  const text = JSON.stringify(migrated);
  assert.doesNotMatch(text, /oldmk9|oldbrand|olda|oldb|old a|resourcePreset|referencePack/i);
  assert.deepEqual(
    migrated.markets.map((m) => [m.id, m.name, m.flag]),
    [
      ['BANNER1', 'Banner 1', 'B1'],
      ['BANNER2', 'Banner 2', 'B2'],
      ['BANNER3', 'Banner 3', 'B3'],
    ],
  );
  assert.ok(migrated.markets.some((m) => m.id === 'BANNER3' && m.name === 'Banner 3'));
  assert.ok(migrated.blueprints.some((e) => e.id === 'BANNER3-300x250'));
  assert.ok(migrated.banners['BANNER3-300x250']);
  assert.equal(
    activeRevision(
      migrated.blueprints.find((e) => e.id === 'BANNER1-300x250'),
    ).blueprint.layers.find((l) => l.id === 'logo').name,
    'Logo',
  );
  assert.equal(migrated.campaigns.BANNER1.headline, 'YOUR HEADLINE\nGOES HERE');
  assert.equal(migrated.campaigns.BANNER2.headline, 'MY OWN HEADLINE');
  assert.equal(migrated.campaigns.BANNER1.name, 'My campaign');
  // Shorter copy approved for the replaced headline goes; the CTA's stays.
  assert.deepEqual(migrated.campaigns.BANNER1.copyFits, { '728x90': { cta: 'Go' } });
  assert.equal('copyFits' in migrated.campaigns.BANNER2, false);
  assert.deepEqual(
    activeRevision(
      migrated.blueprints.find((e) => e.id === 'BANNER3-170x100'),
    ).blueprint.scenes.map((s) => s.name),
    ['Headline', 'Offer', 'Legal'],
  );
  assert.doesNotMatch(text, /free spins/i);
  const fiEntry = migrated.blueprints.find((e) => e.id === 'BANNER1-300x250');
  assert.equal(fiEntry.measured, true);
  assert.equal('reference' in fiEntry, false);
  // Cached layout keys no longer carry old values; banners re-arrange once.
  assert.ok(Object.values(migrated.banners).every((b) => b.layoutKey === 'migrated'));
  // A workspace whose only leftover is a stale cached key is still cleaned.
  const stale = structuredClone(current);
  stale.banners['BANNER1-300x250'].layoutKey = '["old","oldmk9"]';
  assert.equal(
    migrateLegacyProject(stale, campaignFor, terms).banners['BANNER1-300x250'].layoutKey,
    'migrated',
  );
  // Already-current projects pass through untouched, with the real table too.
  assert.strictEqual(migrateLegacyProject(current, campaignFor, terms), current);
  assert.strictEqual(migrateLegacyProject(current, campaignFor), current);
});

test('an untouched market added under the new ID gives way to the saved market it replaces', () => {
  const terms = { ids: {}, logos: [], keys: [], markets: { [fnv('OLDC')]: 'BANNER3' }, names: {} };
  const current = initialProject();
  // The saved market under its old ID, with a local edit...
  const saved = JSON.parse(JSON.stringify(current).replace(/BANNER3/g, 'OLDC'));
  saved.banners['OLDC-300x250'].history = [{ id: 'h1', createdAt: 'now', blueprint: null }];
  saved.campaigns.OLDC.headline = 'KEEP ME';
  // ...plus an untouched copy a newer build added under the new ID.
  const both = structuredClone(saved);
  both.markets.push(structuredClone(current.markets.find((m) => m.id === 'BANNER3')));
  both.campaigns.BANNER3 = structuredClone(current.campaigns.BANNER3);
  for (const e of current.blueprints.filter((e) => e.marketId === 'BANNER3')) {
    both.blueprints.push(structuredClone(e));
    both.banners[e.id] = structuredClone(current.banners[e.id]);
  }
  const merged = migrateLegacyProject(both, campaignFor, terms);
  assert.deepEqual(
    merged.markets.map((m) => m.id),
    ['BANNER1', 'BANNER2', 'BANNER3'],
  );
  assert.equal(merged.campaigns.BANNER3.headline, 'KEEP ME');
  assert.equal(merged.banners['BANNER3-300x250'].history.length, 1);
  assert.equal(merged.blueprints.filter((e) => e.marketId === 'BANNER3').length, 11);

  // If the new-ID market has work of its own, nothing is dropped: the old ID stays.
  const edited = structuredClone(both);
  edited.campaigns.BANNER3.logoAssetId = 'a'.repeat(64);
  const kept = migrateLegacyProject(edited, campaignFor, terms);
  assert.deepEqual(
    kept.markets.map((m) => m.id),
    ['BANNER1', 'BANNER2', 'OLDC', 'BANNER3'],
  );
});
