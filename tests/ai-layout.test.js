import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProject, activeRevision, resolveBanner } from '../src/data/defaults.js';
import { blueprintToTree, treeElements, applyTree } from '../src/core/layout-tree.js';
import { applyCopyFits, layoutKey } from '../src/core/auto-layout.js';
import {
  aiArrangeMarket,
  readingOrderInversions,
  referenceSummary,
  currentAiLayout,
  layoutRequest,
  nearestReferences,
  seedBlueprint,
} from '../src/core/ai-arrange.js';
import { arrangeMarket } from '../src/hooks/useAutoArrange.js';
import {
  photoReadability,
  photoAnalysisKey,
  photoAnalysisSchema,
} from '../src/core/photo-analysis.js';
import { copyFitIssues } from '../src/core/copy-fit.js';
import { validateProject } from '../src/core/storage.js';
import { validateBlueprint } from '../src/core/schema.js';

const context = {
  font: '',
  measureText(text) {
    return { width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.5 };
  },
};
const resources = { hero: { width: 1200, height: 800 } };
const fiBlueprint = (p, size) =>
  activeRevision(p.blueprints.find((e) => e.id === `BANNER1-${size}`)).blueprint;

test('layout trees list movable elements with scenes and apply boxes by element id', () => {
  const p = initialProject(),
    campaign = p.campaigns.BANNER1;
  const strip = fiBlueprint(p, '728x90');
  const elements = treeElements(strip, campaign);
  assert.ok(elements.find((e) => e.id === 'cta_0').scenes.every((s) => s === 2));
  const tree = blueprintToTree(strip, campaign);
  assert.match(tree, /^<svg width="728" height="90">/);
  assert.ok(tree.indexOf('id="photo_0"') > tree.indexOf('id="legal_0"'), 'photo is listed last');
  const moved = applyTree(strip, { headline_0: { x: 10, y: 5, width: 300, height: 30 } }, elements);
  const headline = moved.layers.find(
    (l) => l.id === elements.find((e) => e.id === 'headline_0').layerId,
  );
  assert.deepEqual([headline.x, headline.y, headline.width, headline.height], [10, 5, 300, 30]);
  assert.deepEqual(moved.scenes, strip.scenes);
  validateBlueprint(moved);
});

test('new sizes and markets are seeded from the nearest measured blueprint, not the proportional factory', () => {
  const p = initialProject();
  const wide = seedBlueprint(p, 'BANNER1', 970, 250);
  assert.equal(wide.id, 'BANNER1-970x250');
  const nearest = nearestReferences(p, 'BANNER1', 970, 250, 1)[0].bp;
  assert.equal(nearest.id, 'BANNER1-300x100');
  assert.equal(wide.scenes.length, nearest.scenes.length);
  const fresh = seedBlueprint(p, 'NEW', 300, 250);
  assert.equal(fresh.marketId, 'NEW');
  validateBlueprint(fresh);
  // Markets without measured blueprints are told their examples are borrowed.
  assert.match(referenceSummary(p, 'BANNER2'), /unverified/);
  assert.match(referenceSummary(p, 'BANNER1'), /8 measured BANNER1 blueprints/);
});

test('hybrid arrangement keeps the best candidate and never trusts a bad model layout', async () => {
  const p = initialProject();
  const request = layoutRequest(p, 'BANNER1', { seed: 3 });
  assert.equal(request.targets.length, 8);
  assert.ok(request.targets.every((t) => t.examples.length && t.examples.length <= 4));
  // A model that piles every box into one corner.
  const bad = async (op, payload) => {
    assert.equal(op, 'layout');
    return {
      elapsedMs: 5,
      provenance: {},
      targets: payload.targets.map((t) => ({
        id: t.id,
        candidates: [
          {
            complete: true,
            boxes: Object.fromEntries(
              t.elements.map((e) => [e.id, { x: 0, y: 0, width: 40, height: 20 }]),
            ),
          },
        ],
      })),
    };
  };
  const result = await aiArrangeMarket(p, 'BANNER1', resources, { request: bad, context });
  assert.equal(result.summary.length, 8);
  assert.ok(
    result.summary.every((s) => !s.source.startsWith('qwen')),
    JSON.stringify(result.summary),
  );
  const banner = result.project.banners['BANNER1-300x250'];
  assert.equal(banner.aiLayout.versionId, banner.blueprintVersionId);
  assert.ok(currentAiLayout(banner));
  validateProject(structuredClone(result.project));
  // The service failing still arranges every banner from design and reference candidates.
  const offline = await aiArrangeMarket(p, 'BANNER1', resources, {
    request: async () => {
      throw new Error('service offline');
    },
    context,
  });
  assert.equal(offline.modelError, 'service offline');
  assert.equal(offline.summary.length, 8);
  // Later automatic passes start from the chosen geometry.
  const again = arrangeMarket(result.project, 'BANNER1', resources, false, { context });
  assert.equal(again.banners['BANNER1-300x250'].layoutKey, layoutKey(p.campaigns.BANNER1));
});

test('photo readability rises over busy bright photo, the subject and printed text', () => {
  const p = initialProject(),
    campaign = { ...p.campaigns.BANNER1, imageFadeEnabled: false };
  const bp = fiBlueprint(p, '300x250');
  const photo = bp.layers.find((l) => l.type === 'image');
  const over = { ...bp.layers.find((l) => l.id === 'headline'), x: photo.x, y: photo.y + 10 };
  const layers = [...bp.layers.filter((l) => l.id !== 'headline'), over];
  const candidate = { ...bp, layers };
  const grid = (lum, detail) => ({
    key: photoAnalysisKey(campaign),
    engine: 'OpenCV.js',
    width: 1200,
    height: 800,
    cols: 4,
    rows: 4,
    luminance: Array(16).fill(lum),
    detail: Array(16).fill(detail),
    engines: ['opencv'],
  });
  const calm = photoReadability(candidate, over, campaign, resources, grid(10, 5));
  const busy = photoReadability(candidate, over, campaign, resources, grid(90, 90));
  assert.ok(busy > calm, `${busy} > ${calm}`);
  const subject = {
    ...grid(10, 5),
    subject: {
      cols: 4,
      rows: 4,
      values: Array(16).fill(100),
      box: { x: 0, y: 0, width: 1, height: 1 },
    },
    engines: ['opencv', 'birefnet'],
  };
  assert.ok(photoReadability(candidate, over, campaign, resources, subject) > calm);
  photoAnalysisSchema.parse(subject);
  assert.throws(() => photoAnalysisSchema.parse({ ...subject, luminance: [1] }));
  // Text that is not over the photo costs nothing.
  const logo = bp.layers.find((l) => l.type === 'logo');
  assert.equal(
    photoReadability(bp, { ...logo, fill: '#ffffff' }, campaign, resources, grid(90, 90)),
    0,
  );
});

test('approved shorter copy applies to one size and copy that cannot fit is reported', () => {
  const p = initialProject();
  const campaign = {
    ...p.campaigns.BANNER1,
    headline: 'A VERY LONG HEADLINE THAT CANNOT POSSIBLY FIT INSIDE THIS TINY STRIP BANNER AT ALL',
  };
  const strip = fiBlueprint(p, '300x50');
  const issues = copyFitIssues(strip, campaign, resources, context);
  assert.ok(issues.some((i) => i.role === 'headline' && i.capacity < campaign.headline.length));
  const fitted = applyCopyFits(strip, {
    ...campaign,
    copyFits: { '300x50': { headline: 'SHORT' } },
  });
  assert.equal(fitted.layers.find((l) => l.source === 'headline').textOverride, 'SHORT');
  assert.equal(
    applyCopyFits(fiBlueprint(p, '300x250'), {
      ...campaign,
      copyFits: { '300x50': { headline: 'SHORT' } },
    }),
    fiBlueprint(p, '300x250'),
  );
  assert.notEqual(
    layoutKey(campaign),
    layoutKey({ ...campaign, copyFits: { '300x50': { headline: 'X' } } }),
  );
});

test('saved experimental reference reads are dropped on load', () => {
  const p = { ...initialProject(), referenceReads: { 'BANNER1-300x250': { file: 'x' } } };
  assert.equal(validateProject(structuredClone(p)).referenceReads, undefined);
});

test('banners with manual edits are left as edited by the AI arrangement', async () => {
  const p = initialProject();
  const entry = p.blueprints.find((e) => e.id === 'BANNER1-300x250');
  const override = resolveBanner(entry, p.banners[entry.id]);
  p.banners[entry.id] = { ...p.banners[entry.id], override };
  const result = await aiArrangeMarket(p, 'BANNER1', resources, { context });
  assert.equal(result.summary.find((s) => s.id === entry.id).source, 'edited');
  assert.equal(result.project.banners[entry.id], p.banners[entry.id]);
  assert.ok(!layoutRequest(p, 'BANNER1').targets.some((t) => t.id === entry.id));
});

test('a candidate that reverses the reference reading order is counted', () => {
  const reference = {
    headline_0: { x: 20, y: 40, width: 260, height: 40 },
    cta_0: { x: 80, y: 160, width: 140, height: 30 },
    photo_0: { x: 0, y: 0, width: 300, height: 250 },
  };
  const flipped = { ...reference, cta_0: { x: 80, y: 10, width: 140, height: 30 } };
  assert.equal(readingOrderInversions(reference, reference, 300, 250), 0);
  assert.equal(readingOrderInversions(flipped, reference, 300, 250), 1);
  // Elements sharing a row are not an inversion.
  const sameRow = { ...reference, cta_0: { x: 80, y: 45, width: 140, height: 30 } };
  assert.equal(readingOrderInversions(sameRow, reference, 300, 250), 0);
});
