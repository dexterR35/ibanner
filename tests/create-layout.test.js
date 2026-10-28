import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultFlow,
  compileFlow,
  validateFlow,
  cleanFlow,
  migrateFlow,
  edgeId,
  LAYOUT_VERSION,
} from '../src/core/generation/flow.js';
import {
  generationSnapshot,
  snapshotIsCurrent,
  acceptBatch,
  undoBatch,
  ENGINE_VERSION,
} from '../src/core/generation/batch.js';
import { analysisFacts, candidateLayouts, chooseLayout } from '../src/core/ai-arrange.js';
import { initialProject, resolveBanner } from '../src/data/defaults.js';
import { validateProject } from '../src/core/storage.js';
import { validateBlueprint } from '../src/core/schema.js';

const context = {
  font: '',
  measureText(text) {
    return { width: text.length * Number(this.font.match(/([\d.]+)px/)[1]) * 0.5 };
  },
};
const resources = { hero: { width: 1200, height: 800 } };

/** A Create flow as saved before the Compose node was removed. */
function oldFlow() {
  const node = (id, kind, data = {}) => ({ id, kind, position: { x: 0, y: 0 }, data });
  const edge = (source, sourceHandle, target, targetHandle) => ({
    id: edgeId({ source, sourceHandle, target, targetHandle }),
    source,
    sourceHandle,
    target,
    targetHandle,
  });
  return {
    version: 1,
    layoutVersion: 2,
    nodes: [
      node('image', 'image'),
      node('copy', 'copy', { brief: '' }),
      node('analysis', 'analysis'),
      node('planner', 'planner', { enabled: true }),
      node('compose', 'compose', { policy: { version: 1, mode: 'strict' }, manualLayouts: false }),
      node('output-1', 'output', { marketId: 'BANNER1', width: 300, height: 250 }),
      node('output-2', 'output', { marketId: 'BANNER1', width: 728, height: 90 }),
    ],
    edges: [
      edge('image', 'image', 'analysis', 'image'),
      edge('analysis', 'analyzed', 'planner', 'analyzed'),
      edge('copy', 'copy', 'planner', 'copy'),
      edge('analysis', 'analyzed', 'compose', 'analyzed'),
      edge('copy', 'copy', 'compose', 'copy'),
      edge('planner', 'plan', 'compose', 'plan'),
      edge('compose', 'drafts', 'output-1', 'drafts'),
      edge('compose', 'drafts', 'output-2', 'drafts'),
    ],
  };
}

test('the Create flow is Image → Analyze → Qwen layout → formats, with no Compose node', () => {
  const flow = defaultFlow('BANNER1');
  assert.equal(flow.layoutVersion, LAYOUT_VERSION);
  assert.ok(!flow.nodes.some((n) => n.kind === 'compose'));
  const outputs = flow.nodes.filter((n) => n.kind === 'output');
  assert.ok(
    outputs.every((o) =>
      flow.edges.some(
        (e) => e.source === 'planner' && e.sourceHandle === 'drafts' && e.target === o.id,
      ),
    ),
  );
  const config = compileFlow(flow, initialProject());
  assert.equal(config.groups[0].outputs.length, outputs.length);
  assert.equal(config.usePlanner, true);
  assert.equal(config.policy, undefined);
  const unplugged = { ...flow, edges: flow.edges.filter((e) => e.target !== 'planner') };
  assert.throws(() => compileFlow(unplugged, initialProject()), /Qwen layout/);
  // Turning Qwen off still produces formats (saved design / nearest reference).
  const off = {
    ...flow,
    nodes: flow.nodes.map((n) => (n.kind === 'planner' ? { ...n, data: { enabled: false } } : n)),
  };
  assert.equal(compileFlow(off, initialProject()).usePlanner, false);
});

test('saved flows with a Compose node migrate on load instead of failing', () => {
  const migrated = validateFlow(oldFlow());
  assert.equal(migrated.layoutVersion, LAYOUT_VERSION);
  assert.ok(!migrated.nodes.some((n) => n.kind === 'compose'));
  assert.ok(migrated.nodes.every((n) => !('policy' in n.data) && !('manualLayouts' in n.data)));
  for (const id of ['output-1', 'output-2'])
    assert.ok(
      migrated.edges.some(
        (e) => e.source === 'planner' && e.sourceHandle === 'drafts' && e.target === id,
      ),
    );
  assert.ok(!migrated.edges.some((e) => e.sourceHandle === 'plan'));
  assert.equal(compileFlow(migrated, initialProject()).groups[0].outputs.length, 2);
  // A flow that never had a Qwen node gets one where Compose was.
  const noPlanner = oldFlow();
  noPlanner.nodes = noPlanner.nodes.filter((n) => n.kind !== 'planner');
  noPlanner.edges = noPlanner.edges.filter((e) => e.source !== 'planner' && e.target !== 'planner');
  const added = validateFlow(noPlanner);
  assert.ok(added.nodes.some((n) => n.kind === 'planner'));
  assert.equal(compileFlow(added, initialProject()).groups[0].outputs.length, 2);
  // Already-current flows pass through unchanged.
  const current = defaultFlow('BANNER1');
  assert.equal(migrateFlow(current), current);
  // The whole project loads with an old flow and old-engine batches; the batches are dropped.
  const p = initialProject();
  p.generationFlows = { BANNER1: oldFlow() };
  p.generationBatches = [
    {
      id: 'a'.repeat(64),
      snapshot: { engine: 'strict-layout-8', market: { id: 'BANNER1' } },
      items: [],
    },
  ];
  p.generationRuns = [{ ownerMarketId: 'BANNER1', batchIds: ['a'.repeat(64)] }];
  const loaded = validateProject(structuredClone(p));
  assert.ok(!loaded.generationFlows.BANNER1.nodes.some((n) => n.kind === 'compose'));
  assert.deepEqual(loaded.generationBatches, []);
  assert.deepEqual(loaded.generationRuns, []);
});

test('snapshots freeze the saved design and nearest references, not Studio state', () => {
  const p = initialProject();
  const targets = [
    { width: 300, height: 250 },
    { width: 970, height: 250 },
  ];
  const snapshot = generationSnapshot(p, 'BANNER1', targets);
  assert.equal(snapshot.engine, ENGINE_VERSION);
  assert.equal(snapshot.policy, undefined);
  assert.equal(snapshot.bases.length, 2);
  assert.equal(snapshot.bases[0].id, 'BANNER1-300x250');
  // A new size is seeded from the nearest reference shape.
  assert.equal(snapshot.targets[1].id, 'BANNER1-970x250');
  assert.deepEqual([snapshot.bases[1].width, snapshot.bases[1].height], [970, 250]);
  validateBlueprint(snapshot.bases[1]);
  assert.ok(snapshot.references.every((list) => list.length >= 1 && list.length <= 4));
  assert.equal(snapshot.references[0][0].id, 'BANNER1-300x250');
  // Studio arrangement or a local edit leaves the draft current; copy changes do not.
  const entry = p.blueprints.find((e) => e.id === 'BANNER1-300x250');
  const edited = resolveBanner(entry, p.banners[entry.id]);
  const studio = {
    ...p,
    banners: {
      ...p.banners,
      [entry.id]: { ...p.banners[entry.id], arrangement: edited, override: edited },
    },
  };
  assert.equal(snapshotIsCurrent(snapshot, studio), true);
  const recopied = {
    ...p,
    campaigns: { ...p.campaigns, BANNER1: { ...p.campaigns.BANNER1, headline: 'NEW COPY' } },
  };
  assert.equal(snapshotIsCurrent(snapshot, recopied), false);
});

function draftBatch(p, targets) {
  const snapshot = generationSnapshot(p, 'BANNER1', targets);
  const items = snapshot.targets.map((target, i) => {
    const { list, referenceBoxes } = candidateLayouts(
      snapshot.bases[i],
      snapshot.references[i][0],
      [],
    );
    const best = chooseLayout(list, snapshot.campaign, resources, { context, referenceBoxes });
    return {
      target,
      state: 'succeeded',
      scene: best.arranged,
      source: best.source,
      copyIssues: [],
    };
  });
  return { id: 'b'.repeat(64), snapshot, items };
}

test('every target gets a draft; accepting adds it to Studio, undo restores it, stale input is refused', () => {
  const p = initialProject();
  const batch = draftBatch(p, [
    { width: 300, height: 250 },
    { width: 970, height: 250 },
  ]);
  assert.ok(batch.items.every((item) => item.state === 'succeeded' && item.scene));
  const accepted = acceptBatch(p, batch);
  const banner = accepted.banners['BANNER1-300x250'];
  assert.equal(banner.override.id, 'BANNER1-300x250');
  assert.equal(banner.generation.batchId, batch.id);
  assert.equal(banner.generation.variant, batch.items[0].source);
  // The new size becomes a blueprint (its seeded design) with the draft as its local edit.
  const added = accepted.blueprints.find((e) => e.id === 'BANNER1-970x250');
  assert.ok(added && accepted.banners['BANNER1-970x250'].override);
  validateProject(structuredClone(accepted));
  const undone = undoBatch(accepted);
  assert.deepEqual(undone.banners['BANNER1-300x250'], p.banners['BANNER1-300x250']);
  assert.ok(!undone.blueprints.some((e) => e.id === 'BANNER1-970x250'));
  const stale = {
    ...p,
    campaigns: { ...p.campaigns, BANNER1: { ...p.campaigns.BANNER1, cta: 'Pelaa' } },
  };
  assert.throws(() => acceptBatch(stale, batch), /Inputs changed/);
});

test('Qwen receives the analysed subject, objects and printed text as plain facts', () => {
  const facts = analysisFacts({
    focus: { x: 0.1, y: 0.2, width: 0.3, height: 0.6 },
    focusSource: 'florence',
    subjects: [
      { label: 'woman', primary: true, box: { x: 0.1, y: 0.2, width: 0.3, height: 0.6 } },
      { label: 'horse', box: { x: 0.05, y: 0.3, width: 0.6, height: 0.6 } },
    ],
    observations: { ocr: { ocr: [{ text: 'NO 10' }] } },
  });
  assert.match(facts, /Main subject \(woman\) covers x 10-40% and y 20-80%/);
  assert.match(facts, /Objects: woman, horse/);
  assert.match(facts, /printed text/);
  assert.equal(
    analysisFacts({
      focusSource: 'whole-image-fallback',
      focus: { x: 0, y: 0, width: 1, height: 1 },
    }),
    '',
  );
});

test('old-engine project data cannot reappear through cleanFlow', () => {
  const cleaned = cleanFlow(validateFlow(oldFlow()));
  assert.ok(!cleaned.nodes.some((n) => n.kind === 'compose'));
  assert.equal(validateFlow(cleaned).layoutVersion, LAYOUT_VERSION);
});
