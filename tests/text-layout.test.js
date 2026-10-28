import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlueprint } from '../src/data/defaults.js';
import { validateBlueprint } from '../src/core/schema.js';
import { fitText, textTop } from '../src/core/text-fit.js';
import { suggestTextLayout, textObstacles } from '../src/core/text-layout.js';
import { boundText } from '../src/core/render.js';

const context = {
  font: '',
  measureText(text) {
    return { width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.5 };
  },
};
const textLayer = {
  width: 80,
  height: 40,
  fontSize: 20,
  minFontSize: 10,
  maxLines: 2,
  lineHeight: 1,
  fontWeight: 'bold',
};
const intersects = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('auto text balances rows, single-line joins campaign breaks, and manual preserves rows', () => {
  const copy = 'AA BB\nCC DD E';
  const auto = fitText(context, copy, { ...textLayer, textFlow: 'auto' });
  assert.deepEqual(auto.lines, ['AA BB', 'CC DD E']);
  assert.equal(auto.size, 20);
  assert.equal(auto.lines.join(' '), copy.replace('\n', ' '));
  assert.deepEqual(fitText(context, 'ONE\nTWO', { ...textLayer, width: 200 }).lines, [
    'ONE',
    'TWO',
  ]);
  const single = fitText(context, 'ONE\nTWO', {
    ...textLayer,
    width: 200,
    textFlow: 'single-line',
  });
  assert.deepEqual(single.lines, ['ONE TWO']);
  assert.equal(single.overflow, false);
  const tooLong = fitText(context, 'ONE TWO THREE FOUR FIVE', {
    ...textLayer,
    textFlow: 'single-line',
  });
  assert.equal(tooLong.overflow, false);
  assert.equal(tooLong.lines.join(' '), 'ONE TWO THREE FOUR FIVE');
  assert(tooLong.lines.length > 1);
});

test('vertical alignment and format copy overrides preserve legacy default behavior', () => {
  assert.equal(textTop({ height: 60, lineHeight: 1 }, 2, 10), 20);
  assert.equal(textTop({ height: 60, lineHeight: 1, verticalAlign: 'top' }, 2, 10), 0);
  assert.equal(textTop({ height: 60, lineHeight: 1, verticalAlign: 'bottom' }, 2, 10), 40);
  const bp = createBlueprint('BANNER1', 320, 50);
  for (const layer of bp.layers) {
    delete layer.textFlow;
    delete layer.verticalAlign;
    delete layer.textOverride;
  }
  const layer = validateBlueprint(bp).layers.find((l) => l.id === 'headline');
  assert.equal(layer.textFlow, 'manual');
  assert.equal(layer.verticalAlign, 'middle');
  const campaign = { headline: 'SHARED COPY' };
  assert.equal(boundText(layer, campaign), 'SHARED COPY');
  assert.equal(boundText({ ...layer, textOverride: 'LOCAL\nROWS' }, campaign), 'LOCAL\nROWS');
  assert.equal(boundText({ ...layer, textOverride: '' }, campaign), '');
  assert.equal(campaign.headline, 'SHARED COPY');
});

test('320x50 arrangement uses full safe height without changing logo, photo or other parts', () => {
  const bp = createBlueprint('BANNER1', 320, 50);
  const headline = bp.layers.find((l) => l.id === 'headline');
  Object.assign(headline, {
    x: 74,
    y: 4,
    width: 170,
    height: 23,
    fontSize: 12.5,
    textFlow: 'manual',
  });
  const before = structuredClone(bp);
  const { patch } = suggestTextLayout(bp, headline.id);
  assert.equal(patch.height, 42);
  assert(patch.fontSize > headline.fontSize);
  assert.equal(patch.textFlow, 'auto');
  assert(textObstacles(bp, headline).every((r) => !intersects(patch, r)));
  assert.deepEqual(bp, before);
  // Final-part legal overlaps this space, but never appears with the headline in this cut GIF.
  assert(
    intersects(
      patch,
      bp.layers.find((l) => l.id === 'legal'),
    ),
  );
});

test('space suggestions include co-visible tracks, movement and crossfade neighbours', () => {
  const bp = createBlueprint('BANNER1', 320, 50);
  const headline = bp.layers.find((l) => l.id === 'headline');
  bp.scenes[1].tracks.headline.visible = true;
  bp.scenes[1].tracks.subtitle.dx = 12;
  let obstacles = textObstacles(bp, headline);
  assert(
    obstacles.some((box) => box.width === bp.layers.find((l) => l.id === 'subtitle').width + 12),
  );
  bp.scenes[1].tracks.headline.visible = false;
  bp.scenes[1].transitionMs = 300;
  obstacles = textObstacles(bp, headline);
  assert(
    obstacles.some((box) => box.width === bp.layers.find((l) => l.id === 'subtitle').width + 12),
  );
  // Non-overlapping intervals within one scene need not reserve each other's area.
  bp.scenes[1].transitionMs = 0;
  bp.scenes[0].tracks.subtitle = { visible: true, startMs: 1000 };
  bp.scenes[0].tracks.headline.endMs = 1000;
  assert.equal(textObstacles(bp, headline).length, 2);
});

test('arrangement declines blocked or moving text instead of placing it over other content', () => {
  const bp = createBlueprint('BANNER1', 320, 50);
  const hero = bp.layers.find((l) => l.id === 'hero');
  Object.assign(hero, { x: 0, y: 0, width: 320, height: 50, fade: 0 });
  assert.match(suggestTextLayout(bp, 'headline').error, /No clear text area/);
  bp.scenes[0].tracks.headline.dx = 15;
  assert.match(suggestTextLayout(bp, 'headline').error, /rotation and movement/);
});

test('automatic box fill grows and shrinks text without changing its box and uses bounded measurement work', () => {
  let calls = 0;
  const measured = {
    font: '',
    measureText(text) {
      calls++;
      return context.measureText.call(this, text);
    },
  };
  const layer = {
    ...textLayer,
    width: 180,
    height: 60,
    fontSize: 12,
    minFontSize: 5,
    maxLines: 1,
    textFlow: 'single-line',
  };
  const before = structuredClone(layer);
  const short = fitText(measured, 'TEAM', layer);
  assert(short.size > layer.fontSize);
  assert(short.size <= layer.height);
  assert(calls < 20);
  const long = fitText(context, 'MATCH DAY YOUR WAY', layer);
  assert(long.size < short.size);
  assert.equal(long.overflow, false);
  assert.deepEqual(layer, before);
  const defaults = validateBlueprint(createBlueprint('BANNER1', 420, 320)).layers.find(
    (l) => l.id === 'headline',
  );
  assert.equal(defaults.lineHeight, 1);
  assert.equal(defaults.verticalAlign, 'middle');
});

test('mandatory fit keeps all copy in fixed boxes despite minimum size, row limits and unbroken words', () => {
  for (const textFlow of ['manual', 'auto', 'single-line']) {
    for (const copy of [
      'THIS IS A VERY LONG OFFER '.repeat(20).trim(),
      'SUPERCALIFRAGILISTIC'.repeat(20),
      'ONE\nTWO\nTHREE\nFOUR\nFIVE',
    ]) {
      const layer = { ...textLayer, width: 70, height: 22, maxLines: 1, minFontSize: 18, textFlow };
      const before = structuredClone(layer);
      const result = fitText(context, copy, layer);
      assert.equal(result.overflow, false);
      assert.equal(result.lines.join('').replace(/\s/g, ''), copy.replace(/\s/g, ''));
      assert(result.lines.length * result.size <= layer.height + 0.1);
      assert(result.lines.every((line) => context.measureText(line).width <= layer.width + 0.1));
      assert.deepEqual(layer, before);
    }
  }
});
