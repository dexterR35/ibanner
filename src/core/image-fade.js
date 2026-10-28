import { drawMeshFade, meshAlpha } from './fade-mesh.js';

/** Distance from the faded edge and position along it, both normalized to the layer. */
function edgeCoordinates(direction, u, v) {
  const along = { left: u, right: 1 - u, top: v, bottom: 1 - v }[direction];
  return { depth: along, across: ['left', 'right'].includes(direction) ? v : u };
}

function linearGradient(ctx, w, h, dir) {
  return ctx.createLinearGradient(
    dir === 'right' ? w : 0,
    dir === 'bottom' ? h : 0,
    dir === 'left' ? w : 0,
    dir === 'top' ? h : 0,
  );
}

function drawEdgeFade(ctx, layer, background) {
  const { direction, solid, depth } = layer.edgeFade;
  const gradient = linearGradient(ctx, layer.width, layer.height, direction);
  gradient.addColorStop(0, background);
  gradient.addColorStop(solid, background);
  gradient.addColorStop(depth, `${background}00`);
  gradient.addColorStop(1, `${background}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, layer.width, layer.height);
}

/** Shared treatment for artwork previews, exports and blueprint diagrams. */
export function drawImageFade(ctx, layer, background) {
  if (layer.fadeMesh?.enabled) drawMeshFade(ctx, layer, background);
  else if (layer.fade > 0) {
    const { width: w, height: h, fadeDirection: dir } = layer;
    const gradient = linearGradient(ctx, w, h, dir);
    gradient.addColorStop(0, background);
    gradient.addColorStop(layer.fade, `${background}00`);
    gradient.addColorStop(1, `${background}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }
  if (layer.edgeFade) drawEdgeFade(ctx, layer, background);
}

/**
 * Opacity of the background color painted over the photo at a layer-local point
 * (u, v in 0..1): 1 means only background is visible there. Mirrors drawImageFade.
 */
export function fadeAlphaAt(layer, u, v) {
  let main = 0;
  if (layer.fadeMesh?.enabled) {
    const { depth, across } = edgeCoordinates(layer.fadeDirection, u, v);
    main = meshAlpha(layer.fadeMesh, across, depth);
  } else if (layer.fade > 0) {
    const { depth } = edgeCoordinates(layer.fadeDirection, u, v);
    main = Math.max(0, 1 - depth / layer.fade);
  }
  let edge = 0;
  if (layer.edgeFade) {
    const { direction, solid, depth: end } = layer.edgeFade;
    const { depth } = edgeCoordinates(direction, u, v);
    edge = depth <= solid ? 1 : depth >= end ? 0 : 1 - (depth - solid) / (end - solid);
  }
  return 1 - (1 - main) * (1 - edge);
}

/** Smallest background opacity over a banner-space rectangle inside an image layer. */
export function minFadeOver(layer, rect, samples = 9) {
  const x0 = Math.max(rect.x, layer.x),
    y0 = Math.max(rect.y, layer.y),
    x1 = Math.min(rect.x + rect.width, layer.x + layer.width),
    y1 = Math.min(rect.y + rect.height, layer.y + layer.height);
  if (x1 <= x0 || y1 <= y0) return 1;
  let min = 1;
  for (let i = 0; i < samples; i++)
    for (let j = 0; j < samples; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / samples,
        y = y0 + ((y1 - y0) * (j + 0.5)) / samples;
      min = Math.min(
        min,
        fadeAlphaAt(layer, (x - layer.x) / layer.width, (y - layer.y) / layer.height),
      );
    }
  return min;
}

/** Fraction of a banner-space rectangle where the photo is noticeably faded (alpha > limit). */
export function fadedFraction(layer, rect, limit = 0.1, samples = 12) {
  let faded = 0,
    total = 0;
  for (let i = 0; i < samples; i++)
    for (let j = 0; j < samples; j++) {
      const x = rect.x + (rect.width * (i + 0.5)) / samples,
        y = rect.y + (rect.height * (j + 0.5)) / samples;
      if (x < layer.x || y < layer.y || x > layer.x + layer.width || y > layer.y + layer.height)
        continue;
      total++;
      if (fadeAlphaAt(layer, (x - layer.x) / layer.width, (y - layer.y) / layer.height) > limit)
        faded++;
    }
  return total ? faded / (samples * samples) : 0;
}
