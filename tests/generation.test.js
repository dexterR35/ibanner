import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, fingerprint } from '../src/core/generation/fingerprint.js';
import { measureStrictText } from '../src/core/generation/strict-text.js';
import { defaultFlow, compileFlow, validateFlow, cleanFlow } from '../src/core/generation/flow.js';
import { planOcr } from '../src/core/generation/prepare.js';
import { fuseRanks, lexicalSearch, retrievalMetrics } from '../src/core/generation/search.js';
import { initialProject } from '../src/data/defaults.js';
import { validateRecords } from '../src/core/generation/store.js';
import { validateProject } from '../src/core/storage.js';
const H = (c) => c.repeat(64);
const context = {
  font: '',
  measureText(text) {
    const size = Number(this.font.match(/([d.]+)px/)?.[1] || 14);
    return { width: Array.from(text).length * size * 0.52 };
  },
};

test('semantic fingerprints are order-stable and reject nonfinite values', async () => {
  assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
  assert.equal(await fingerprint({ b: 2, a: 1 }), await fingerprint({ a: 1, b: 2 }));
  assert.throws(() => canonical({ x: NaN }));
  assert.notEqual(await fingerprint({ a: 1 }), await fingerprint({ a: 2 }));
});
test('strict fitting never reduces below the minimum, drops copy, or splits nonbreaking compounds', () => {
  const layer = {
    fontSize: 24,
    minFontSize: 14,
    width: 60,
    height: 30,
    maxLines: 1,
    lineHeight: 1,
    fontWeight: 'normal',
  };
  const text = 'PRIMEȘTE\u00a0100 ROTIRI GRATUITE';
  const fit = measureStrictText(context, text, layer, 'Fixture');
  assert.equal(fit.sourceText, text);
  assert.equal(fit.size, 14);
  assert.equal(fit.overflow, true);
  assert.equal(fit.truncated, false);
  const line = measureStrictText(context, 'ONE\nTWO', {
    ...layer,
    width: 120,
    height: 60,
    maxLines: 2,
  });
  assert.deepEqual(line.lines, ['ONE', 'TWO']);
});
test('library search fuses ranks and matches tags and read image text', () => {
  assert.equal(
    fuseRanks([[{ assetId: 'a' }, { assetId: 'b' }], [{ assetId: 'b' }]])[0].assetId,
    'b',
  );
  assert.equal(
    lexicalSearch([{ id: 'a', name: 'Photo' }], 'rotiri', { a: { value: { tags: ['rotiri'] } } })[0]
      .assetId,
    'a',
  );
  const textRun = {
    assetId: 'b',
    component: 'ocr',
    status: 'ready',
    ocr: [{ text: 'Kesäkampanja' }],
  };
  assert.deepEqual(
    lexicalSearch(
      [
        { id: 'a', name: 'Photo' },
        { id: 'b', name: 'Hero' },
      ],
      'kesäkampanja',
      {},
      [textRun],
    ).map((r) => r.assetId),
    ['b'],
  );
  assert.equal(retrievalMetrics(['b', 'a'], ['a'], 2).recall, 1);
});
test('backups from before semantic search removal still import, without their vectors', () => {
  const tombstone = [`tombstone:${H('a')}`, { assetId: H('a'), deletedAt: '2026-01-01T00:00:00Z' }];
  const legacy = [
    `embedding:${H('c')}:${H('a')}`,
    { assetId: H('a'), inputHash: H('a'), profileId: H('c'), vector: [1, 0], dimension: 2 },
  ];
  assert.deepEqual(validateRecords([legacy, tombstone], [H('a')]), [tombstone]);
});
test('orientation transforms map all stored raster corners and reject forged/oversized media', async () => {
  const { orientationTransform, transformPoint, inspectImageHeader } =
    await import('../src/core/generation/media-contract.js');
  for (let o = 1; o <= 8; o++) {
    const t = orientationTransform(o, 400, 300);
    const points = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 0, y: 300 },
      { x: 400, y: 300 },
    ].map((p) => transformPoint(p, t.matrix));
    assert.equal(Math.min(...points.map((p) => p.x)), 0);
    assert.equal(Math.max(...points.map((p) => p.x)), t.width);
    assert.equal(Math.max(...points.map((p) => p.y)), t.height);
  }
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71]);
  png.set([73, 72, 68, 82], 12);
  const v = new DataView(png.buffer);
  v.setUint32(16, 50000);
  v.setUint32(20, 50000);
  assert.throws(() => inspectImageHeader(png.buffer, 'image/png'), /40 megapixels/);
  assert.throws(
    () =>
      inspectImageHeader(
        new TextEncoder().encode('<svg><script>alert(1)</script></svg>').buffer,
        'image/svg+xml',
      ),
    /active/,
  );
  assert.throws(
    () =>
      inspectImageHeader(
        new TextEncoder().encode('<svg><image href="https://example.com/a.png"/></svg>').buffer,
        'image/svg+xml',
      ),
    /external/,
  );
});

test('canvas frames group nodes visually, persist, and drop removed members', () => {
  const flow = defaultFlow('BANNER1');
  flow.frames = [{ id: 'frame-1', name: 'Inputs', nodeIds: ['image', 'copy'] }];
  assert.deepEqual(validateFlow(cleanFlow(flow)).frames, flow.frames);
  assert.equal(compileFlow(flow, initialProject()).groups.length, 1);
  const removed = { ...flow, nodes: flow.nodes.filter((node) => node.id !== 'copy') };
  assert.deepEqual(cleanFlow(removed).frames[0].nodeIds, ['image']);
  const emptied = {
    ...flow,
    nodes: flow.nodes.filter((node) => !['image', 'copy'].includes(node.id)),
  };
  assert.equal(cleanFlow(emptied).frames, undefined);
  assert.throws(() =>
    validateFlow({ ...flow, frames: [flow.frames[0], { ...flow.frames[0], name: 'Again' }] }),
  );
});

test('Qwen gets PaddleOCR lines when they were read, otherwise Florence-2 regions', () => {
  const box = { x: 0.123456, y: 0.2, width: 0.5, height: 0.0444 };
  const florence = { ocr: [{ text: 'VALI0LIIGAA', box, confidence: 1 }] };
  const ocr = {
    ocr: [
      { text: 'OTTELUILTA', box, confidence: 0.98765 },
      ...Array.from({ length: 30 }, (_, i) => ({ text: `line ${i}`, box, confidence: 0.9 })),
    ],
  };
  const paddle = planOcr({ florence, ocr });
  assert.equal(paddle.ocrEngine, 'paddleocr');
  assert.equal(paddle.ocr.length, 20);
  assert.deepEqual(paddle.ocr[0], {
    text: 'OTTELUILTA',
    confidence: 0.99,
    box: { x: 0.123, y: 0.2, width: 0.5, height: 0.044 },
  });
  assert.deepEqual(
    planOcr({ florence }).ocr.map((l) => [l.text, l.confidence]),
    [['VALI0LIIGAA', 1]],
  );
  assert.equal(planOcr({ florence }).ocrEngine, 'florence2');
  // No text on the image: Qwen gets no ocr keys at all.
  assert.deepEqual(planOcr({ florence: { ocr: [] } }), {});
  assert.deepEqual(planOcr(), {});
});
