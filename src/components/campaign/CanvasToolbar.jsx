import { Hand, Maximize, Minus, MousePointer2, Plus, LayoutGrid } from 'lucide-react';
import { Button } from '../ui/index.js';

export default function CanvasToolbar({
  camera,
  hand,
  setHand,
  locked,
  zoomAt,
  fit,
  hasItems,
  onResetPositions,
}) {
  return (
    <div className="canvas-controls" aria-label="Canvas controls">
      <Button
        variant="icon"
        aria-label="Select artboards"
        disabled={locked}
        title="Select artboards"
        aria-pressed={!hand}
        onClick={() => setHand(false)}
      >
        <MousePointer2 size={15} />
      </Button>
      <Button
        variant="icon"
        aria-label="Pan canvas"
        disabled={locked}
        title="Pan canvas (or hold Space)"
        aria-pressed={hand}
        onClick={() => setHand(true)}
      >
        <Hand size={15} />
      </Button>
      <span className="canvas-control-divider" />
      <Button
        variant="icon"
        aria-label="Zoom out"
        disabled={locked || camera.zoom <= 0.1}
        onClick={() => zoomAt(camera.zoom / 1.2)}
      >
        <Minus size={14} />
      </Button>
      <Button
        variant="plain"
        className="zoom-value"
        aria-label={`Zoom ${Math.round(camera.zoom * 100)}%, reset to 100%`}
        title="Reset to 100%"
        disabled={locked}
        onClick={() => zoomAt(1)}
      >
        {Math.round(camera.zoom * 100)}%
      </Button>
      <Button
        variant="icon"
        aria-label="Zoom in"
        disabled={locked || camera.zoom >= 3}
        onClick={() => zoomAt(camera.zoom * 1.2)}
      >
        <Plus size={14} />
      </Button>
      <Button
        variant="icon"
        aria-label="Fit all artboards"
        title="Fit all artboards (0)"
        disabled={locked || !hasItems}
        onClick={fit}
      >
        <Maximize size={14} />
      </Button>
      {onResetPositions && (
        <Button
          variant="icon"
          title="Reset artboard positions"
          aria-label="Reset artboard positions"
          disabled={locked}
          onClick={onResetPositions}
        >
          <LayoutGrid size={14} />
        </Button>
      )}
    </div>
  );
}
