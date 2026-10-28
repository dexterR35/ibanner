import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CanvasToolbar from './CanvasToolbar.jsx';
import { clampZoom, constrainCamera } from '../../core/artboard-camera.js';

function placeArtboards(items) {
  const gap = 56,
    rowWidth = 1320;
  let x = 0,
    y = 0,
    rowHeight = 0,
    width = 0;
  const boards = items.map((item) => {
    const boardWidth = Math.max(160, item.width),
      boardHeight = item.boardHeight ?? item.height + 36;
    if (x && x + boardWidth > rowWidth) {
      y += rowHeight + gap;
      x = 0;
      rowHeight = 0;
    }
    const board = { ...item, x, y, boardWidth, boardHeight };
    width = Math.max(width, x + boardWidth);
    x += boardWidth + gap;
    rowHeight = Math.max(rowHeight, boardHeight);
    return board;
  });
  return { boards, width, height: y + rowHeight };
}

/** Camera-only zoom and pan: native output sizes and banner data are never changed. */
export default function ArtboardWorkspace({
  items,
  renderArtboard,
  empty,
  resetKey,
  footer,
  actions,
  overlay,
  locked = false,
  inspector,
  timeline,
  selectedId,
  onSelect,
  onDeselect,
  marketKey,
}) {
  const viewport = useRef(null),
    actionsHost = useRef(null),
    drag = useRef(null),
    moved = useRef(false),
    fitting = useRef(true),
    fitLatest = useRef(null),
    focusLatest = useRef(null),
    cameraLatest = useRef(null);
  const [camera, setCamera] = useState({ x: 36, y: 36, zoom: 0.7 });
  const [positions, setPositions] = useState({});
  const [actionsHeight, setActionsHeight] = useState(40);
  const [hand, setHand] = useState(false),
    [space, setSpace] = useState(false),
    [panning, setPanning] = useState(false);
  const layout = useMemo(() => {
    const base = placeArtboards(items);
    const boards = base.boards.map((board) => ({ ...board, ...positions[marketKey]?.[board.id] }));
    return {
      boards,
      width: Math.max(0, ...boards.map((b) => b.x + b.boardWidth)),
      height: Math.max(0, ...boards.map((b) => b.y + b.boardHeight)),
    };
  }, [items, positions, marketKey]);
  const insets = () => {
    const node = viewport.current;
    const compact = node.clientWidth < 600;
    return {
      left: inspector && !compact ? 360 : 64,
      top: actions ? Math.max(80, 40 + (actionsHost.current?.offsetHeight || actionsHeight)) : 32,
      bottom: inspector && compact ? Math.min(node.clientHeight * 0.42, 360) + 24 : 32,
    };
  };
  const constrain = (next) => {
    const { left, top, bottom } = insets();
    return constrainCamera(
      next,
      layout,
      { width: viewport.current.clientWidth, height: viewport.current.clientHeight },
      top,
      left,
      bottom,
    );
  };
  cameraLatest.current = { locked, constrain };
  const fit = () => {
    const node = viewport.current;
    if (!node || !layout.width) return;
    fitting.current = true;
    const { left, top, bottom } = insets();
    const availableWidth = node.clientWidth - left - 32;
    const availableHeight = node.clientHeight - top - bottom;
    const zoom = clampZoom(
      Math.min(1, availableWidth / layout.width, availableHeight / layout.height),
    );
    setCamera(
      constrain({
        x: left + Math.max(0, (availableWidth - layout.width * zoom) / 2),
        y: top + Math.max(0, (availableHeight - layout.height * zoom) / 2),
        zoom,
      }),
    );
  };
  const focusSelection = () => {
    const board = layout.boards.find((board) => board.id === selectedId),
      node = viewport.current;
    if (!board || !node) return;
    fitting.current = 'selected';
    const { left, top, bottom } = insets();
    const availableWidth = node.clientWidth - left - 56,
      availableHeight = node.clientHeight - top - bottom - 56;
    const zoom = clampZoom(
      Math.min(1.5, availableWidth / board.width, availableHeight / board.height),
    );
    setCamera(
      constrain({
        x: left + 28 + (availableWidth - board.width * zoom) / 2 - board.x * zoom,
        y: top + 28 + (availableHeight - board.height * zoom) / 2 - (board.y + 36) * zoom,
        zoom,
      }),
    );
  };
  focusLatest.current = focusSelection;
  useLayoutEffect(() => {
    if (selectedId) focusSelection();
    else fit();
  }, [selectedId]);
  const zoomAt = (zoom, point) => {
    if (locked) return;
    fitting.current = false;
    setCamera((previous) => {
      zoom = clampZoom(zoom);
      const anchor = point || {
        x: viewport.current.clientWidth / 2,
        y: viewport.current.clientHeight / 2,
      };
      const ratio = zoom / previous.zoom;
      return constrain({
        x: anchor.x - (anchor.x - previous.x) * ratio,
        y: anchor.y - (anchor.y - previous.y) * ratio,
        zoom,
      });
    });
  };
  useLayoutEffect(() => {
    // A new market/filter gets a fresh overview; editing copy never resets the camera.
    fit();
  }, [resetKey]);
  useLayoutEffect(() => {
    if (fitting.current === true) fit();
  }, [layout.width, layout.height]);
  fitLatest.current = fit;
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setActionsHeight(actionsHost.current?.offsetHeight || 0);
      if (fitting.current === 'selected') focusLatest.current();
      else if (fitting.current) fitLatest.current();
      else setCamera((previous) => cameraLatest.current.constrain(previous));
    });
    observer.observe(viewport.current);
    if (actionsHost.current) observer.observe(actionsHost.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const down = (event) => {
      if (
        cameraLatest.current.locked ||
        event.code !== 'Space' ||
        event.target.closest('input, textarea, select, button, [contenteditable="true"]')
      )
        return;
      event.preventDefault();
      setSpace(true);
    };
    const up = (event) => {
      if (event.code === 'Space') setSpace(false);
    };
    const blur = () => {
      setSpace(false);
      drag.current = null;
      setPanning(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  useEffect(() => {
    const node = viewport.current;
    const wheel = (event) => {
      if (event.target.closest('.studio-properties')) return;
      event.preventDefault();
      if (cameraLatest.current.locked) return;
      fitting.current = false;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) {
        const rect = node.getBoundingClientRect(),
          x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        setCamera((previous) => {
          const zoom = clampZoom(previous.zoom * Math.exp(-event.deltaY * multiplier * 0.008));
          const ratio = zoom / previous.zoom;
          return cameraLatest.current.constrain({
            x: x - (x - previous.x) * ratio,
            y: y - (y - previous.y) * ratio,
            zoom,
          });
        });
      } else {
        setCamera((previous) =>
          cameraLatest.current.constrain({
            ...previous,
            x: previous.x - (event.shiftKey ? event.deltaY : event.deltaX) * multiplier,
            y: previous.y - (event.shiftKey ? 0 : event.deltaY) * multiplier,
          }),
        );
      }
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const endPan = (event) => {
    if (event?.type === 'pointerup' && drag.current?.board && !moved.current && !locked)
      onSelect?.(drag.current.board.id);
    drag.current = null;
    setPanning(false);
  };
  useEffect(() => {
    if (locked) {
      endPan();
      setSpace(false);
    }
  }, [locked]);
  return (
    <>
      <div
        ref={viewport}
        className={`studio-artboard-surface ${hand || space ? 'hand-tool' : ''} ${panning ? 'is-panning' : ''}`}
        role="region"
        aria-label="Campaign artboard canvas"
        aria-busy={locked}
        tabIndex={0}
        style={{
          '--canvas-controls-top': `${actions ? Math.max(80, 40 + actionsHeight) : 32}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
          backgroundSize: `${20 * camera.zoom}px ${20 * camera.zoom}px`,
        }}
        onPointerDownCapture={(event) => {
          if (event.target.closest('[data-canvas-overlay]')) return;
          if (locked) return;
          if (!items.length) return;
          const moveHandle = event.target.closest('[data-artboard-move]');
          if (!hand && !space && event.button === 0 && moveHandle) {
            const board = layout.boards.find(
              (board) => board.id === moveHandle.dataset.artboardMove,
            );
            if (!board) return;
            event.preventDefault();
            fitting.current = false;
            moved.current = false;
            drag.current = { x: event.clientX, y: event.clientY, board, zoom: camera.zoom };
            viewport.current.setPointerCapture(event.pointerId);
            return;
          }
          if (
            !hand &&
            !space &&
            event.button !== 1 &&
            event.target.closest('[data-artboard-editor]')
          )
            return;
          if (event.button !== 0 && event.button !== 1) return;
          moved.current = false;
          if (!hand && !space && event.button !== 1 && event.target.closest('button')) return;
          event.preventDefault();
          fitting.current = false;
          viewport.current.focus({ preventScroll: true });
          drag.current = { x: event.clientX, y: event.clientY, camera };
          viewport.current.setPointerCapture(event.pointerId);
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (locked || !drag.current) return;
          const dx = event.clientX - drag.current.x,
            dy = event.clientY - drag.current.y;
          if (Math.hypot(dx, dy) > 3) moved.current = true;
          if (drag.current.board) {
            if (!moved.current) return;
            const { board, zoom } = drag.current;
            setPositions((previous) => ({
              ...previous,
              [marketKey]: {
                ...previous[marketKey],
                [board.id]: {
                  x: Math.max(0, Math.min(20000, board.x + dx / zoom)),
                  y: Math.max(0, Math.min(20000, board.y + dy / zoom)),
                },
              },
            }));
            return;
          }
          setCamera(
            constrain({
              ...drag.current.camera,
              x: drag.current.camera.x + dx,
              y: drag.current.camera.y + dy,
            }),
          );
        }}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onLostPointerCapture={endPan}
        onClickCapture={(event) => {
          if (event.target.closest('[data-canvas-overlay]')) return;
          if (locked || (items.length && (moved.current || hand || space))) {
            event.preventDefault();
            event.stopPropagation();
            moved.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Escape') {
            onDeselect?.();
            return;
          }
          if (locked) {
            event.preventDefault();
            return;
          }
          const arrows = {
            ArrowLeft: [40, 0],
            ArrowRight: [-40, 0],
            ArrowUp: [0, 40],
            ArrowDown: [0, -40],
          };
          if (arrows[event.key]) {
            event.preventDefault();
            fitting.current = false;
            const [x, y] = arrows[event.key];
            setCamera((c) => constrain({ ...c, x: c.x + x, y: c.y + y }));
          }
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomAt(camera.zoom * 1.2);
          }
          if (event.key === '-') {
            event.preventDefault();
            zoomAt(camera.zoom / 1.2);
          }
          if (event.key === '0') {
            event.preventDefault();
            fit();
          }
        }}
      >
        {!items.length ? (
          empty
        ) : (
          <div
            className="banner-grid artboard-grid"
            style={{
              width: layout.width,
              height: layout.height,
              '--artboard-label-scale': Math.max(0.5, camera.zoom),
              transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            }}
          >
            {layout.boards.map((board) => (
              <div
                className={`artboard-position ${board.id === selectedId ? 'is-selected' : ''}`}
                key={board.id}
                style={{ left: board.x, top: board.y, width: board.boardWidth }}
              >
                {renderArtboard(board, {
                  zoom: camera.zoom,
                  interactive: !locked && !hand && !space,
                })}
              </div>
            ))}
          </div>
        )}
        <div className="canvas-tool-rail" data-canvas-overlay>
          <CanvasToolbar
            camera={camera}
            hand={hand}
            setHand={setHand}
            locked={locked}
            zoomAt={zoomAt}
            fit={fit}
            hasItems={!!items.length}
            onResetPositions={
              Object.keys(positions[marketKey] || {}).length
                ? () => {
                    fitting.current = true;
                    setPositions((previous) => ({ ...previous, [marketKey]: {} }));
                  }
                : undefined
            }
          />
        </div>
        {inspector && (
          <aside
            className="studio-properties"
            aria-label="Selected banner properties"
            data-canvas-overlay
          >
            {inspector}
          </aside>
        )}
        {actions && (
          <div className="canvas-floating-actions" ref={actionsHost} data-canvas-overlay>
            {actions}
          </div>
        )}
        {overlay && (
          <div className="artboard-overlay" data-canvas-overlay>
            {overlay}
          </div>
        )}
      </div>
      {timeline}
      <div className="workspace-footer studio-canvas-footer">
        <span className="canvas-help">Drag space to pan · Ctrl + scroll to zoom</span>
        {footer}
      </div>
    </>
  );
}
