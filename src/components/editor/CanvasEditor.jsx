import { useEffect, useRef, useState, useMemo } from 'react';
import { Stage, Layer, Image as CanvasImage, Rect, Transformer } from 'react-konva';
import { canvasOf, renderFrame } from '../../core/render.js';
import { renderBlueprintDiagram } from '../../core/blueprint-diagram.js';
import { layerAt, sceneAt } from '../../core/timeline.js';
import { panImage } from '../../core/image-position.js';
import FadeMeshOverlay from './FadeMeshOverlay.jsx';

const HANDLE_SPACE = 56;
const dimension = (value) => Math.max(4, Math.min(4096, Math.round(value)));

function ImagePanTarget({
  layer,
  visibleLayer,
  resources,
  scale,
  accent,
  onPreview,
  onCommit,
  onStart,
}) {
  const node = useRef(),
    gesture = useRef();
  function begin(event) {
    const point = event.target.getStage().getPointerPosition();
    if (!point) return;
    gesture.current = { point, layer: { ...layer } };
    onStart();
  }
  function position(event) {
    const point = event.target.getStage().getPointerPosition(),
      start = gesture.current;
    if (!point || !start) return null;
    return panImage(
      resources.hero,
      start.layer,
      resources.heroCrop,
      (point.x - start.point.x) / scale,
      (point.y - start.point.y) / scale,
    );
  }
  return (
    <Rect
      ref={node}
      x={visibleLayer.x}
      y={visibleLayer.y}
      width={layer.width}
      height={layer.height}
      rotation={layer.rotation}
      draggable
      fill="rgba(0,0,0,0)"
      stroke={accent}
      strokeWidth={1 / scale}
      dash={[5 / scale, 4 / scale]}
      dragBoundFunc={() => node.current.getAbsolutePosition()}
      onMouseDown={begin}
      onTouchStart={begin}
      onDragMove={(event) => {
        const patch = position(event);
        if (patch) onPreview(patch);
      }}
      onDragEnd={(event) => {
        const patch = position(event);
        gesture.current = null;
        if (patch) onCommit(patch);
        onPreview(null);
      }}
      onTouchCancel={() => {
        gesture.current = null;
        onPreview(null);
      }}
    />
  );
}

export default function CanvasEditor({
  bp,
  campaign,
  resources,
  time,
  selected,
  onSelect,
  onChange,
  showGuides,
  imageMode,
  onInteractionStart,
  inlineZoom,
  interactive = true,
  schematic = false,
}) {
  const inline = inlineZoom != null;
  const host = useRef(),
    transform = useRef(),
    nodes = useRef({}),
    [area, setArea] = useState({ width: 600, height: 500 }),
    [pan, setPan] = useState(null),
    [geometry, setGeometry] = useState(null);
  // Konva paints canvas pixels, so resolve the same CSS tokens used by the surrounding UI.
  const theme = useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue('--accent').trim(),
      panel: styles.getPropertyValue('--panel').trim(),
    };
  }, []);
  const selectedLayer = bp.layers.find((layer) => layer.id === selected);
  const panning = selectedLayer?.type === 'image' && imageMode === 'pan';
  const meshing =
    selectedLayer?.type === 'image' && selectedLayer.fadeMesh?.enabled && imageMode === 'mesh';
  useEffect(() => {
    setPan(null);
    setGeometry(null);
  }, [selected, imageMode]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setArea({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  const scale = inline
    ? 1
    : Math.max(
        0.05,
        Math.min(
          (area.width - HANDLE_SPACE * 2) / bp.width,
          (area.height - HANDLE_SPACE * 2) / bp.height,
          2,
        ),
      );
  const screenScale = scale * (inlineZoom || 1);
  const handleSpace = HANDLE_SPACE / (inlineZoom || 1);
  const width = bp.width * scale,
    height = bp.height * scale;
  const canvas = useMemo(() => {
    const c = canvasOf(bp.width, bp.height);
    const patch = panning ? pan : geometry?.patch;
    const preview = patch
      ? {
          ...bp,
          layers: bp.layers.map((layer) =>
            layer.id === (panning ? selected : geometry.id) ? { ...layer, ...patch } : layer,
          ),
        }
      : bp;
    if (schematic) renderBlueprintDiagram(c, preview, time);
    else if (resources) renderFrame(c, preview, campaign, resources, time);
    return c;
  }, [bp, campaign, resources, time, pan, panning, selected, geometry, schematic]);
  const { scene, local } = sceneAt(bp, time);
  useEffect(() => {
    transform.current?.nodes(
      !panning && !meshing && selected && nodes.current[selected] ? [nodes.current[selected]] : [],
    );
  }, [selected, bp, time, panning, meshing]);
  const visibleImage = panning ? layerAt(selectedLayer, scene, local) : null;
  function geometryPatch(node, layer, visible, resize = false) {
    return {
      x: Math.round(node.x() - (visible.x - layer.x)),
      y: Math.round(node.y() - (visible.y - layer.y)),
      ...(resize
        ? {
            width: dimension(node.width() * node.scaleX()),
            height: dimension(node.height() * node.scaleY()),
            rotation: Math.round(node.rotation()),
          }
        : {}),
    };
  }
  function commit(layer, patch) {
    setGeometry(null);
    if (Object.entries(patch).some(([key, value]) => layer[key] !== value))
      onChange(layer.id, patch);
  }
  return (
    <div
      ref={host}
      className={`editor-canvas-area ${panning ? 'image-pan-mode' : ''} ${inline ? 'inline-canvas-editor' : ''}`}
      data-artboard-editor={inline || undefined}
      style={
        inline
          ? { width: bp.width, height: bp.height, pointerEvents: interactive ? 'auto' : 'none' }
          : undefined
      }
      role="region"
      aria-label={schematic ? 'Blueprint editing canvas' : 'Banner editing canvas'}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={(event) => {
        if (
          !interactive ||
          event.target !== event.currentTarget ||
          !selectedLayer ||
          panning ||
          meshing
        )
          return;
        const delta = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!delta) return;
        event.preventDefault();
        onInteractionStart();
        const step = event.shiftKey ? 10 : 1;
        onChange(selected, {
          x: selectedLayer.x + delta[0] * step,
          y: selectedLayer.y + delta[1] * step,
        });
      }}
    >
      {!inline && (
        <div className="canvas-dimension">
          {bp.width} × {bp.height} <span>{Math.round(scale * 100)}%</span>
        </div>
      )}
      <div className="editor-artwork" style={{ width, height }}>
        <Stage
          style={{ position: 'absolute', left: -handleSpace, top: -handleSpace }}
          width={Math.max(1, width + handleSpace * 2)}
          height={Math.max(1, height + handleSpace * 2)}
          listening={interactive}
          scaleX={scale}
          scaleY={scale}
          onMouseDown={(e) => {
            host.current.focus({ preventScroll: true });
            if (e.target === e.target.getStage()) onSelect(null);
          }}
        >
          <Layer x={handleSpace / scale} y={handleSpace / scale}>
            <CanvasImage image={canvas} listening={false} />
            {bp.layers.map((layer) => {
              const l = layerAt(layer, scene, local);
              if (!l.visible || ((panning || meshing) && selected === l.id)) return null;
              return (
                <Rect
                  key={l.id}
                  ref={(node) => {
                    nodes.current[l.id] = node;
                  }}
                  x={l.x}
                  y={l.y}
                  width={l.width}
                  height={l.height}
                  rotation={l.rotation}
                  draggable={layer.type !== 'image' || imageMode === 'frame'}
                  stroke={selected === l.id ? theme.accent : undefined}
                  strokeWidth={1 / screenScale}
                  fill="rgba(0,0,0,0)"
                  onClick={() => onSelect(l.id)}
                  onTap={() => onSelect(l.id)}
                  onDragStart={() => {
                    onInteractionStart();
                    onSelect(l.id);
                  }}
                  onDragMove={(e) =>
                    setGeometry({ id: layer.id, patch: geometryPatch(e.target, layer, l) })
                  }
                  onDragEnd={(e) => commit(layer, geometryPatch(e.target, layer, l))}
                  onTransformStart={onInteractionStart}
                  onTransform={(e) =>
                    setGeometry({ id: layer.id, patch: geometryPatch(e.target, layer, l, true) })
                  }
                  onTransformEnd={(e) => {
                    const node = e.target;
                    const patch = geometryPatch(node, layer, l, true);
                    node.scaleX(1);
                    node.scaleY(1);
                    commit(layer, patch);
                  }}
                />
              );
            })}
            {visibleImage?.visible && resources?.hero && (
              <ImagePanTarget
                key={selected}
                layer={selectedLayer}
                visibleLayer={visibleImage}
                resources={resources}
                scale={scale}
                accent={theme.accent}
                onStart={onInteractionStart}
                onPreview={setPan}
                onCommit={(patch) => {
                  if (
                    patch.focalX !== selectedLayer.focalX ||
                    patch.focalY !== selectedLayer.focalY
                  )
                    onChange(selectedLayer.id, patch);
                }}
              />
            )}
            {showGuides && (
              <Rect
                x={8}
                y={8}
                width={bp.width - 16}
                height={bp.height - 16}
                stroke={theme.accent}
                opacity={0.65}
                strokeWidth={1 / scale}
                dash={[4 / scale, 4 / scale]}
                listening={false}
              />
            )}
            {meshing && layerAt(selectedLayer, scene, local).visible && (
              <FadeMeshOverlay
                layer={{ ...selectedLayer, ...(geometry?.id === selected ? geometry.patch : {}) }}
                visible={layerAt(selectedLayer, scene, local)}
                screenScale={screenScale}
                accent={theme.accent}
                onStart={onInteractionStart}
                onPreview={(patch) => setGeometry(patch ? { id: selected, patch } : null)}
                onCommit={(patch) => commit(selectedLayer, patch)}
              />
            )}
            <Transformer
              ref={transform}
              flipEnabled={false}
              rotateEnabled={true}
              borderStroke={theme.accent}
              anchorStroke={theme.accent}
              anchorFill={theme.panel}
              borderStrokeWidth={1 / (inlineZoom || 1)}
              anchorSize={10 / (inlineZoom || 1)}
              anchorCornerRadius={2 / (inlineZoom || 1)}
              anchorStrokeWidth={1.5 / (inlineZoom || 1)}
              ignoreStroke
              rotateAnchorOffset={32 / (inlineZoom || 1)}
              rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
              rotationSnapTolerance={4}
              anchorStyleFunc={(anchor) => {
                const rotate = anchor.hasName('rotater');
                const size = (rotate ? 14 : 10) / (inlineZoom || 1);
                anchor.setAttrs({
                  width: size,
                  height: size,
                  offsetX: size / 2,
                  offsetY: size / 2,
                  cornerRadius: (rotate ? 7 : 2) / (inlineZoom || 1),
                  fill: rotate ? theme.accent : theme.panel,
                  hitStrokeWidth: 10 / (inlineZoom || 1),
                });
              }}
              boundBoxFunc={(oldBox, newBox) =>
                [newBox.width, newBox.height].some(
                  (size) => Math.abs(size) < 4 * scale || Math.abs(size) > 4096 * scale,
                )
                  ? oldBox
                  : newBox
              }
            />
          </Layer>
        </Stage>
      </div>
      {!inline && (
        <span className="canvas-hint">
          {meshing
            ? 'Drag the fade points · Dashed lines show the soft transition'
            : panning
              ? 'Drag the photo · Frame and fade stay fixed · Zoom in for more room'
              : 'Drag to move · Anchors to resize · Round handle to rotate'}
        </span>
      )}
    </div>
  );
}
