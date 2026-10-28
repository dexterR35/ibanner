import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultFlow,
  compileFlow,
  arrangeFlow,
  validateFlow,
  cleanFlow,
} from '../src/core/generation/flow.js';
import { workflowProgress } from '../src/core/generation/progress.js';
import { initialProject } from '../src/data/defaults.js';

test('workflow percentages count completed units, hold during inference and never regress', () => {
  const groups = [{ outputs: [1, 2, 3] }, { outputs: [1] }];
  const planning = workflowProgress(groups, 0, { stage: 'planner' });
  assert.deepEqual(planning, { completed: 3, total: 12, percent: 25 });
  assert.deepEqual(workflowProgress(groups, 0, { stage: 'planner' }, planning.completed), planning);
  assert.equal(workflowProgress(groups, 0, { stage: 'source' }, 3).completed, 3);
  assert.equal(workflowProgress(groups, 1, { stage: 'complete' }).percent, 100);
});

test('model choices and view reflow preserve graph logic and reject unknown models', () => {
  const p = initialProject(),
    flow = defaultFlow('BANNER1');
  const planner = flow.nodes.find((node) => node.kind === 'planner');
  planner.data.modelVariant = 'legacy-local-planner';
  planner.data.modelPrecision = 'auto';
  assert.equal(compileFlow(flow, p).modelVariant, 'qwen3-vl-8b');
  const active = cleanFlow(flow);
  assert.equal(
    active.nodes.find((node) => node.kind === 'planner').data.modelVariant,
    'qwen3-vl-8b',
  );
  assert.equal(planner.data.modelVariant, 'legacy-local-planner'); // Frozen historical input is unchanged.
  const arranged = arrangeFlow(flow);
  assert.deepEqual(arranged.edges, flow.edges);
  assert.deepEqual(
    arranged.nodes.map((node) => node.data),
    flow.nodes.map((node) => node.data),
  );
  assert.equal(arranged.layoutVersion, 3);
  planner.data.modelVariant = 'https://untrusted.example/model';
  assert.throws(() => validateFlow(flow));
});
