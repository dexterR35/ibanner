import { imagePlacement } from './image-position.js';
import { textObstacles } from './text-layout.js';
import { meshFadeExtent } from './fade-mesh.js';
import { fadedFraction } from './image-fade.js';

const clamp = (v) => Math.max(0, Math.min(1, v));
const area = (r) => r.width * r.height;
const intersection = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export function placedSubject(image, layer, box, crop) {
  const { sx, sy, scale, travelX, travelY } = imagePlacement(image, layer, crop);
  const w = image.naturalWidth || image.width,
    h = image.naturalHeight || image.height;
  return {
    x: layer.x + (box.x * w - sx) * scale - travelX * layer.focalX,
    y: layer.y + (box.y * h - sy) * scale - travelY * layer.focalY,
    width: box.width * w * scale,
    height: box.height * h * scale,
  };
}
function obstaclesFor(bp, layer) {
  // Only layers painted above the photo can cover its subject.
  const index = bp.layers.findIndex((l) => l.id === layer.id);
  return textObstacles(
    {
      ...bp,
      scenes: bp.mode === 'static' ? bp.scenes.slice(0, 1) : bp.scenes,
      // The photo's own cut-out repaints the subject; it never hides it.
      layers: bp.layers
        .slice(index)
        .filter((l) => !(l.type === 'cutout' && l.linkedLayerId === layer.id)),
    },
    layer,
  );
}
function visibleFrame(layer) {
  const clear = { ...layer },
    fade = layer.fadeMesh?.enabled ? meshFadeExtent(layer, true) : (layer.fade || 0) * 0.65;
  if (layer.fadeDirection === 'left') {
    clear.x += clear.width * fade;
    clear.width *= 1 - fade;
  }
  if (layer.fadeDirection === 'right') clear.width *= 1 - fade;
  if (layer.fadeDirection === 'top') {
    clear.y += clear.height * fade;
    clear.height *= 1 - fade;
  }
  if (layer.fadeDirection === 'bottom') clear.height *= 1 - fade;
  return clear;
}
function assess(rect, layer, obstacles) {
  const size = area(rect);
  const clipped = 1 - intersection(rect, layer) / size;
  const visible = {
    x: Math.max(rect.x, layer.x),
    y: Math.max(rect.y, layer.y),
    width: Math.max(
      0,
      Math.min(rect.x + rect.width, layer.x + layer.width) - Math.max(rect.x, layer.x),
    ),
    height: Math.max(
      0,
      Math.min(rect.y + rect.height, layer.y + layer.height) - Math.max(rect.y, layer.y),
    ),
  };
  const covered = Math.min(
    1,
    obstacles.reduce((sum, r) => sum + intersection(visible, r), 0) / size,
  );
  // Curved and edge fades are measured with the renderer's own alpha, not a bounding box.
  const faded =
    layer.fadeMesh?.enabled || layer.edgeFade
      ? fadedFraction(layer, rect)
      : Math.max(0, (intersection(rect, layer) - intersection(rect, visibleFrame(layer))) / size);
  return { clipped, covered, faded, score: clipped * 1000 + covered * 700 + faded * 180 };
}
export function assessSubject(bp, layer, image, box, crop) {
  const moving =
    layer.rotation || bp.scenes.some((s) => s.tracks[layer.id]?.dx || s.tracks[layer.id]?.dy);
  if (moving) return { unsupported: true, score: 0 };
  return assess(placedSubject(image, layer, box, crop), layer, obstaclesFor(bp, layer));
}
/** Find the least obstructed cover crop without moving its frame or fade. */
export function focusImage(bp, layer, image, box, crop) {
  if (assessSubject(bp, layer, image, box, crop).unsupported) return { patch: {}, score: 0 };
  const obstacles = obstaclesFor(bp, layer);
  let best = null;
  const w = image.naturalWidth || image.width,
    h = image.naturalHeight || image.height;
  for (const zoom of [...new Set([1, layer.zoom, 1.15, 1.35, 1.65, 2])]) {
    const next = { ...layer, zoom };
    const { sx, sy, scale, travelX, travelY } = imagePlacement(image, next, crop);
    const cx = ((box.x + box.width / 2) * w - sx) * scale,
      cy = ((box.y + box.height / 2) * h - sy) * scale;
    const xs = new Set([0, 1, layer.focalX]),
      ys = new Set([0, 1, layer.focalY]);
    for (let i = 1; i < 20; i++) {
      xs.add(travelX > 0 ? clamp((cx - (layer.width * i) / 20) / travelX) : layer.focalX);
      ys.add(travelY > 0 ? clamp((cy - (layer.height * i) / 20) / travelY) : layer.focalY);
    }
    for (const focalX of xs)
      for (const focalY of ys) {
        const candidate = { ...next, focalX, focalY };
        const rect = placedSubject(image, candidate, box, crop);
        const fit = assess(rect, candidate, obstacles);
        const center = Math.hypot(
          (rect.x + rect.width / 2 - layer.x) / layer.width - 0.5,
          (rect.y + rect.height / 2 - layer.y) / layer.height - 0.5,
        );
        const score = fit.score + (zoom - 1) * 3 + center * 0.25;
        if (!best || score < best.score) best = { patch: { focalX, focalY, zoom }, score };
      }
  }
  return best;
}

export function focusBlueprint(bp, campaign, resources) {
  const focus = campaign.subjectFocus;
  if (!focus || focus.assetId !== campaign.heroAssetId || !resources.hero)
    return { blueprint: bp, score: 0 };
  let score = 0;
  const layers = bp.layers.map((l) => {
    if (l.type !== 'image' || l.source !== 'hero' || !l.visible) return l;
    const result = focusImage(bp, l, resources.hero, focus.box, resources.heroCrop);
    score += result.score;
    return { ...l, ...result.patch };
  });
  return { blueprint: { ...bp, layers }, score };
}
