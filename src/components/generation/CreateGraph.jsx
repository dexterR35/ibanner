import { memo, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import CopyFitPanel from './CopyFitPanel.jsx';
import WorkflowProgress from './WorkflowProgress.jsx';
import {
  Image,
  Type,
  ScanSearch,
  Sparkles,
  MonitorPlay,
  Play,
  Check,
  Download,
  Undo2,
  X,
  Group,
  Ungroup,
  Maximize2,
  MousePointer2,
  Hand,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '../ui/index.js';
import BannerPreview from '../banner/BannerPreview.jsx';
import { useResources } from '../../hooks/useProject.js';
import { canConnect, edgeId, PORTS } from '../../core/generation/flow.js';
import { STARTER_TARGETS } from '../../data/generation-targets.js';
import { snapshotIsCurrent } from '../../core/generation/batch.js';

const icons = {
  image: Image,
  copy: Type,
  analysis: ScanSearch,
  planner: Sparkles,
  output: MonitorPlay,
};
const names = {
  image: 'Campaign image',
  copy: 'Campaign copy',
  analysis: 'Analyze image',
  planner: 'Qwen layout',
  output: 'Format output',
};
const FRAME_PADDING = 36;
// Leaves room for the floating toolbar above the map.
const FIT = {
  padding: { top: '130px', right: '40px', bottom: '40px', left: '40px' },
  minZoom: 0.2,
  maxZoom: 0.9,
};
/** Pixel size of a node on the map. Image and format nodes follow their picture's proportions. */
function nodeSize(kind, data, image) {
  return {
    width: kind === 'planner' ? 390 : 340,
    height: { image: 350, copy: 390, analysis: 370, planner: 620, output: 510 }[kind],
  };
}
function OutputStage({ item, campaign, width, height }) {
  const { resources } = useResources(campaign);
  const ready = item?.scene && resources;
  return (
    <div className="create-node-stage" style={{ aspectRatio: `${width} / ${height}` }}>
      {ready ? (
        <BannerPreview blueprint={item.scene} campaign={campaign} resources={resources} />
      ) : (
        <span className="create-node-stage-empty">
          {width} × {height}
        </span>
      )}
    </div>
  );
}
function FullImage({ image }) {
  const canvas = useRef(null);
  useEffect(() => {
    if (!image?.naturalWidth || !canvas.current) return;
    const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.current.width = Math.round(image.naturalWidth * scale);
    canvas.current.height = Math.round(image.naturalHeight * scale);
    canvas.current
      .getContext('2d')
      .drawImage(image, 0, 0, canvas.current.width, canvas.current.height);
  }, [image]);
  return (
    <canvas
      ref={canvas}
      className="create-node-fill"
      aria-label="Current campaign source"
      width={1}
      height={1}
    />
  );
}
function analysisText({ observations }) {
  const paddle = observations.ocr?.ocr;
  const count = (paddle || observations.florence?.ocr || []).length,
    plural = count === 1 ? '' : 's';
  return paddle
    ? `${count} PaddleOCR text line${plural}`
    : `${count} Florence-2 text region${plural}`;
}
function AnalysisPreview({ image, evidence }) {
  const canvas = useRef(null);
  useEffect(() => {
    if (!canvas.current || !image?.naturalWidth || !evidence) return;
    const scale = Math.min(1, 600 / image.naturalWidth);
    const surface = canvas.current;
    surface.width = image.naturalWidth * scale;
    surface.height = image.naturalHeight * scale;
    const ctx = surface.getContext('2d');
    ctx.drawImage(image, 0, 0, surface.width, surface.height);
    // PaddleOCR text lines in blue, under the Florence-2 object labels.
    ctx.strokeStyle = '#7cc4ff';
    ctx.lineWidth = 1.5;
    for (const { box } of evidence.observations.ocr?.ocr || [])
      ctx.strokeRect(
        box.x * surface.width,
        box.y * surface.height,
        box.width * surface.width,
        box.height * surface.height,
      );
    for (const { label, box } of evidence.observations.florence?.provenance?.objects || []) {
      const x = box.x * surface.width,
        y = box.y * surface.height;
      ctx.strokeStyle = '#b9fa78';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, box.width * surface.width, box.height * surface.height);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#111a18';
      ctx.fillRect(x, y, ctx.measureText(label).width + 6, 16);
      ctx.fillStyle = '#d7ffb6';
      ctx.fillText(label, x + 3, y + 12);
    }
  }, [image, evidence]);
  return evidence && image ? (
    <canvas
      ref={canvas}
      className="create-analysis-preview"
      aria-label="Analyzed image object boxes"
    />
  ) : null;
}
function NodeAction({
  label,
  shortLabel,
  onClick,
  icon: Icon,
  primary = false,
  disabled = false,
  loading = false,
}) {
  return (
    <button
      type="button"
      className={`create-node-action nodrag nowheel ${primary ? 'create-node-action-primary' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {loading ? <LoaderCircle size={14} className="create-spin" /> : <Icon size={14} />}
      <span>{shortLabel || label}</span>
    </button>
  );
}
const CreateNode = memo(function CreateNode({ data }) {
  const Icon = icons[data.kind];
  const visual = data.kind === 'image' || data.kind === 'output';
  const inputs = Object.entries(PORTS[data.kind].inputs);
  const outputs = Object.entries(PORTS[data.kind].outputs);
  return (
    <article
      className={`create-node create-node-${data.kind} ${visual ? 'create-node-visual' : ''} ${data.thin ? 'create-node-thin' : ''} ${data.status ? `create-node-${data.status}` : ''}`}
      aria-label={`${data.title || names[data.kind]} node`}
    >
      <header>
        <span className="create-node-icon">
          <Icon size={16} />
        </span>
        <strong>{data.title || names[data.kind]}</strong>
        <span className="create-node-tag">
          {data.status ||
            {
              image: '01 · Source',
              copy: '01 · Copy',
              analysis: '02 · Analyze',
              planner: '03 · Layout',
              output: 'Output',
            }[data.kind]}
        </span>
      </header>
      <div className="create-node-content nowheel" onWheel={(event) => event.stopPropagation()}>
        {data.kind === 'image' &&
          (data.image ? (
            <FullImage image={data.image} />
          ) : (
            <span className="create-node-stage-empty">Choose an image</span>
          ))}
        {data.kind === 'copy' && (
          <div className="create-node-copy">
            {['headline', 'subtitle', 'cta', 'legal'].map((field) => (
              <label className="create-node-field" key={field}>
                <span>{field}</span>
                <input
                  className="create-node-input nodrag nowheel"
                  aria-label={`${data.marketName} ${field}`}
                  value={data.campaign?.[field] || ''}
                  disabled={data.disabled}
                  onPointerDown={(event) => event.stopPropagation()}
                  onChange={(event) => data.changeCampaign({ [field]: event.target.value })}
                />
              </label>
            ))}
            <label className="create-node-field">
              <span>Creative brief</span>
              <input
                className="create-node-input nodrag nowheel"
                aria-label="Creative brief in copy node"
                placeholder="Describe the composition"
                value={data.brief || ''}
                disabled={data.disabled}
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) => data.updateData({ brief: event.target.value })}
              />
            </label>
          </div>
        )}
        {data.kind === 'analysis' && (
          <>
            <p>Florence-2 objects · PaddleOCR text</p>
            <p>{data.florenceStatus}</p>
            <AnalysisPreview
              image={data.sourceImage}
              evidence={data.analysis || data.batch?.analysis}
            />
            {(data.analysis || data.batch?.analysis) && (
              <p>
                {analysisText(data.analysis || data.batch.analysis)},{' '}
                {(data.analysis || data.batch.analysis).observations.florence?.provenance?.objects
                  ?.length || 0}{' '}
                object regions. Subject placement:{' '}
                {(data.analysis || data.batch.analysis).focusSource.replaceAll('-', ' ')}.{' '}
                {(data.analysis || data.batch.analysis).notices.join(' ')}
              </p>
            )}
          </>
        )}
        {data.kind === 'planner' && (
          <>
            <label
              className="create-model-field nodrag nowheel"
              onPointerDown={(event) => event.stopPropagation()}
            >
              Planner model
              <select
                aria-label="Planner model"
                value={data.modelVariant || 'qwen3-vl-8b'}
                disabled={data.disabled}
                onChange={(event) =>
                  data.updateData({ modelVariant: event.target.value, modelPrecision: 'auto' })
                }
              >
                {data.modelInventory.map((model) => (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!model.ready && model.id !== (data.modelVariant || 'qwen3-vl-8b')}
                  >
                    {model.label || model.model || model.id}
                    {model.ready ? '' : ' · unavailable'}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="create-model-field nodrag nowheel"
              onPointerDown={(event) => event.stopPropagation()}
            >
              Precision
              <select
                aria-label="Planner precision"
                value={data.modelPrecision || 'auto'}
                disabled={data.disabled}
                onChange={(event) => data.updateData({ modelPrecision: event.target.value })}
              >
                <option value="auto">Auto · fit this machine</option>
                <option
                  value="nf4"
                  disabled={Boolean(data.modelVariant && data.modelVariant !== 'qwen3-vl-8b')}
                >
                  4-bit NF4 · CUDA
                </option>
                <option value="bf16">Full weights</option>
              </select>
            </label>
            <p>
              Qwen places every connected format with your nearest references as examples. Each size
              keeps the best of the saved design, the nearest reference and Qwen's layouts; text
              fits and the photo crop adapts, nothing is blocked.
            </p>
            <label
              className="create-node-toggle nodrag nowheel"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <input
                aria-label="Use Qwen layout"
                type="checkbox"
                checked={data.enabled !== false}
                disabled={data.disabled}
                onChange={(event) => data.updateData({ enabled: event.target.checked })}
              />
              <span>
                {data.enabled === false
                  ? 'Qwen off · saved designs and measured blueprints only'
                  : data.modelStatus.startsWith('Ready')
                    ? 'Qwen ready'
                    : 'Offline · saved designs and measured blueprints'}
              </span>
            </label>
            <p>{data.modelStatus}</p>
            {data.batch?.layout?.fallback && (
              <p>
                Qwen not used: {data.batch.layout.reason} Formats used the saved design or the
                nearest reference.
              </p>
            )}
            {data.batch?.layout?.elapsedMs != null && (
              <p>Qwen placed layouts in {Math.round(data.batch.layout.elapsedMs / 1000)} s.</p>
            )}
            {data.batches.length > 0 && (
              <div
                className="create-node-batch-actions nodrag nowheel"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <p>
                  {data.batches
                    .map(
                      (batch) =>
                        `${batch.snapshot.market.name}: ${batch.items.filter((item) => item.state === 'succeeded').length} of ${batch.items.length} drafts`,
                    )
                    .join(' · ')}
                </p>
                <NodeAction
                  label="Use all drafts in Studio"
                  icon={Check}
                  disabled={
                    data.disabled ||
                    data.busy ||
                    !data.batches.some((batch) =>
                      batch.items.some((item) => item.state === 'succeeded'),
                    ) ||
                    data.batches.some((batch) => !snapshotIsCurrent(batch.snapshot, data.project))
                  }
                  onClick={data.acceptAll}
                />
                <NodeAction
                  label="Export generated drafts"
                  icon={Download}
                  disabled={data.disabled || data.busy}
                  onClick={data.exportDrafts}
                />
                {data.batches.length > 1 && (
                  <NodeAction
                    label="Export entire market matrix"
                    icon={Download}
                    disabled={data.disabled || data.busy}
                    onClick={data.exportMatrix}
                  />
                )}
              </div>
            )}
            {data.canUndo && (
              <NodeAction
                label="Undo generation"
                icon={Undo2}
                disabled={data.disabled || data.busy}
                onClick={data.undoGeneration}
              />
            )}
            {data.busy && (
              <NodeAction label="Cancel generation" icon={X} onClick={data.cancelGeneration} />
            )}
          </>
        )}
        {data.kind === 'output' && (
          <OutputStage
            item={data.item}
            campaign={data.campaign}
            width={data.width}
            height={data.height}
          />
        )}
      </div>
      {data.status === 'running' && <WorkflowProgress progress={data.progress} busy compact />}
      <footer className="create-node-footer nodrag nowheel">
        {data.kind === 'output' && (
          <>
            <div
              className="create-node-output-settings nodrag nowheel"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <select
                aria-label={`Market for ${data.title}`}
                value={data.marketId}
                disabled={data.disabled}
                onChange={(event) => data.updateData({ marketId: event.target.value })}
              >
                {data.markets.map((market) => (
                  <option key={market.id} value={market.id}>
                    {market.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Size for ${data.title}`}
                value={`${data.width}x${data.height}`}
                disabled={data.disabled}
                onChange={(event) => {
                  const [width, height] = event.target.value.split('x').map(Number);
                  data.updateData({ width, height });
                }}
              >
                {data.sizes.map((size) => (
                  <option key={size} value={size}>
                    {size.replace('x', ' × ')}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="create-node-dimensions nodrag nowheel"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <label>
                W
                <input
                  key={`${data.title}-width`}
                  aria-label="Custom width"
                  type="number"
                  min="32"
                  max="4096"
                  defaultValue={data.width}
                  disabled={data.disabled}
                  onBlur={(event) =>
                    data.updateData({
                      width: Math.max(32, Math.min(4096, Number(event.target.value) || data.width)),
                    })
                  }
                />
              </label>
              <label>
                H
                <input
                  key={`${data.title}-height`}
                  aria-label="Custom height"
                  type="number"
                  min="32"
                  max="4096"
                  defaultValue={data.height}
                  disabled={data.disabled}
                  onBlur={(event) =>
                    data.updateData({
                      height: Math.max(
                        32,
                        Math.min(4096, Number(event.target.value) || data.height),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <CopyFitPanel
              item={data.item}
              campaign={data.campaign}
              size={`${data.width}x${data.height}`}
              disabled={data.disabled}
              suggest={data.suggestCopy}
              approve={data.approveCopy}
              clear={data.clearCopy}
            />
            <small className="create-node-decision">
              {data.item
                ? data.item.state === 'succeeded'
                  ? `Layout: ${SOURCE_NAMES[data.item.source] || data.item.source}${data.item.copyIssues?.length ? ` · ${data.item.copyIssues.length} copy too long` : ''}`
                  : data.item.message || data.item.state
                : data.connected
                  ? 'Connected · ready to generate'
                  : 'Connect Qwen layout to enable'}
            </small>
            {data.item && !data.current && (
              <small className="create-node-decision">
                Inputs changed. Generate again before using this draft.
              </small>
            )}
            {data.item && (
              <div className="create-node-output-actions">
                {data.item.state === 'succeeded' && (
                  <>
                    <NodeAction
                      label={data.accepted ? 'Added to Studio' : `Use ${data.title} in Studio`}
                      shortLabel={data.accepted ? 'In Studio' : 'Use in Studio'}
                      icon={Check}
                      disabled={data.disabled || data.accepted || !data.current}
                      onClick={data.accept}
                    />
                    <NodeAction
                      label={`Download ${data.title} PNG`}
                      icon={Download}
                      disabled={data.disabled}
                      onClick={data.download}
                    />
                    {data.accepted && (
                      <NodeAction
                        label={`Edit ${data.title} in Studio`}
                        icon={Image}
                        disabled={data.disabled}
                        onClick={data.open}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
        {data.kind === 'image' && (
          <label className="create-node-action create-node-upload nodrag nowheel">
            <Image size={13} />
            <span>{data.image ? 'Replace image' : 'Upload image'}</span>
            <input
              type="file"
              aria-label="Upload campaign image from node"
              accept="image/png,image/jpeg,image/webp"
              disabled={data.disabled}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) data.uploadImage(file);
                event.target.value = '';
              }}
            />
          </label>
        )}
        {data.kind === 'image' || data.kind === 'copy' ? (
          <NodeAction
            label="Edit in Studio"
            icon={Image}
            disabled={data.disabled}
            onClick={data.editCampaign}
          />
        ) : null}
        {data.kind === 'analysis' && (
          <NodeAction
            label="Analyze image"
            icon={ScanSearch}
            primary
            disabled={data.disabled || !data.hasImage}
            loading={data.status === 'running'}
            onClick={data.analyzeImage}
          />
        )}
        {data.kind === 'planner' && (
          <NodeAction
            label="Generate layouts"
            icon={Play}
            primary
            disabled={data.disabled || data.queued || !data.connected}
            loading={data.status === 'running'}
            onClick={data.runConnected}
          />
        )}
        {data.kind === 'output' && (
          <NodeAction
            label={`Generate ${data.title} only`}
            icon={Play}
            primary
            disabled={data.disabled || data.queued || !data.connected}
            loading={data.status === 'running'}
            onClick={data.runOutput}
          />
        )}
      </footer>
      <div className="create-node-ports">
        {inputs.map(([port, type], index) => (
          <div
            className="create-node-port create-node-port-in"
            key={port}
            style={{ top: 55 + index * 29 }}
          >
            <Handle id={port} type="target" position={Position.Left} />
            <span>{type}</span>
          </div>
        ))}
        {outputs.map(([port, type], index) => (
          <div
            className="create-node-port create-node-port-out"
            key={port}
            style={{ top: 55 + index * 29 }}
          >
            <span>{type}</span>
            <Handle id={port} type="source" position={Position.Right} />
          </div>
        ))}
      </div>
    </article>
  );
});
const FrameNode = memo(function FrameNode({ data, selected }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`create-frame ${selected ? 'create-frame-selected' : ''}`}>
      {editing ? (
        <input
          className="create-frame-name nodrag nowheel"
          aria-label="Group name"
          autoFocus
          defaultValue={data.name}
          maxLength={80}
          onBlur={(event) => {
            data.rename(event.target.value.trim() || data.name);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
          }}
        />
      ) : (
        <button
          type="button"
          className="create-frame-name"
          title="Drag to move the group. Double-click to rename."
          onDoubleClick={() => setEditing(true)}
        >
          {data.name} <small>{data.count}</small>
        </button>
      )}
    </div>
  );
});
const nodeTypes = { create: CreateNode, frame: FrameNode };
const SOURCE_NAMES = {
  design: 'saved design',
  reference: 'nearest measured blueprint',
  qwen: 'Qwen',
  'qwen+reference-photo': 'Qwen + example photo frame',
};

export default function CreateGraph({
  flow,
  changeFlow,
  selectedId,
  onSelect,
  project,
  marketId,
  changeCampaign,
  batches,
  onAnalyzeImage,
  analysis,
  progress,
  modelInventory = [],
  onAcceptAll,
  onExportDrafts,
  onExportMatrix,
  onUndoGeneration,
  canUndo,
  onCancelGeneration,
  toolbar,
  statusText,
  image,
  modelStatus,
  florenceStatus,
  latestOutput,
  onRunOutput,
  onAcceptOutput,
  onOpenOutput,
  onDownloadOutput,
  onEditCampaign,
  onUploadImage,
  onRunConnected,
  onSuggestCopy,
  onApproveCopy,
  onClearCopy,
  updateData,
  busy,
  queuedNodes,
  onRemoveQueued,
  activeNodeIds,
  placementLocked,
  disabled,
}) {
  const flowInstance = useRef(null);
  const [frameSelection, setFrameSelection] = useState([]);
  // Pan: drag the map. Select: drag a box around nodes to group or move them together.
  const [selectMode, setSelectMode] = useState(false);
  const previousCount = useRef(flow.nodes.length);
  useEffect(() => {
    const added = flow.nodes.length > previousCount.current;
    previousCount.current = flow.nodes.length;
    if (!added) return;
    const timer = setTimeout(() => flowInstance.current?.fitView({ ...FIT, duration: 250 }), 80);
    return () => clearTimeout(timer);
  }, [flow.nodes.length]);
  const nodes = flow.nodes.map((node) => {
    const { marketId: nodeMarketId, width, height } = node.data;
    const result = node.kind === 'output' ? latestOutput(node) : null;
    const item = result?.item;
    const campaign = project.campaigns[nodeMarketId || marketId];
    const sizes = [
      ...new Set([
        ...STARTER_TARGETS.map((target) => `${target.width}x${target.height}`),
        ...project.blueprints
          .filter((entry) => entry.marketId === (nodeMarketId || marketId))
          .map((entry) => {
            const bp = entry.versions.find((v) => v.id === entry.activeVersionId).blueprint;
            return `${bp.width}x${bp.height}`;
          }),
        `${width}x${height}`,
      ]),
    ];
    const connected = flow.edges.some((edge) =>
      node.kind === 'planner'
        ? edge.source === node.id && edge.sourceHandle === 'drafts'
        : edge.target === node.id && edge.targetHandle === 'drafts',
    );
    const current = result ? snapshotIsCurrent(result.batch.snapshot, project) : false;
    const accepted = Boolean(
      item?.scene && project.banners[item.scene.id]?.generation?.batchId === result.batch.id,
    );
    let status = item?.state;
    if (item && !current) status = 'stale';
    if (accepted) status = 'in-studio';
    if (busy) {
      const activeKind = {
        source: 'image',
        analysis: 'analysis',
        cutout: 'analysis',
        planner: 'planner',
        layout: 'planner',
      }[progress?.stage];
      if (node.kind === activeKind || (node.kind === 'output' && progress?.targetId === node.id))
        status = 'running';
      else if (activeNodeIds.includes(node.id)) status = 'queued';
    }
    if (queuedNodes.includes(node.kind === 'planner' ? null : node.id)) status = 'queued';
    const size = nodeSize(node.kind, node.data, image);
    return {
      id: node.id,
      style: { width: size.width, height: size.height },
      measured: node.measured,
      type: 'create',
      position: node.position,
      selected: Boolean(node.selected),
      data: {
        ...node.data,
        kind: node.kind,
        thin: size.thin,
        item,
        campaign,
        changeCampaign,
        batches,
        batch: batches.find((batch) => batch.snapshot.market.id === marketId) || null,
        project,
        analysis,
        progress,
        modelInventory,
        analyzeImage: onAnalyzeImage,
        hasImage: Boolean(project.campaigns[marketId]?.heroAssetId),
        acceptAll: onAcceptAll,
        exportDrafts: onExportDrafts,
        exportMatrix: onExportMatrix,
        undoGeneration: onUndoGeneration,
        cancelGeneration: onCancelGeneration,
        canUndo,
        connected,
        accepted,
        current,
        markets: project.markets,
        sizes,
        disabled,
        busy: Boolean(busy),
        queued: queuedNodes.includes(node.kind === 'planner' ? null : node.id),
        placementLocked,
        updateData: (patch) => updateData(node.id, patch),
        select: () => onSelect(node.id),
        editCampaign: onEditCampaign,
        uploadImage: onUploadImage,
        runConnected: onRunConnected,
        runOutput: () => onRunOutput(node.id),
        accept: () => onAcceptOutput(node.id),
        open: () => onOpenOutput(node.id),
        download: () => onDownloadOutput(node.id),
        suggestCopy: (role, maxChars) => onSuggestCopy(nodeMarketId || marketId, role, maxChars),
        approveCopy: (role, text) =>
          onApproveCopy(nodeMarketId || marketId, `${width}x${height}`, role, text),
        clearCopy: (role) => onClearCopy(nodeMarketId || marketId, `${width}x${height}`, role),
        status,
        title: node.kind === 'output' ? `${width} × ${height}` : null,
        marketName: project.markets.find((m) => m.id === (nodeMarketId || marketId))?.name,
        image: node.kind === 'image' ? image : null,
        sourceImage: image,
        headline: node.kind === 'copy' ? project.currentHeadline : null,
        modelStatus,
        florenceStatus,
      },
    };
  });
  const sizes = new Map(nodes.map((node) => [node.id, node]));
  const frameNodes = (flow.frames || []).flatMap((frame) => {
    const members = frame.nodeIds.map((id) => sizes.get(id)).filter(Boolean);
    if (!members.length) return [];
    const left = Math.min(...members.map((node) => node.position.x)) - FRAME_PADDING;
    const top = Math.min(...members.map((node) => node.position.y)) - FRAME_PADDING - 22;
    const right =
      Math.max(...members.map((node) => node.position.x + node.style.width)) + FRAME_PADDING;
    const bottom =
      Math.max(...members.map((node) => node.position.y + node.style.height)) + FRAME_PADDING;
    return [
      {
        id: `frame:${frame.id}`,
        type: 'frame',
        position: { x: left, y: top },
        style: { width: right - left, height: bottom - top },
        zIndex: -1,
        dragHandle: '.create-frame-name',
        selected: Boolean(frameSelection.includes(frame.id)),
        deletable: true,
        data: {
          name: frame.name,
          count: members.length,
          rename: (name) =>
            changeFlow((old) => ({
              ...old,
              frames: old.frames.map((entry) =>
                entry.id === frame.id ? { ...entry, name } : entry,
              ),
            })),
        },
      },
    ];
  });
  const selectedNodeIds = flow.nodes.filter((node) => node.selected).map((node) => node.id);
  function groupSelected() {
    if (disabled || selectedNodeIds.length < 2) return;
    changeFlow((old) => {
      const taken = new Set((old.frames || []).map((frame) => frame.id));
      let count = (old.frames || []).length + 1;
      while (taken.has(`frame-${count}`)) count++;
      // A node belongs to one frame; grouping it again moves it.
      const frames = (old.frames || [])
        .map((frame) => ({
          ...frame,
          nodeIds: frame.nodeIds.filter((id) => !selectedNodeIds.includes(id)),
        }))
        .filter((frame) => frame.nodeIds.length);
      return {
        ...old,
        frames: [
          ...frames,
          { id: `frame-${count}`, name: `Group ${count}`, nodeIds: selectedNodeIds },
        ],
      };
    });
  }
  function ungroupSelected() {
    if (disabled) return;
    changeFlow((old) => ({
      ...old,
      frames: (old.frames || []).filter(
        (frame) =>
          !frameSelection.includes(frame.id) &&
          !frame.nodeIds.some((id) => selectedNodeIds.includes(id)),
      ),
    }));
  }
  const edges = flow.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated: Boolean(busy),
    style: { stroke: '#697777', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#697777', width: 16, height: 16 },
  }));
  return (
    <div className="create-graph-canvas" role="region" aria-label="Create node canvas">
      <div className="create-graph-toolbar">
        {toolbar}
        <Button
          variant="secondary"
          aria-pressed={selectMode}
          title={
            selectMode
              ? 'Selecting: drag a box around nodes. Click to pan the map instead.'
              : 'Panning: drag the map. Click to draw a selection box instead (or hold Shift).'
          }
          onClick={() => setSelectMode((old) => !old)}
        >
          {selectMode ? <MousePointer2 size={14} /> : <Hand size={14} />}
          {selectMode ? 'Select' : 'Pan'}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || selectedNodeIds.length < 2}
          title="Group the selected nodes (Ctrl+G). Shift-drag on the map to select several."
          onClick={groupSelected}
        >
          <Group size={14} /> Group
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || !(frameSelection.length || (flow.frames || []).length)}
          title="Dissolve the selected group"
          onClick={ungroupSelected}
        >
          <Ungroup size={14} /> Ungroup
        </Button>
        <Button
          variant="secondary"
          title="Fit everything in view"
          onClick={() => flowInstance.current?.fitView({ ...FIT, duration: 250 })}
        >
          <Maximize2 size={14} /> Fit
        </Button>
      </div>
      <div className="create-graph-status" role="status">
        {statusText}
      </div>
      {progress && (
        <div className="create-workflow-overlay">
          <WorkflowProgress
            progress={progress}
            busy={Boolean(busy)}
            onCancel={onCancelGeneration}
          />
        </div>
      )}
      {queuedNodes.length > 0 && (
        <ol className="create-queue" aria-label="Generation queue">
          {queuedNodes.map((key, index) => {
            const node = flow.nodes.find((n) => n.id === key);
            const label =
              key == null
                ? 'Connected formats'
                : node
                  ? `${node.data.marketId} · ${node.data.width} × ${node.data.height}`
                  : key;
            return (
              <li key={key || 'all'}>
                <span>
                  {index + 1}. {label}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${label} from queue`}
                  onClick={() => onRemoveQueued(key)}
                >
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <div className="create-graph-mobile-hint">Drag canvas to reach Format nodes →</div>
      <ReactFlow
        onInit={(instance) => {
          flowInstance.current = instance;
        }}
        nodes={[...frameNodes, ...nodes]}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(allChanges) => {
          if (disabled) return;
          const isFrame = (change) => String(change.id).startsWith('frame:');
          const frameChanges = allChanges.filter(isFrame);
          const changes = allChanges.filter((change) => !isFrame(change));
          const selection = frameChanges.filter((change) => change.type === 'select');
          if (selection.length)
            setFrameSelection((old) => [
              ...old.filter((id) => !selection.some((c) => c.id === `frame:${id}`)),
              ...selection.filter((c) => c.selected).map((c) => c.id.slice(6)),
            ]);
          const removedFrames = frameChanges
            .filter((c) => c.type === 'remove')
            .map((c) => c.id.slice(6));
          // Dragging a group frame moves everything inside it.
          const moves = frameChanges.filter((c) => c.type === 'position' && c.position);
          if (removedFrames.length || moves.length)
            changeFlow(
              (old) => {
                let next = old;
                if (removedFrames.length)
                  next = {
                    ...next,
                    frames: (next.frames || []).filter((f) => !removedFrames.includes(f.id)),
                  };
                for (const move of moves) {
                  const frame = frameNodes.find((candidate) => candidate.id === move.id);
                  const members = (next.frames || []).find((f) => `frame:${f.id}` === move.id);
                  if (!frame || !members) continue;
                  const dx = move.position.x - frame.position.x;
                  const dy = move.position.y - frame.position.y;
                  next = {
                    ...next,
                    nodes: next.nodes.map((node) =>
                      members.nodeIds.includes(node.id)
                        ? {
                            ...node,
                            position: { x: node.position.x + dx, y: node.position.y + dy },
                          }
                        : node,
                    ),
                  };
                }
                return next;
              },
              { save: Boolean(removedFrames.length) },
            );
          if (!changes.length) return;
          const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id);
          changeFlow(
            (old) => ({
              ...old,
              nodes: applyNodeChanges(changes, old.nodes),
              edges: removed.length
                ? old.edges.filter(
                    (e) => !removed.includes(e.source) && !removed.includes(e.target),
                  )
                : old.edges,
            }),
            { save: Boolean(removed.length) },
          );
          if (removed.includes(selectedId)) onSelect(null);
        }}
        onEdgesChange={(changes) => {
          if (!disabled)
            changeFlow((old) => ({ ...old, edges: applyEdgeChanges(changes, old.edges) }));
        }}
        onNodeDragStop={() => changeFlow((old) => old)}
        onNodeClick={(_, node) => {
          if (node.type !== 'frame') onSelect(node.id);
        }}
        onEdgeClick={() => onSelect(null)}
        onPaneClick={() => {
          onSelect(null);
          setFrameSelection([]);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            if (event.shiftKey) ungroupSelected();
            else groupSelected();
          }
        }}
        selectionKeyCode="Shift"
        selectionOnDrag={selectMode}
        panOnDrag={selectMode ? [1, 2] : true}
        multiSelectionKeyCode={['Meta', 'Control']}
        isValidConnection={(connection) => !disabled && canConnect(flow, connection)}
        onConnect={(connection) => {
          if (!disabled && canConnect(flow, connection))
            changeFlow((old) => ({
              ...old,
              edges: [...old.edges, { ...connection, id: edgeId(connection) }],
            }));
        }}
        onReconnect={(oldEdge, connection) => {
          if (disabled) return;
          changeFlow((old) => {
            const without = { ...old, edges: old.edges.filter((e) => e.id !== oldEdge.id) };
            return canConnect(without, connection)
              ? { ...without, edges: [...without.edges, { ...connection, id: edgeId(connection) }] }
              : old;
          });
        }}
        nodesDraggable={!disabled}
        nodesConnectable={!disabled}
        edgesReconnectable={!disabled}
        elementsSelectable={!disabled}
        deleteKeyCode={disabled ? null : ['Backspace', 'Delete']}
        snapToGrid
        snapGrid={[20, 20]}
        fitView
        fitViewOptions={FIT}
        minZoom={0.1}
        maxZoom={2}
        zoomOnDoubleClick={false}
        colorMode="dark"
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#30383a" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.type === 'frame'
              ? '#2c3a35'
              : n.data.kind === 'output'
                ? '#8fcbb6'
                : n.data.kind === 'planner'
                  ? '#d1fe17'
                  : '#536763'
          }
        />
      </ReactFlow>
    </div>
  );
}
