import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSubjects } from '../src/core/subject-detection.js';
import { clearRetiredSubjectCache } from '../src/core/retired-subject-cache.js';
import { initialProject } from '../src/data/defaults.js';
import { validateProject } from '../src/core/storage.js';

test('a stale SAM-only service cannot load SAM during a default Florence search', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({
      service: 'bannerflow-sam3',
      schemaVersion: 1,
      ready: true,
      state: 'available',
      loaded: false,
      device: 'fixture',
      issues: [],
    });
  };
  try {
    await assert.rejects(detectSubjects(new Blob(), 'person'), /Restart the local service/);
    assert.deepEqual(calls, ['/api/subjects/health']);
  } finally {
    globalThis.fetch = original;
  }
});

test('default Florence boxes carry no invented confidence and never request SAM precision', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json(
      url.includes('/health')
        ? {
            service: 'bannerflow-sam3',
            schemaVersion: 1,
            engine: 'florence',
            ready: true,
            state: 'available',
            loaded: false,
            device: 'fixture',
            issues: [],
          }
        : {
            service: 'bannerflow-sam3',
            schemaVersion: 1,
            engine: 'florence',
            detections: [{ label: 'person', box: { xmin: 0.1, ymin: 0.2, xmax: 0.6, ymax: 0.8 } }],
          },
    );
  };
  try {
    const results = await detectSubjects(new Blob(), 'person');
    assert.equal(results.length, 1);
    assert.equal('score' in results[0], false);
    assert.deepEqual(calls, ['/api/subjects/health', '/api/subjects/detect?query=person']);
  } finally {
    globalThis.fetch = original;
  }
});

test('SAM remains available only through an explicit precision request', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json(
      url.includes('/health')
        ? {
            service: 'bannerflow-sam3',
            schemaVersion: 1,
            engine: 'florence',
            ready: true,
            state: 'available',
            loaded: false,
            device: 'fixture',
            issues: [],
          }
        : { service: 'bannerflow-sam3', schemaVersion: 1, engine: 'sam3', detections: [] },
    );
  };
  try {
    assert.deepEqual(await detectSubjects(new Blob(), 'person', { engine: 'sam3' }), []);
    assert.deepEqual(calls, [
      '/api/subjects/health?precision=true',
      '/api/subjects/detect?query=person&precision=true',
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test('old provider preferences migrate to local Florence-2 without rewriting old detections or masters', () => {
  for (const engine of ['browser', 'auto', undefined, 'sam3', 'florence']) {
    const p = initialProject();
    p.campaigns.BANNER1.subjectEngine = engine;
    const masters = structuredClone(p.blueprints);
    assert.equal(validateProject(p).campaigns.BANNER1.subjectEngine, 'florence');
    assert.deepEqual(p.blueprints, masters);
  }
});

test('legacy browser preference invokes only Florence-2 and offline errors never spawn workers', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({
      service: 'bannerflow-sam3',
      schemaVersion: 1,
      engine: 'florence',
      ready: false,
      state: 'needs_setup',
      loaded: false,
      device: 'CPU',
      issues: [{ code: 'checkpoint_missing', message: 'Weights missing.' }],
    });
  };
  try {
    await assert.rejects(
      detectSubjects(new Blob(), 'person', { engine: 'browser' }),
      /Florence-2 unavailable.*Weights missing/,
    );
    assert.deepEqual(calls, ['/api/subjects/health']);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(detectSubjects(new Blob(), 'person', { signal: controller.signal }), {
      name: 'AbortError',
    });
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('retired detector cache cleanup preserves unrelated models and reference assets', async () => {
  const removed = [];
  const storage = {
    keys: async () => ['bannerflow-owlvit-revision', 'transformers-cache', 'other'],
    delete: async (name) => removed.push(name),
    open: async () => ({
      keys: async () => [
        {
          url: 'http://localhost/vendor/models/owlvit-base-patch32-ONNX/onnx/model_quantized.onnx',
        },
        { url: 'http://localhost/vendor/onnx/ort-wasm-simd-threaded.asyncify.wasm' },
        { url: 'http://localhost/references/original.png' },
        { url: 'http://localhost/vendor/models/other/model.onnx' },
      ],
      delete: async (request) => removed.push(new URL(request.url).pathname),
    }),
  };
  await clearRetiredSubjectCache(storage);
  assert.deepEqual(removed, [
    'bannerflow-owlvit-revision',
    '/vendor/models/owlvit-base-patch32-ONNX/onnx/model_quantized.onnx',
    '/vendor/onnx/ort-wasm-simd-threaded.asyncify.wasm',
  ]);
});
