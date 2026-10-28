import { renderFrame } from './render.js';
import { drawImageFade } from './image-fade.js';

/** Schematic layers use the artwork renderer’s transforms, scenes and crossfades. */
function drawDiagramLayer(ctx, layer, _campaign, _resources, bp) {
  if (!layer.visible || layer.opacity <= 0) return;
  const { width, height } = layer;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  ctx.fillStyle = layer.type === 'image' ? '#41695d' : '#253b37';
  ctx.fillRect(0, 0, width, height);
  if (layer.type === 'image') drawImageFade(ctx, layer, bp.background);
  ctx.strokeStyle = '#9db6b0';
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = '#e0ede9';
  ctx.font = `500 ${Math.max(6, Math.min(16, height / 4, width / 8))}px sans-serif`;
  const text = layer.type === 'text' || layer.type === 'button';
  const align = text ? layer.align : 'center';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(
    layer.source === 'custom' ? layer.name : layer.source,
    align === 'left' ? 3 : align === 'right' ? width - 3 : width / 2,
    height / 2,
    Math.max(1, width - 6),
  );
  ctx.restore();
}

export function renderBlueprintDiagram(canvas, bp, time = 0) {
  return renderFrame(canvas, bp, {}, {}, time, drawDiagramLayer);
}
