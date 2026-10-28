import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '../components/ui/index.js';
import { useWorkspace } from '../hooks/useWorkspace.js';
import {
  STARTER_TARGETS,
  generationSnapshot,
  generateBatch,
  acceptBatch,
  assertBatchCorrectionsCurrent,
  undoBatch,
  exportBatch,
  exportMatrix,
} from '../core/generation/batch.js';
import { download, renderOutput } from '../core/export.js';
import { loadResources } from '../core/storage.js';
import {
  leadingWords,
  suggestShorterCopy,
  visionCapabilities,
} from '../core/generation/planner.js';
import { ensureSubjectCutout } from '../core/generation/cutout.js';
import { prepareGeneration } from '../core/generation/prepare.js';
import { workflowProgress } from '../core/generation/progress.js';
import {
  defaultFlow,
  cleanFlow,
  compileFlow,
  edgeId,
  NODE_KINDS,
  arrangeFlow,
  unsupportedPlanner,
  LAYOUT_VERSION,
} from '../core/generation/flow.js';
import CreateGraph from '../components/generation/CreateGraph.jsx';
import '../styles/generation.css';

function latestOutput(project, node) {
  if (node?.kind !== 'output') return null;
  for (const batch of [...(project.generationBatches || [])].reverse()) {
    if (batch.snapshot.market.id !== node.data.marketId) continue;
    if (batch.outputNodeIds && !batch.outputNodeIds.includes(node.id)) continue;
    const item = batch.items.find(
      (candidate) =>
        candidate.target.width === node.data.width && candidate.target.height === node.data.height,
    );
    if (item) return { batch, item };
  }
  return null;
}

function onlyOutput(batch, item) {
  const index = batch.items.indexOf(item);
  return {
    ...batch,
    items: [item],
    snapshot: {
      ...batch.snapshot,
      targets: [batch.snapshot.targets[index]],
      bases: [batch.snapshot.bases[index]],
      references: [batch.snapshot.references[index]],
      blueprintRevisionIds: [batch.snapshot.blueprintRevisionIds[index]],
    },
  };
}

export default function GenerationPage() {
  const {
    project,
    setProject,
    market,
    campaign,
    resources,
    subject,
    setView,
    upload,
    changeCampaign,
  } = useWorkspace();
  const navigate = useNavigate();
  const [flow, setFlow] = useState(() =>
    project.generationFlows?.[market.id]
      ? project.generationFlows[market.id].layoutVersion === LAYOUT_VERSION
        ? cleanFlow(project.generationFlows[market.id])
        : cleanFlow(arrangeFlow(project.generationFlows[market.id]))
      : defaultFlow(market.id),
  );
  const [selectedId, setSelectedId] = useState('planner');
  const [addMarketId, setAddMarketId] = useState(market.id);
  const [modelStatus, setModelStatus] = useState('Checking local Qwen…');
  const [florenceStatus, setFlorenceStatus] = useState('Checking local Florence-2…');
  const [modelInventory, setModelInventory] = useState([]);
  const [progress, setProgress] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const plannerData = flow.nodes.find((node) => node.kind === 'planner')?.data || {};
  const selectedPlanner = {
    ...plannerData,
    modelVariant: plannerData.modelVariant || 'qwen3-vl-8b',
    modelPrecision: plannerData.modelPrecision || 'auto',
  };
  const [busy, setBusy] = useState(''),
    [message, setMessage] = useState('');
  const [queuedNodes, setQueuedNodes] = useState([]);
  const [activeNodeIds, setActiveNodeIds] = useState([]);
  const controller = useRef(null),
    queueRef = useRef([]),
    flowRef = useRef(flow),
    latest = useRef(project);
  latest.current = project;
  useEffect(() => {
    if (
      project.generationFlows?.[market.id] &&
      (project.generationFlows[market.id].layoutVersion !== LAYOUT_VERSION ||
        project.generationFlows[market.id].nodes.some(
          (node) => node.kind === 'planner' && unsupportedPlanner(node.data),
        ))
    )
      setProject((p) => ({
        ...p,
        generationFlows: {
          ...p.generationFlows,
          [market.id]: cleanFlow(
            p.generationFlows[market.id].layoutVersion === LAYOUT_VERSION
              ? p.generationFlows[market.id]
              : arrangeFlow(p.generationFlows[market.id]),
          ),
        },
      }));
  }, [market.id, setProject]);
  useEffect(
    () => () => {
      queueRef.current = [];
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const abort = new AbortController();
    setModelStatus('Checking selected planner…');
    visionCapabilities(abort.signal, selectedPlanner)
      .then((caps) => {
        if (abort.signal.aborted) return;
        setModelInventory(
          caps.planners?.filter((model) => model.id === 'qwen3-vl-8b') || [
            {
              id: selectedPlanner.modelVariant || 'qwen3-vl-8b',
              label: 'Qwen3-VL 8B Instruct',
              ...caps.qwen,
            },
          ],
        );
        (setModelStatus(
          caps.qwen?.ready
            ? `Ready · ${caps.qwen.model || 'Qwen'}${caps.qwen.quantization ? ' · 4-bit NF4' : ''} on ${caps.qwen.deviceName || caps.qwen.device || 'this machine'}`
            : caps.qwen?.message ||
                'Qwen unavailable. Formats still get the saved design or nearest measured blueprint.',
        ),
          setFlorenceStatus(
            caps.florence?.ready
              ? `Ready · ${caps.florence.model || 'Florence-2'} on ${caps.florence.deviceName || caps.florence.device || 'this machine'}${caps.ocr?.ready ? ' · PaddleOCR text on CPU' : ' · PaddleOCR not installed, using Florence-2 text'}`
              : caps.florence?.message ||
                  'Florence-2 unavailable. Layouts run without subject detection.',
          ));
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setModelStatus(
            'Local model service is offline. Formats still get the saved design or nearest measured blueprint.',
          );
          setFlorenceStatus('Local Florence-2 service is offline.');
        }
      });
    return () => abort.abort();
  }, [selectedPlanner.modelVariant, selectedPlanner.modelPrecision]);
  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    const savedFlow = project.generationFlows?.[market.id];
    const next = savedFlow
      ? savedFlow.layoutVersion === LAYOUT_VERSION
        ? cleanFlow(savedFlow)
        : cleanFlow(arrangeFlow(savedFlow))
      : defaultFlow(market.id);
    flowRef.current = next;
    setFlow(next);
    setSelectedId('planner');
    setAddMarketId(market.id);
    setBusy('');
    setMessage('');
    setProgress(null);
    setAnalysis(null);
    queueRef.current = [];
    setQueuedNodes([]);
    setActiveNodeIds([]);
  }, [market.id]);
  function changeFlow(updater, { save = true } = {}) {
    const next = typeof updater === 'function' ? updater(flowRef.current) : updater;
    flowRef.current = next;
    setFlow(next);
    if (save)
      setProject((p) => ({
        ...p,
        generationFlows: { ...(p.generationFlows || {}), [market.id]: cleanFlow(next) },
      }));
  }
  function updateData(id, patch) {
    changeFlow((old) => ({
      ...old,
      nodes: old.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...patch } } : node,
      ),
    }));
  }
  function addNode(kind) {
    if (kind !== 'output' && flowRef.current.nodes.some((n) => n.kind === kind)) {
      setSelectedId(flowRef.current.nodes.find((n) => n.kind === kind).id);
      return;
    }
    const outputs = flowRef.current.nodes.filter((n) => n.kind === 'output');
    if (flowRef.current.nodes.length >= 110 || (kind === 'output' && outputs.length >= 100)) {
      setMessage('The flow can contain at most 100 format outputs.');
      return;
    }
    const existing = new Set(flowRef.current.nodes.map((n) => n.id));
    let count = 1;
    while (existing.has(`${kind}-${count}`)) count++;
    const id = `${kind}-${count}`;
    const sameMarket = outputs.filter((node) => node.data.marketId === addMarketId);
    const lastColumn = sameMarket.length
      ? Math.max(...sameMarket.map((node) => node.position.x))
      : Math.max(560, ...outputs.map((node) => node.position.x)) + 440;
    const inColumn = sameMarket.filter((node) => node.position.x === lastColumn).length;
    const outputPosition = [
      inColumn >= 3 ? lastColumn + 440 : lastColumn,
      25 + (inColumn >= 3 ? 0 : inColumn) * 420,
    ];
    const positions = {
      image: [20, 40],
      copy: [20, 440],
      analysis: [420, 40],
      planner: [420, 300],
      output: outputPosition,
    };
    const [x, y] = positions[kind];
    const selectedTargets = new Set(
      flowRef.current.nodes
        .filter((n) => n.kind === 'output' && n.data.marketId === addMarketId)
        .map((n) => `${n.data.width}x${n.data.height}`),
    );
    const target = STARTER_TARGETS.find((t) => !selectedTargets.has(`${t.width}x${t.height}`)) || {
      width: 600,
      height: 400,
    };
    const data =
      kind === 'output'
        ? { marketId: addMarketId, ...target }
        : kind === 'planner'
          ? { enabled: true }
          : kind === 'copy'
            ? { brief: '' }
            : {};
    changeFlow((old) => {
      const added = { id, kind, position: { x, y }, data };
      const planner = old.nodes.find((node) => node.kind === 'planner');
      const connection =
        kind === 'output' && planner
          ? {
              source: planner.id,
              sourceHandle: 'drafts',
              target: id,
              targetHandle: 'drafts',
            }
          : null;
      return {
        ...old,
        nodes: [...old.nodes, added],
        edges: connection ? [...old.edges, { ...connection, id: edgeId(connection) }] : old.edges,
      };
    });
    setSelectedId(id);
  }
  function addMarketFormats(allSizes = false) {
    const current = flowRef.current;
    const existing = new Set(
      current.nodes
        .filter((n) => n.kind === 'output' && n.data.marketId === addMarketId)
        .map((n) => `${n.data.width}x${n.data.height}`),
    );
    const sizes = allSizes
      ? project.blueprints
          .filter((entry) => entry.marketId === addMarketId)
          .map((entry) => {
            const bp = entry.versions.find(
              (version) => version.id === entry.activeVersionId,
            ).blueprint;
            return { width: bp.width, height: bp.height };
          })
      : STARTER_TARGETS;
    const targets = [
      ...new Map(sizes.map((size) => [`${size.width}x${size.height}`, size])).values(),
    ].filter((t) => !existing.has(`${t.width}x${t.height}`));
    if (!targets.length) {
      setMessage('These formats are already on the canvas.');
      return;
    }
    if (
      current.nodes.length + targets.length > 110 ||
      current.nodes.filter((n) => n.kind === 'output').length + targets.length > 100
    ) {
      setMessage('The flow can contain at most 100 format outputs.');
      return;
    }
    const nextColumn =
      Math.max(560, ...current.nodes.filter((n) => n.kind === 'output').map((n) => n.position.x)) +
      440;
    let seq = 1;
    const used = new Set(current.nodes.map((n) => n.id));
    const nodes = targets.map((target, index) => {
      while (used.has(`output-${seq}`)) seq++;
      const id = `output-${seq++}`;
      used.add(id);
      return {
        id,
        kind: 'output',
        position: { x: nextColumn + Math.floor(index / 3) * 440, y: 25 + (index % 3) * 420 },
        data: { marketId: addMarketId, ...target },
      };
    });
    changeFlow((old) => ({
      ...old,
      nodes: [...old.nodes, ...nodes],
      edges: old.nodes.some((n) => n.kind === 'planner')
        ? [
            ...old.edges,
            ...nodes.map((n) => ({
              id: edgeId({
                source: old.nodes.find((x) => x.kind === 'planner').id,
                sourceHandle: 'drafts',
                target: n.id,
                targetHandle: 'drafts',
              }),
              source: old.nodes.find((x) => x.kind === 'planner').id,
              sourceHandle: 'drafts',
              target: n.id,
              targetHandle: 'drafts',
            })),
          ]
        : old.edges,
    }));
    setSelectedId(nodes[0].id);
    setMessage(
      `${targets.length} format nodes added for ${project.markets.find((m) => m.id === addMarketId)?.name}.`,
    );
  }
  const run = project.generationRuns?.filter((r) => r.ownerMarketId === market.id).at(-1);
  const oldBatch = project.generationBatches
    ?.filter((b) => b.snapshot.market.id === market.id)
    .at(-1);
  const batches = run
    ? run.batchIds.map((id) => project.generationBatches?.find((b) => b.id === id)).filter(Boolean)
    : oldBatch
      ? [oldBatch]
      : [];
  // A running generation only blocks actions that would clash with it; the map stays usable.
  const disabled = subject.placing || Boolean(busy);
  let readiness = '';
  try {
    compileFlow(cleanFlow(flow), project);
  } catch (error) {
    readiness = error.message;
  }
  const selectedNode = flow.nodes.find((n) => n.id === selectedId);
  function queueState() {
    setQueuedNodes(queueRef.current.map((job) => job.key));
  }
  async function analyzeCurrentImage() {
    if (controller.current || subject.placing) return;
    const abort = new AbortController();
    controller.current = abort;
    const startedAt = Date.now();
    setBusy('Analyzing the image with Florence-2…');
    setProgress({
      completed: 0,
      total: 1,
      percent: 0,
      label: 'Analyzing image with Florence-2',
      stage: 'analysis',
      startedAt,
    });
    setMessage('');
    try {
      if (!campaign.heroAssetId) throw new Error('Add a campaign image before analysis.');
      const capabilities = await visionCapabilities(abort.signal, selectedPlanner);
      const evidence = await prepareGeneration(campaign, null, {
        signal: abort.signal,
        capabilities,
      });
      abort.signal.throwIfAborted();
      setAnalysis({ assetId: campaign.heroAssetId, evidence });
      setProgress({
        completed: 1,
        total: 1,
        percent: 100,
        label: 'Image analysis ready',
        startedAt,
      });
      setMessage('Image analyzed. Review the detected subjects, then generate layouts.');
    } catch (error) {
      if (!abort.signal.aborted) {
        setMessage(error.message);
        setProgress((old) => ({ ...old, label: error.message }));
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy('');
      }
    }
  }
  function cancelGeneration() {
    queueRef.current = [];
    setQueuedNodes([]);
    controller.current?.abort();
    setProgress((old) => (old ? { ...old, label: 'Workflow cancelled' } : null));
  }
  async function generate(outputNodeId = null, queuedJob = null) {
    let job = queuedJob;
    if (!job) {
      try {
        const workflow = cleanFlow(flowRef.current);
        const config = compileFlow(workflow, latest.current, { outputNodeId });
        if (config.groups.length > 20) throw new Error('Run up to 20 markets at once.');
        job = {
          key: outputNodeId,
          outputNodeId,
          workflow,
          config,
          snapshots: config.groups.map((group) =>
            generationSnapshot(
              latest.current,
              group.marketId,
              group.outputs.map((n) => ({ width: n.data.width, height: n.data.height })),
            ),
          ),
        };
      } catch (error) {
        setMessage(error.message);
        return;
      }
    }
    if (controller.current) {
      if (!queueRef.current.some((pending) => pending.key === job.key)) {
        if (queueRef.current.length >= 8) {
          setMessage('The generation queue is full (8 waiting jobs).');
          return;
        }
        queueRef.current.push(job);
        queueState();
      }
      return;
    }
    setMessage('');
    const abort = new AbortController();
    controller.current = abort;
    setBusy('Checking connected nodes…');
    const startedAt = Date.now();
    setProgress({
      ...workflowProgress(job.config.groups, 0, { stage: 'source' }),
      stage: 'source',
      label: 'Preparing workflow',
      startedAt,
    });
    const reportProgress = (groupIndex, text, event = {}) => {
      setBusy(`${job.config.groups[groupIndex].marketId} · ${text}`);
      setProgress((old) => ({
        ...workflowProgress(job.config.groups, groupIndex, event, old?.completed),
        label: text,
        stage: event.stage || old?.stage,
        targetId:
          event.stage === 'layout'
            ? job.config.groups[groupIndex].outputs[event.index || 0]?.id
            : null,
        startedAt,
      }));
    };
    try {
      const { config } = job;
      const results = [],
        notices = [];
      for (const [groupIndex, group] of config.groups.entries()) {
        abort.signal.throwIfAborted();
        setActiveNodeIds(group.outputs.map((node) => node.id));
        if (config.automaticAnalysis) {
          // An optional cut-out keeps the subject crisp above the photo fade.
          let cut;
          try {
            cut = await ensureSubjectCutout(job.snapshots[groupIndex].campaign, {
              signal: abort.signal,
              onProgress: (text, event) => reportProgress(groupIndex, text, event),
            });
          } catch (error) {
            abort.signal.throwIfAborted();
            cut = { notice: `Cut-out skipped: ${error.message}` };
          }
          if (cut.patch) {
            const p = latest.current,
              current = p.campaigns[group.marketId];
            abort.signal.throwIfAborted();
            Object.assign(job.snapshots[groupIndex].campaign, cut.patch);
            if (current.heroAssetId === cut.patch.heroCutout.sourceAssetId) {
              latest.current = {
                ...p,
                assets: p.assets.some((a) => a.id === cut.asset.id)
                  ? p.assets
                  : [...p.assets, cut.asset],
                campaigns: { ...p.campaigns, [group.marketId]: { ...current, ...cut.patch } },
              };
              setProject(latest.current);
            }
          } else if (cut.notice) notices.push(cut.notice);
        }
        const snapshot = job.snapshots[groupIndex];
        let batch;
        try {
          batch = await generateBatch(snapshot, {
            signal: abort.signal,
            brief: config.brief,
            usePlanner: config.usePlanner,
            automaticAnalysis: config.automaticAnalysis,
            modelVariant: config.modelVariant,
            modelPrecision: config.modelPrecision,
            onProgress: (text, event) => reportProgress(groupIndex, text, event),
          });
        } catch (error) {
          // One market's failure must not discard the other markets' finished drafts.
          if (abort.signal.aborted) throw error;
          notices.push(`${group.marketId}: ${error.message}`);
          continue;
        }
        results.push({
          ...batch,
          workflow: job.workflow,
          outputNodeIds: group.outputs.map((n) => n.id),
        });
      }
      if (abort.signal.aborted) {
        setMessage('Graph run cancelled; previous drafts were retained.');
        return;
      }
      for (const batch of results) {
        if (batch.layout?.fallback) notices.push(`Qwen: ${batch.layout.reason}`);
        for (const notice of batch.analysis?.notices || []) notices.push(notice);
      }
      setProject((p) => ({
        ...p,
        generationBatches: [
          ...(p.generationBatches || []).filter((b) => !results.some((r) => r.id === b.id)),
          ...results,
        ].slice(-20),
        generationRuns: [
          ...(p.generationRuns || []),
          { ownerMarketId: market.id, batchIds: results.map((r) => r.id) },
        ].slice(-20),
      }));
      if (outputNodeId) setSelectedId(outputNodeId);
      setProgress((old) => ({
        ...old,
        completed: old.total,
        percent: 100,
        label: 'Draft generation complete',
      }));
      if (notices.length) setMessage([...new Set(notices)].join(' '));
    } catch (error) {
      if (!abort.signal.aborted) {
        setMessage(error.message);
        setProgress((old) => (old ? { ...old, label: error.message } : null));
      }
    } finally {
      if (controller.current === abort) {
        controller.current = null;
        setBusy('');
        setActiveNodeIds([]);
        const next = queueRef.current.shift();
        queueState();
        if (next) queueMicrotask(() => generate(next.outputNodeId, next));
      }
    }
  }
  async function accept(selectedBatch) {
    try {
      await assertBatchCorrectionsCurrent(selectedBatch);
      setProject(acceptBatch(latest.current, selectedBatch));
      setMessage('Drafts added to Studio. Previous banners can be restored with Undo generation.');
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function suggestCopy(marketId, role, maxChars) {
    const campaign = latest.current.campaigns[marketId];
    const locale = latest.current.markets.find((m) => m.id === marketId)?.locale || 'en';
    let suggestions = [],
      failure = null;
    try {
      suggestions = await suggestShorterCopy({ role, text: campaign[role], maxChars, locale });
    } catch (error) {
      failure = error;
    }
    // Always offer the leading whole words of the supplied copy: nothing invented.
    const lead = leadingWords(campaign[role], maxChars);
    if (lead && !suggestions.includes(lead)) suggestions = [...suggestions, lead];
    if (!suggestions.length) throw failure || new Error('No shorter version fits this size.');
    return suggestions;
  }
  function setCopyFit(marketId, size, role, text) {
    setProject((p) => {
      const campaign = p.campaigns[marketId];
      const fits = { ...(campaign.copyFits?.[size] || {}) };
      if (text == null) delete fits[role];
      else fits[role] = text;
      const copyFits = { ...(campaign.copyFits || {}), [size]: fits };
      if (!Object.keys(fits).length) delete copyFits[size];
      return { ...p, campaigns: { ...p.campaigns, [marketId]: { ...campaign, copyFits } } };
    });
    const [w, h] = size.split('x');
    setMessage(
      text == null
        ? `${w} × ${h} uses the full ${role} again. Generate this size again.`
        : `Approved a shorter ${role} for ${w} × ${h} only. Generate this size again.`,
    );
  }
  async function acceptOutput(nodeId) {
    const node = flowRef.current.nodes.find((candidate) => candidate.id === nodeId);
    const result = latestOutput(latest.current, node);
    if (!result || result.item.state !== 'succeeded') return;
    await accept(onlyOutput(result.batch, result.item));
  }
  function openOutput(nodeId) {
    const node = flowRef.current.nodes.find((candidate) => candidate.id === nodeId);
    const result = latestOutput(latest.current, node);
    if (!result?.item.scene) return;
    navigate(
      `/campaign/${encodeURIComponent(result.item.scene.id)}/edit?market=${encodeURIComponent(node.data.marketId)}`,
    );
  }
  async function downloadOutput(nodeId) {
    try {
      const node = flowRef.current.nodes.find((candidate) => candidate.id === nodeId);
      const result = latestOutput(latest.current, node);
      if (result?.item.state !== 'succeeded') return;
      const resources = await loadResources(result.batch.snapshot.campaign);
      const blob = await renderOutput(
        result.item.scene,
        result.batch.snapshot.campaign,
        resources,
        'png',
      );
      download(blob, `${node.data.marketId}-${node.data.width}x${node.data.height}-draft.png`);
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function exportDrafts() {
    if (!batches.length) return;
    setBusy('Exporting generated drafts…');
    try {
      download(
        await exportBatch(
          batches.find((batch) => batch.snapshot.market.id === market.id) || batches[0],
          { onProgress: setBusy },
        ),
        'bannerflow-generated-drafts.zip',
      );
      setMessage('Draft ZIP includes every requested size and a manifest.');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }
  async function acceptAll() {
    try {
      for (const batch of batches) await assertBatchCorrectionsCurrent(batch);
      setProject((projectBefore) => {
        const accepted = [];
        let next = projectBefore;
        for (const batch of batches) {
          next = acceptBatch(next, batch);
          accepted.push(...next.generationUndo.accepted);
        }
        if (batches.length > 1)
          next.generationUndo = {
            batchId: batches.at(-1).id,
            marketId: market.id,
            accepted,
          };
        return next;
      });
      setMessage('Drafts added to Studio. Previous banners can be restored with Undo generation.');
    } catch (error) {
      setMessage(error.message);
    }
  }
  async function exportAllMarkets() {
    setBusy('Exporting market matrix…');
    try {
      download(
        await exportMatrix(batches, { onProgress: setBusy }),
        'bannerflow-market-matrix.zip',
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }
  function undoGeneration() {
    try {
      setProject(undoBatch(latest.current));
      setMessage('Previous banners restored.');
    } catch (error) {
      setMessage(error.message);
    }
  }
  const toolbar = (
    <>
      <Button variant="secondary" disabled={disabled} onClick={() => addNode('output')}>
        <Plus size={15} /> Add format
      </Button>
      <label className="create-market-picker">
        Market for new formats
        <select
          value={addMarketId}
          onChange={(event) => setAddMarketId(event.target.value)}
          disabled={disabled}
        >
          {project.markets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <Button variant="secondary" disabled={disabled} onClick={() => addMarketFormats()}>
        <Plus size={15} /> Add market formats
      </Button>
      <Button variant="secondary" disabled={disabled} onClick={() => addMarketFormats(true)}>
        <Plus size={15} /> Add all market sizes
      </Button>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => changeFlow((old) => arrangeFlow(old))}
      >
        Arrange nodes
      </Button>
      <select
        className="create-add-node-select"
        aria-label="Add node"
        value=""
        disabled={disabled}
        onChange={(event) => {
          addNode(event.target.value);
          event.target.value = '';
        }}
      >
        <option value="">Add node</option>
        {NODE_KINDS.filter((kind) => kind !== 'output').map((kind) => (
          <option key={kind} value={kind} disabled={flow.nodes.some((node) => node.kind === kind)}>
            {kind === 'planner' ? 'Qwen layout' : kind}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        disabled={disabled || !selectedNode}
        onClick={() => {
          const doomed = new Set(
            flow.nodes.filter((node) => node.selected || node.id === selectedId).map((n) => n.id),
          );
          changeFlow((old) => ({
            ...old,
            nodes: old.nodes.filter((node) => !doomed.has(node.id)),
            edges: old.edges.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
          }));
          setSelectedId(null);
        }}
      >
        <Trash2 size={14} /> Remove selected
      </Button>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          changeFlow(defaultFlow(market.id));
          setSelectedId('planner');
        }}
      >
        <RotateCcw size={14} /> Reset flow
      </Button>
    </>
  );
  return (
    <main className="create-flow-page" aria-label="Create flow">
      <CreateGraph
        key={market.id}
        flow={flow}
        changeFlow={changeFlow}
        selectedId={selectedId}
        onSelect={setSelectedId}
        project={project}
        marketId={market.id}
        changeCampaign={changeCampaign}
        batches={batches}
        onAnalyzeImage={analyzeCurrentImage}
        analysis={analysis?.assetId === campaign.heroAssetId ? analysis.evidence : null}
        progress={progress}
        modelInventory={modelInventory}
        onAcceptAll={acceptAll}
        onExportDrafts={exportDrafts}
        onExportMatrix={exportAllMarkets}
        onUndoGeneration={undoGeneration}
        canUndo={project.generationUndo?.marketId === market.id}
        onCancelGeneration={cancelGeneration}
        toolbar={toolbar}
        statusText={
          busy ||
          message ||
          readiness ||
          `${flow.nodes.length} nodes · ${flow.edges.length} connections · ready to run`
        }
        image={resources?.hero}
        modelStatus={modelStatus}
        florenceStatus={florenceStatus}
        latestOutput={(node) => latestOutput(project, node)}
        onRunOutput={(id) => generate(id)}
        onRunConnected={() => generate()}
        onSuggestCopy={suggestCopy}
        onApproveCopy={(marketId, size, role, text) => setCopyFit(marketId, size, role, text)}
        onClearCopy={(marketId, size, role) => setCopyFit(marketId, size, role, null)}
        onAcceptOutput={acceptOutput}
        onOpenOutput={openOutput}
        onDownloadOutput={downloadOutput}
        onEditCampaign={() => setView('campaign')}
        onUploadImage={(file) => upload(file, 'hero')}
        updateData={updateData}
        busy={busy}
        queuedNodes={queuedNodes}
        onRemoveQueued={(key) => {
          queueRef.current = queueRef.current.filter((job) => job.key !== key);
          queueState();
        }}
        activeNodeIds={activeNodeIds}
        placementLocked={subject.placing}
        disabled={disabled}
      />
    </main>
  );
}
