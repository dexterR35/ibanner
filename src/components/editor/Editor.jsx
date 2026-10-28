import { Button, Modal, Textarea, Title } from '../ui/index.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import EditorLayers from './EditorLayers.jsx';
import LayerInspector from './LayerInspector.jsx';
import { ArrowLeft, Undo2, Redo2, Save, Code, X } from 'lucide-react';
import CanvasEditor from './CanvasEditor.jsx';
import Timeline from './Timeline.jsx';

import { validateBlueprint, validationMessage, layerSchema } from '../../core/schema.js';
import { resolveBanner, uid } from '../../data/defaults.js';
import { reviewReport } from '../../core/review.js';
import { totalDuration, sceneStart } from '../../core/timeline.js';
import { reserveLegalFooter } from '../../core/legal-footer.js';

export default function Editor({
  entry,
  banner,
  campaign,
  resources,
  onClose,
  onSave,
  onReset,
  assetsBusy,
  assetsError,
  logoAssetName,
  onLogoUpload,
  onCampaignChange,
  inline,
  blueprintMode = false,
}) {
  const initial = resolveBanner(entry, banner);
  const [rawBp, setRaw] = useState(() => structuredClone(initial)),
    [imageMode, setImageMode] = useState(blueprintMode ? 'frame' : 'pan'),
    [past, setPast] = useState([]),
    [future, setFuture] = useState([]),
    [selected, setSelected] = useState(inline ? null : 'headline'),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [guides, setGuides] = useState(false),
    [error, setError] = useState(''),
    [json, setJson] = useState(null);
  const bp = reserveLegalFooter(rawBp);

  const selectedLayer = bp.layers.find((l) => l.id === selected);
  const lastExternal = useRef(initial),
    currentDraft = useRef(bp);
  currentDraft.current = bp;
  useEffect(() => {
    const request = inline?.sceneRequest;
    if (!request || bp.mode !== 'animated') return;
    const index = bp.scenes.findIndex((scene) => scene.id === request.sceneId);
    if (index < 0) return;
    setPlaying(false);
    setTime(sceneStart(bp, index) + bp.scenes[index].durationMs / 2);
  }, [inline?.sceneRequest]);
  useEffect(() => {
    inline?.inspectorHost?.parentElement?.scrollTo({ top: 0 });
  }, [entry.id, selected, inline?.inspectorHost]);
  useEffect(() => {
    if (!inline || lastExternal.current === initial) return;
    lastExternal.current = initial;
    // Accept shared campaign arrangement/reset changes, retaining history for our own commits.
    if (JSON.stringify(initial) === JSON.stringify(currentDraft.current)) return;
    setRaw(structuredClone(initial));
    setPast([]);
    setFuture([]);
  }, [initial, !!inline]);
  const apply = (next) => {
    const normalized = reserveLegalFooter(next);
    setRaw(normalized);
    if (inline) {
      try {
        inline.onCommit(validateBlueprint(normalized));
        setError('');
      } catch (error) {
        setError(validationMessage(error));
      }
    }
  };
  const update = (next) => {
    setPast((p) => [...p.slice(-39), bp]);
    setFuture([]);
    apply(next);
  };
  const editLayer = (id, patch) => {
    const next = { ...bp, layers: bp.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
    // Text fills this box in the shared renderer; content edits preserve its geometry.
    update(next);
  };
  const change = (patch) => editLayer(selected, patch);
  const issues = useMemo(
    () => (blueprintMode ? [] : reviewReport(bp, campaign, resources, entry)),
    [blueprintMode, bp, campaign, resources, entry],
  );
  useEffect(() => {
    if (bp.mode !== 'animated') {
      setPlaying(false);
      setTime(0);
    }
  }, [bp.mode]);
  useEffect(() => {
    if (!playing || bp.mode !== 'animated') return;
    let frame,
      previous = performance.now();
    const step = (now) => {
      setTime((t) => (t + now - previous) % totalDuration(bp));
      previous = now;
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, rawBp]);
  function undo() {
    if (!past.length) return;
    setFuture((f) => [bp, ...f]);
    apply(past.at(-1));
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, bp]);
    apply(future[0]);
    setFuture((f) => f.slice(1));
  }
  function save() {
    try {
      onSave(validateBlueprint(bp));
      setError('');
    } catch (e) {
      setError(validationMessage(e));
    }
  }
  function addLayer(type, source) {
    const id = uid(),
      layer = layerSchema.parse({
        id,
        name: source
          ? { headline: 'Headline', subtitle: 'Subtitle', legal: 'Legal' }[source]
          : { text: 'New text', shape: 'Shape', image: 'Image', logo: 'Logo', button: 'CTA' }[type],
        type,
        source: source || { image: 'hero', logo: 'logo', button: 'cta' }[type] || 'custom',
        text: type === 'text' ? 'Your text' : '',
        x: 12,
        y: 12,
        width: Math.min(120, bp.width - 24),
        height: Math.min(40, bp.height - 24),
        fill: type === 'text' ? '#ffffff' : '#ed172a',
      });
    update({ ...bp, layers: [...bp.layers, layer] });
    setSelected(id);
  }
  function deleteLayer() {
    const layers = bp.layers.filter((l) => l.id !== selected),
      scenes = bp.scenes.map((s) => ({
        ...s,
        tracks: Object.fromEntries(Object.entries(s.tracks).filter(([id]) => id !== selected)),
      }));
    update({ ...bp, layers, scenes });
    setSelected(null);
  }
  function reorder(delta) {
    const layers = [...bp.layers],
      index = layers.findIndex((l) => l.id === selected),
      target = index + delta;
    if (target < 0 || target >= layers.length) return;
    [layers[index], layers[target]] = [layers[target], layers[index]];
    update({ ...bp, layers });
  }
  const layerProps = {
    blueprintMode,
    bp,
    selected,
    setSelected,
    editLayer,
    addLayer,
    guides,
    setGuides,
    update,
    campaign,
    onCampaignChange: inline || blueprintMode ? null : onCampaignChange,
    assetsBusy,
    entry,
    setPlaying,
    setTime,
  };
  const inspectorProps = {
    blueprintMode,
    bp,
    selectedLayer,
    selected,
    imageMode,
    setImageMode,
    setPlaying,
    campaign,
    resources,
    change,
    entry,
    logoAssetName,
    onLogoUpload: inline || blueprintMode ? null : onLogoUpload,
    assetsBusy,
    reorder,
    deleteLayer,
    issues,
  };
  const canvas = (
    <CanvasEditor
      schematic={blueprintMode}
      inlineZoom={inline?.zoom}
      interactive={!inline || inline.interactive}
      bp={bp}
      campaign={campaign}
      resources={resources}
      time={bp.mode === 'animated' ? time : 0}
      selected={selected}
      onSelect={setSelected}
      onChange={editLayer}
      showGuides={guides}
      imageMode={imageMode}
      onInteractionStart={() => setPlaying(false)}
    />
  );
  const timeline = bp.mode === 'animated' && (
    <Timeline
      campaign={blueprintMode ? null : campaign}
      bp={bp}
      setBp={update}
      time={time}
      setTime={setTime}
      playing={playing}
      setPlaying={setPlaying}
      selected={selected}
    />
  );
  if (inline)
    return (
      <>
        {canvas}
        {inline.inspectorHost &&
          createPortal(
            <>
              <div className="studio-selection-header">
                <header className="studio-selection-heading">
                  <div>
                    <strong>
                      {entry.marketId} · {bp.width} × {bp.height}
                    </strong>
                    <small>Only this banner · Autosave</small>
                  </div>
                  <Button
                    variant="icon"
                    aria-label="Deselect banner"
                    title="Deselect banner"
                    onClick={onClose}
                  >
                    <X size={16} />
                  </Button>
                </header>
                <div className="studio-selection-tools">
                  <Button
                    variant="icon"
                    title="Undo"
                    disabled={!past.length || assetsBusy}
                    onClick={undo}
                  >
                    <Undo2 size={16} />
                  </Button>
                  <Button
                    variant="icon"
                    title="Redo"
                    disabled={!future.length || assetsBusy}
                    onClick={redo}
                  >
                    <Redo2 size={16} />
                  </Button>
                  <Button
                    variant="subtle"
                    onClick={() => {
                      onReset();
                      setSelected(null);
                    }}
                    disabled={assetsBusy}
                  >
                    Reset banner
                  </Button>
                </div>
              </div>
              <fieldset
                disabled={assetsBusy}
                inert={assetsBusy}
                className="studio-selection-fields"
              >
                <details
                  className="studio-layer-list"
                  key={selected || 'banner'}
                  open={!selectedLayer}
                >
                  <summary>Layers & banner settings</summary>
                  <EditorLayers {...layerProps} />
                </details>
                {selectedLayer && <LayerInspector {...inspectorProps} />}
              </fieldset>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </>,
            inline.inspectorHost,
          )}
        {inline.timelineHost &&
          timeline &&
          createPortal(
            <fieldset className="studio-selection-fields" disabled={assetsBusy} inert={assetsBusy}>
              {timeline}
            </fieldset>,
            inline.timelineHost,
          )}
      </>
    );
  return (
    <div className="editor">
      <header className="editor-header">
        <Button
          variant="icon"
          onClick={onClose}
          aria-label={blueprintMode ? 'Back to blueprint' : 'Back to formats'}
        >
          <ArrowLeft size={20} />
        </Button>
        <div>
          <Title as="h2">
            {blueprintMode ? 'Edit blueprint' : 'Edit banner'}{' '}
            <span>
              {entry.marketId} / {bp.width} × {bp.height}
            </span>
          </Title>
          <p>
            {blueprintMode
              ? 'Arrange boxes, fades and timing. Saving updates this size in Studio.'
              : 'Edit text, images and layout for this banner. The blueprint stays unchanged.'}
          </p>
        </div>
        <div className="spacer" />
        <Button variant="icon" title="Undo" disabled={!past.length} onClick={undo}>
          <Undo2 size={17} />
        </Button>
        <Button variant="icon" title="Redo" disabled={!future.length} onClick={redo}>
          <Redo2 size={17} />
        </Button>
        <Button variant="subtle" onClick={() => setJson(JSON.stringify(bp, null, 2))}>
          <Code size={16} /> JSON
        </Button>
        {!blueprintMode && (
          <Button
            variant="secondary"
            onClick={() => {
              onReset();
              onClose();
            }}
          >
            Reset to blueprint
          </Button>
        )}
        <Button variant="primary" onClick={save} disabled={assetsBusy}>
          <Save size={15} /> {blueprintMode ? 'Save blueprint' : 'Save banner'}
        </Button>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {assetsError && (
        <div className="error" role="alert">
          {assetsError}
        </div>
      )}
      <div className="editor-body">
        <EditorLayers {...layerProps} />
        <div className="editor-center">
          {canvas}
          {timeline}
        </div>
        <LayerInspector {...inspectorProps} />
      </div>
      {json !== null && (
        <Modal title="Blueprint JSON" wide onClose={() => setJson(null)}>
          <p className="muted">
            Validated before applying. Identity and dimensions must match this blueprint.
          </p>
          <Textarea
            className="json-editor"
            value={json}
            onChange={(e) => setJson(e.target.value)}
          />
          <Button
            variant="primary"
            onClick={() => {
              try {
                const next = validateBlueprint(JSON.parse(json));
                if (
                  next.id !== bp.id ||
                  next.marketId !== bp.marketId ||
                  next.width !== bp.width ||
                  next.height !== bp.height
                )
                  throw new Error(
                    'Keep the current blueprint identity and size. Add a size from the dashboard instead.',
                  );
                update(next);
                setTime(0);
                setJson(null);
                setError('');
              } catch (e) {
                setError(validationMessage(e));
              }
            }}
          >
            Validate and apply
          </Button>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}
    </div>
  );
}
