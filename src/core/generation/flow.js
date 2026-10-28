import { z } from 'zod';
import { STARTER_TARGETS } from '../../data/generation-targets.js';

export const FLOW_VERSION = 1;
export const NODE_KINDS = ['image', 'copy', 'analysis', 'planner', 'output'];
/** Saved flows before the Compose node was removed (it built drafts from fixed rules). */
export const LAYOUT_VERSION = 3;
export const PORTS = {
  image: { inputs: {}, outputs: { image: 'image' } },
  copy: { inputs: {}, outputs: { copy: 'copy' } },
  analysis: { inputs: { image: 'image' }, outputs: { analyzed: 'analyzed' } },
  // Qwen layout: places every connected format with the nearest references as examples.
  planner: { inputs: { analyzed: 'analyzed', copy: 'copy' }, outputs: { drafts: 'drafts' } },
  output: { inputs: { drafts: 'drafts' }, outputs: {} },
};
const id = z.string().regex(/^[a-z][a-z0-9-]{0,99}$/);
const nodeSchema = z
  .object({
    id,
    kind: z.enum(NODE_KINDS),
    position: z
      .object({
        x: z.number().finite().min(-10000).max(10000),
        y: z.number().finite().min(-10000).max(10000),
      })
      .strict(),
    data: z
      .object({
        brief: z.string().max(4000).optional(),
        enabled: z.boolean().optional(),
        // Bounded historical provenance; active flows normalize to the supported planner.
        modelVariant: z
          .string()
          .regex(/^[a-z0-9][a-z0-9.-]{0,63}$/)
          .optional(),
        modelPrecision: z.enum(['auto', 'nf4', 'bf16']).optional(),
        marketId: z.string().min(1).max(100).optional(),
        width: z.number().int().min(32).max(4096).optional(),
        height: z.number().int().min(32).max(4096).optional(),
      })
      .strict(),
  })
  .strict();
const edgeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,420}$/),
    source: id,
    sourceHandle: id,
    target: id,
    targetHandle: id,
  })
  .strict();
/** Frames only group nodes visually on the canvas; they never change what a run does. */
const frameSchema = z
  .object({
    id,
    name: z.string().max(80),
    nodeIds: z.array(id).min(1).max(110),
  })
  .strict();
export const flowSchema = z
  .object({
    version: z.literal(FLOW_VERSION),
    layoutVersion: z.literal(LAYOUT_VERSION).optional(),
    nodes: z.array(nodeSchema).min(1).max(110),
    edges: z.array(edgeSchema).max(220),
    frames: z.array(frameSchema).max(50).optional(),
  })
  .strict();
export const edgeId = (c) => `edge-${c.source}-${c.sourceHandle}-${c.target}-${c.targetHandle}`;
export const unsupportedPlanner = (data) =>
  data?.modelVariant != null && data.modelVariant !== 'qwen3-vl-8b';
const activePlanner = (data) =>
  unsupportedPlanner(data)
    ? { ...data, modelVariant: 'qwen3-vl-8b', modelPrecision: 'auto' }
    : data;

/** Keep React Flow's measurements and selection state out of saved project data. */
export function cleanFlow(flow) {
  const known = new Set(flow.nodes.map((node) => node.id));
  const frames = (flow.frames || [])
    .map((frame) => ({ ...frame, nodeIds: frame.nodeIds.filter((nodeId) => known.has(nodeId)) }))
    .filter((frame) => frame.nodeIds.length);
  return {
    version: flow.version,
    ...(flow.layoutVersion ? { layoutVersion: flow.layoutVersion } : {}),
    ...(frames.length ? { frames } : {}),
    nodes: flow.nodes.map(({ id, kind, position, data }) => ({
      id,
      kind,
      position,
      data: kind === 'planner' ? activePlanner(data) : data,
    })),
    edges: flow.edges.map(({ id, source, sourceHandle, target, targetHandle }) => ({
      id,
      source,
      sourceHandle,
      target,
      targetHandle,
    })),
  };
}

export function defaultFlow(marketId) {
  const node = (id, kind, x, y, data = {}) => ({ id, kind, position: { x, y }, data });
  const nodes = [
    node('image', 'image', 20, 40),
    node('copy', 'copy', 20, 480, { brief: '' }),
    node('analysis', 'analysis', 450, 40),
    node('planner', 'planner', 880, 40, { enabled: true }),
    ...STARTER_TARGETS.map((target, index) =>
      node(`output-${index + 1}`, 'output', 1360, 40 + index * 550, { marketId, ...target }),
    ),
  ];
  const connection = (source, sourceHandle, target, targetHandle) => ({
    source,
    sourceHandle,
    target,
    targetHandle,
    id: edgeId({ source, sourceHandle, target, targetHandle }),
  });
  return {
    version: FLOW_VERSION,
    layoutVersion: LAYOUT_VERSION,
    nodes,
    edges: [
      connection('image', 'image', 'analysis', 'image'),
      connection('analysis', 'analyzed', 'planner', 'analyzed'),
      connection('copy', 'copy', 'planner', 'copy'),
      ...nodes
        .filter((n) => n.kind === 'output')
        .map((n) => connection('planner', 'drafts', n.id, 'drafts')),
    ],
  };
}

/** View-only reflow for the larger, readable node cards; edges and settings are retained. */
export function arrangeFlow(flow) {
  let output = 0;
  const positions = {
    image: [20, 40],
    copy: [20, 480],
    analysis: [450, 40],
    planner: [880, 40],
  };
  return {
    ...flow,
    layoutVersion: LAYOUT_VERSION,
    nodes: flow.nodes.map((node) => {
      const [x, y] =
        node.kind === 'output'
          ? [1360 + Math.floor(output / 3) * 430, 40 + (output++ % 3) * 550]
          : positions[node.kind];
      return { ...node, position: { x, y } };
    }),
  };
}

function reaches(edges, start, goal, seen = new Set()) {
  if (start === goal) return true;
  if (seen.has(start)) return false;
  seen.add(start);
  return edges.some((e) => e.source === start && reaches(edges, e.target, goal, seen));
}
export function canConnect(flow, c, { replacing = false } = {}) {
  const source = flow.nodes.find((n) => n.id === c.source);
  const target = flow.nodes.find((n) => n.id === c.target);
  if (!source || !target || !c.sourceHandle || !c.targetHandle) return false;
  if (
    !PORTS[source.kind].outputs[c.sourceHandle] ||
    PORTS[source.kind].outputs[c.sourceHandle] !== PORTS[target.kind].inputs[c.targetHandle]
  )
    return false;
  const edges = replacing
    ? flow.edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
    : flow.edges;
  if (edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) return false;
  if (
    edges.some(
      (e) =>
        e.source === c.source &&
        e.sourceHandle === c.sourceHandle &&
        e.target === c.target &&
        e.targetHandle === c.targetHandle,
    )
  )
    return false;
  return !reaches(edges, c.target, c.source);
}

/**
 * Older saved flows had a Compose node between Qwen and the formats. It is removed: its format
 * connections move to the Qwen layout node, its settings are dropped, and the Qwen node is
 * connected to Analyze image and Copy. Pure; flows already at LAYOUT_VERSION pass unchanged.
 */
export function migrateFlow(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.nodes)) return value;
  const hasCompose = value.nodes.some((n) => n?.kind === 'compose');
  const stale = value.nodes.some(
    (n) => n?.data && ('policy' in n.data || 'manualLayouts' in n.data),
  );
  if (!hasCompose && !stale && value.layoutVersion === LAYOUT_VERSION) return value;
  const compose = value.nodes.find((n) => n?.kind === 'compose');
  let nodes = value.nodes
    .filter((n) => n?.kind !== 'compose')
    .map((n) => {
      if (!n?.data) return n;
      const { policy, manualLayouts, ...data } = n.data;
      return { ...n, data };
    });
  let planner = nodes.find((n) => n.kind === 'planner');
  if (!planner && compose) {
    planner = {
      id: 'planner',
      kind: 'planner',
      position: compose.position,
      data: { enabled: true },
    };
    if (nodes.some((n) => n.id === planner.id)) planner.id = 'planner-layout';
    nodes = [...nodes, planner];
  }
  const ids = new Set(nodes.map((n) => n.id));
  const kindOf = (id) => nodes.find((n) => n.id === id)?.kind;
  const edges = [];
  const add = (source, sourceHandle, target, targetHandle) => {
    if (!ids.has(source) || !ids.has(target)) return;
    const edge = { source, sourceHandle, target, targetHandle };
    edge.id = edgeId(edge);
    if (
      !edges.some(
        (e) => e.id === edge.id || (e.target === target && e.targetHandle === targetHandle),
      )
    )
      edges.push(edge);
  };
  for (const e of value.edges || []) {
    if (compose && e.source === compose.id && e.sourceHandle === 'drafts' && planner)
      add(planner.id, 'drafts', e.target, e.targetHandle);
    else if (compose && (e.source === compose.id || e.target === compose.id)) continue;
    else if (
      PORTS[kindOf(e.source)]?.outputs[e.sourceHandle] &&
      PORTS[kindOf(e.target)]?.inputs[e.targetHandle]
    )
      add(e.source, e.sourceHandle, e.target, e.targetHandle);
  }
  const analysis = nodes.find((n) => n.kind === 'analysis'),
    copy = nodes.find((n) => n.kind === 'copy');
  if (planner && analysis) add(analysis.id, 'analyzed', planner.id, 'analyzed');
  if (planner && copy) add(copy.id, 'copy', planner.id, 'copy');
  const frames = (value.frames || [])
    .map((frame) => ({
      ...frame,
      nodeIds: frame.nodeIds.filter((id) => ids.has(id)),
    }))
    .filter((frame) => frame.nodeIds.length);
  return {
    ...value,
    layoutVersion: LAYOUT_VERSION,
    nodes,
    edges,
    ...(value.frames ? { frames } : {}),
  };
}

/** Saved graphs can be incomplete while being edited; malformed connections cannot be imported. */
export function validateFlow(value) {
  const flow = flowSchema.parse(migrateFlow(value));
  if (
    new Set(flow.nodes.map((n) => n.id)).size !== flow.nodes.length ||
    new Set(flow.edges.map((e) => e.id)).size !== flow.edges.length
  )
    throw new Error('Duplicate node or connection.');
  for (const kind of NODE_KINDS.filter((k) => k !== 'output'))
    if (flow.nodes.filter((n) => n.kind === kind).length > 1)
      throw new Error(`Only one ${kind} node is allowed.`);
  if (new Set((flow.frames || []).map((frame) => frame.id)).size !== (flow.frames || []).length)
    throw new Error('Duplicate frame.');
  const accepted = { ...flow, edges: [] };
  for (const edge of flow.edges) {
    if (edge.id !== edgeId(edge) || !canConnect(accepted, edge))
      throw new Error('Invalid workflow connection.');
    accepted.edges.push(edge);
  }
  for (const node of flow.nodes) {
    if (node.kind === 'output' && (!node.data.marketId || !node.data.width || !node.data.height))
      throw new Error('A format node needs a market and dimensions.');
  }
  return flow;
}

export function compileFlow(value, project, { outputNodeId = null } = {}) {
  const flow = validateFlow(value);
  const one = (kind) => {
    const node = flow.nodes.find((n) => n.kind === kind);
    if (!node) throw new Error(`Add the ${kind} node to run this workflow.`);
    return node;
  };
  const image = one('image'),
    copy = one('copy'),
    analysis = one('analysis'),
    planner = one('planner');
  const has = (source, sourceHandle, target, targetHandle) =>
    flow.edges.some(
      (e) =>
        e.source === source.id &&
        e.sourceHandle === sourceHandle &&
        e.target === target.id &&
        e.targetHandle === targetHandle,
    );
  if (
    !has(image, 'image', analysis, 'image') ||
    !has(analysis, 'analyzed', planner, 'analyzed') ||
    !has(copy, 'copy', planner, 'copy')
  )
    throw new Error('Connect Image → Analyze image → Qwen layout and Copy → Qwen layout.');
  // Turned off, Qwen proposes nothing: formats still get the saved design or nearest reference.
  const usePlanner = planner.data.enabled !== false;
  const connectedOutputs = flow.nodes.filter(
    (n) => n.kind === 'output' && has(planner, 'drafts', n, 'drafts'),
  );
  const outputs = outputNodeId
    ? connectedOutputs.filter((node) => node.id === outputNodeId)
    : connectedOutputs;
  if (!outputs.length) throw new Error('Connect Qwen layout to at least one format output.');
  if (outputs.length > 100) throw new Error('Choose at most 100 format outputs.');
  const keys = new Set();
  for (const node of outputs) {
    const { marketId, width, height } = node.data;
    if (!project.markets.some((m) => m.id === marketId) || !project.campaigns[marketId])
      throw new Error(`Unknown market on ${node.id}.`);
    const key = `${marketId}:${width}x${height}`;
    if (keys.has(key)) throw new Error(`Duplicate format ${key}.`);
    keys.add(key);
  }
  const groups = [...new Set(outputs.map((n) => n.data.marketId))].map((marketId) => ({
    marketId,
    outputs: outputs.filter((n) => n.data.marketId === marketId),
  }));
  return {
    groups,
    usePlanner,
    modelVariant: activePlanner(planner?.data || {}).modelVariant || 'qwen3-vl-8b',
    modelPrecision: activePlanner(planner?.data || {}).modelPrecision || 'auto',
    automaticAnalysis: true,
    brief: copy.data.brief || '',
  };
}
