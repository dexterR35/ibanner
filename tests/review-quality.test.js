import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlueprint,
  campaignFor,
  DEFAULT_MARKETS,
  initialProject,
} from '../src/data/defaults.js';
import { applyTextHierarchy, arrangeBanner, layoutKey } from '../src/core/auto-layout.js';
import { validateProject } from '../src/core/storage.js';
import { boundText } from '../src/core/render.js';
import { fitText } from '../src/core/text-fit.js';
import {
  DEFAULT_TEXT_HIERARCHY,
  hierarchyRatio,
  textHierarchySchema,
} from '../src/data/text-hierarchy.js';
import { thinSamples, GIF_ATTEMPTS } from '../src/core/export.js';
import { edgeContrast, faceIssues } from '../src/core/review.js';

const context = {
  font: '',
  measureText(text) {
    return { width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.5 };
  },
};
const resources = { hero: { width: 1200, height: 800 } };
const market = (id) => DEFAULT_MARKETS.find((m) => m.id === id);
const sizeOf = (bp, source, campaign) =>
  Math.max(
    ...bp.layers
      .filter((l) => l.source === source && l.visible && boundText(l, campaign).trim())
      .map((l) => fitText(context, boundText(l, campaign), l).size),
  );

test('copy hierarchy is market data, applies per size and only lowers the smaller copy', () => {
  const b1 = campaignFor(market('BANNER1'));
  assert.deepEqual(b1.textHierarchy, DEFAULT_TEXT_HIERARCHY.BANNER1);
  assert.equal(campaignFor(market('BANNER2')).textHierarchy, null);
  assert.equal(hierarchyRatio(b1.textHierarchy, 320, 480), 1.25);
  assert.equal(hierarchyRatio(b1.textHierarchy, 300, 250), 0.9);
  assert.equal(hierarchyRatio(null, 320, 480), null);
  assert.equal(
    textHierarchySchema.safeParse({ larger: 'headline', smaller: 'headline', minRatio: 1 }).success,
    false,
  );
  // A strict rule on every size: the offer must end up at least 1.4× the headline.
  const strict = {
    ...b1,
    textHierarchy: { larger: 'subtitle', smaller: 'headline', minRatio: 1.4 },
  };
  for (const [w, h] of [
    [300, 250],
    [300, 600],
    [320, 480],
  ]) {
    const bp = createBlueprint('BANNER1', w, h);
    const result = applyTextHierarchy(bp, strict, resources, context);
    const offer = sizeOf(result, 'subtitle', strict),
      headline = sizeOf(result, 'headline', strict);
    const minimum = Math.max(
      ...bp.layers.filter((l) => l.source === 'headline').map((l) => l.minFontSize),
    );
    assert.ok(offer / headline >= 1.4 - 0.05 || headline <= minimum + 0.5, `${w}x${h}`);
    // The larger copy and every non-headline layer keep their boxes.
    for (const layer of result.layers.filter((l) => l.source !== 'headline'))
      assert.deepEqual(
        layer,
        bp.layers.find((l) => l.id === layer.id),
      );
    // Shrunk boxes stay inside the designed box.
    for (const layer of result.layers.filter((l) => l.source === 'headline')) {
      const before = bp.layers.find((l) => l.id === layer.id);
      assert.ok(
        layer.y >= before.y - 0.5 && layer.y + layer.height <= before.y + before.height + 1,
      );
    }
  }
  // No rule: nothing changes, and the rule takes part in the layout identity.
  const bp = createBlueprint('BANNER1', 320, 480);
  assert.equal(applyTextHierarchy(bp, { ...b1, textHierarchy: null }, resources, context), bp);
  assert.notEqual(layoutKey(b1), layoutKey({ ...b1, textHierarchy: null }));
  const arranged = arrangeBanner(bp, b1, resources, { context });
  assert.ok(sizeOf(arranged, 'subtitle', b1) / sizeOf(arranged, 'headline', b1) >= 1.25 - 0.05);
});

test('projects saved before hierarchy rules receive the market default once', () => {
  const project = initialProject();
  for (const campaign of Object.values(project.campaigns)) delete campaign.textHierarchy;
  validateProject(project);
  assert.deepEqual(project.campaigns.BANNER1.textHierarchy, DEFAULT_TEXT_HIERARCHY.BANNER1);
  assert.notEqual(project.campaigns.BANNER1.textHierarchy, DEFAULT_TEXT_HIERARCHY.BANNER1);
  assert.equal(project.campaigns.BANNER2.textHierarchy, null);
  // A market that turned the rule off stays off.
  project.campaigns.BANNER1.textHierarchy = null;
  validateProject(project);
  assert.equal(project.campaigns.BANNER1.textHierarchy, null);
  project.campaigns.BANNER1.textHierarchy = {
    larger: 'subtitle',
    smaller: 'headline',
    minRatio: 9,
  };
  assert.throws(() => validateProject(project));
});

test('GIF frame thinning keeps holds and the total running time', () => {
  const samples = [
    { time: 0, delay: 1200 },
    ...Array.from({ length: 9 }, (_, i) => ({ time: 1200 + i * 100, delay: 100 })),
    { time: 2100, delay: 2000 },
  ];
  const total = (list) => list.reduce((sum, s) => sum + s.delay, 0);
  for (const step of [1, 2, 3]) {
    const kept = thinSamples(samples, step);
    assert.equal(total(kept), total(samples));
    assert.ok(kept.some((s) => s.time === 0 && s.delay >= 1200));
    assert.ok(kept.some((s) => s.time === 2100));
    if (step > 1) assert.ok(kept.length < samples.length);
  }
  assert.equal(thinSamples(samples, 1), samples);
  // Reductions get progressively stronger and never drop below 32 colours.
  assert.ok(GIF_ATTEMPTS.every((a, i) => i === 0 || a.colors <= GIF_ATTEMPTS[i - 1].colors));
  assert.ok(GIF_ATTEMPTS.every((a) => a.colors >= 32));
});

test('CTA edge contrast reads the ring around the button only', () => {
  const width = 20,
    height = 20,
    rect = { x: 5, y: 5, width: 10, height: 10 };
  const fill = (rgb) => {
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([...rgb, 255], i);
    return pixels;
  };
  assert.equal(edgeContrast(fill([232, 19, 42]), width, height, rect, '#e8132a'), 1);
  assert.ok(edgeContrast(fill([8, 10, 16]), width, height, rect, '#e8132a') > 3);
  // Pixels under the button itself never count.
  const inside = fill([8, 10, 16]);
  for (let y = 5; y < 15; y++)
    for (let x = 5; x < 15; x++) inside.set([232, 19, 42], (y * width + x) * 4);
  assert.ok(edgeContrast(inside, width, height, rect, '#e8132a') > 3);
});

test('a detected face cut by the photo frame becomes a review note', () => {
  const campaign = { ...campaignFor(market('BANNER1')), heroAssetId: 'a'.repeat(64) };
  const bp = createBlueprint('BANNER1', 300, 250);
  const photo = bp.layers.find((l) => l.source === 'hero');
  const withFace = (box) => ({
    ...campaign,
    subjectSearch: {
      assetId: campaign.heroAssetId,
      query: 'person',
      results: [{ id: 'subject-0', label: 'human face', box, source: 'detected' }],
    },
  });
  // Zoomed into the top-left corner, a face near the image centre falls outside the frame,
  // and a face straddling the frame edge is cut.
  const zoomed = {
    ...bp,
    layers: bp.layers.map((l) => (l.id === photo.id ? { ...l, zoom: 2, focalX: 0, focalY: 0 } : l)),
  };
  const cut = faceIssues(
    zoomed,
    withFace({ x: 0.47, y: 0.1, width: 0.08, height: 0.12 }),
    resources,
  );
  assert.equal(cut.length, 1);
  assert.equal(cut[0].kind, 'cut');
  assert.ok(cut[0].visible > 0.12 && cut[0].visible < 0.9);
  assert.deepEqual(
    faceIssues(zoomed, withFace({ x: 0.8, y: 0.8, width: 0.05, height: 0.05 }), resources),
    [],
  );
  // Without a stored search for this photo there is nothing to check.
  assert.deepEqual(faceIssues(zoomed, campaign, resources), []);
});
