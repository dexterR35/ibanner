/** Rectangle-based text-space suggestions. No image recognition or hidden copy changes. */
import { meshFadeExtent } from './fade-mesh.js';
const overlaps = (a, b) =>
  a.x < b.x + b.width - 0.01 &&
  a.x + a.width > b.x + 0.01 &&
  a.y < b.y + b.height - 0.01 &&
  a.y + a.height > b.y + 0.01;
const contains = (a, b) =>
  a.x <= b.x + 0.01 &&
  a.y <= b.y + 0.01 &&
  a.x + a.width >= b.x + b.width - 0.01 &&
  a.y + a.height >= b.y + b.height - 0.01;

function interval(layer, scene) {
  const track = scene.tracks[layer.id] || {};
  return !layer.visible || layer.opacity === 0 || track.visible === false
    ? null
    : [track.startMs || 0, track.endMs ?? scene.durationMs];
}
function boundingBox(layer, track = {}) {
  let { x, y, width, height } = layer;
  // Text can use the dark half of a fade. The clearer half of the photo is reserved.
  if (layer.type === 'image') {
    const fade = layer.fadeMesh?.enabled ? meshFadeExtent(layer) : (layer.fade || 0) * 0.5;
    if (layer.fadeDirection === 'left') {
      x += width * fade;
      width *= 1 - fade;
    }
    if (layer.fadeDirection === 'right') width *= 1 - fade;
    if (layer.fadeDirection === 'top') {
      y += height * fade;
      height *= 1 - fade;
    }
    if (layer.fadeDirection === 'bottom') height *= 1 - fade;
  }
  const angle = ((layer.rotation || 0) * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const points = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height],
  ].map(([px, py]) => ({
    x: layer.x + (px - layer.x) * cos - (py - layer.y) * sin,
    y: layer.y + (px - layer.x) * sin + (py - layer.y) * cos,
  }));
  const left = Math.min(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y));
  const right = Math.max(...points.map((p) => p.x)),
    bottom = Math.max(...points.map((p) => p.y));
  return {
    x: left + Math.min(0, track.dx || 0),
    y: top + Math.min(0, track.dy || 0),
    width: right - left + Math.abs(track.dx || 0),
    height: bottom - top + Math.abs(track.dy || 0),
  };
}

export function textObstacles(bp, layer) {
  const boxes = [];
  const others = bp.layers.filter((other) => other.id !== layer.id && other.type !== 'background');
  for (const scene of bp.scenes) {
    const active = interval(layer, scene);
    if (!active) continue;
    for (const other of others) {
      const otherActive = interval(other, scene);
      if (
        !otherActive ||
        Math.max(active[0], otherActive[0]) >= Math.min(active[1], otherActive[1])
      )
        continue;
      boxes.push(boundingBox(other, scene.tracks[other.id]));
    }
  }
  // A crossfade composites the previous scene's final frame over the next one.
  // Reserve both sides of that overlap, even if their normal tracks are disjoint.
  for (let i = 1; i < bp.scenes.length; i++) {
    const scene = bp.scenes[i],
      previous = bp.scenes[i - 1];
    if (!scene.transitionMs) continue;
    const atEnd = (candidate) => {
      const active = interval(candidate, previous);
      return active && active[0] <= previous.durationMs - 1 && active[1] > previous.durationMs - 1;
    };
    const atStart = (candidate) => {
      const active = interval(candidate, scene);
      return active && active[0] < scene.transitionMs && active[1] > 0;
    };
    for (const other of others) {
      if (atStart(layer) && atEnd(other)) boxes.push(boundingBox(other, previous.tracks[other.id]));
      if (atEnd(layer) && atStart(other)) boxes.push(boundingBox(other, scene.tracks[other.id]));
    }
  }
  return boxes;
}

function freeRectangles(canvas, obstacles) {
  let spaces = [canvas];
  for (const obstacle of obstacles) {
    const next = [];
    for (const r of spaces) {
      if (!overlaps(r, obstacle)) {
        next.push(r);
        continue;
      }
      const right = r.x + r.width,
        bottom = r.y + r.height;
      if (obstacle.x > r.x) next.push({ ...r, width: obstacle.x - r.x });
      if (obstacle.x + obstacle.width < right)
        next.push({
          ...r,
          x: obstacle.x + obstacle.width,
          width: right - obstacle.x - obstacle.width,
        });
      if (obstacle.y > r.y) next.push({ ...r, height: obstacle.y - r.y });
      if (obstacle.y + obstacle.height < bottom)
        next.push({
          ...r,
          y: obstacle.y + obstacle.height,
          height: bottom - obstacle.y - obstacle.height,
        });
    }
    const unique = [
      ...new Map(
        next
          .filter((r) => r.width >= 4 && r.height >= 4)
          .map((r) => [[r.x, r.y, r.width, r.height].join(','), r]),
      ).values(),
    ];
    spaces = unique
      .filter((r, i) => !unique.some((other, j) => j !== i && contains(other, r)))
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .slice(0, 160);
  }
  return spaces;
}

/** Find a usable region near the text, clear in every scene where it is visible. */
export function suggestTextLayout(bp, layerId) {
  const layer = bp.layers.find((l) => l.id === layerId);
  if (!layer || layer.type !== 'text' || layer.source === 'legal')
    return { error: 'Choose a headline, subtitle or custom text layer.' };
  if (layer.rotation !== 0 || bp.scenes.some((s) => s.tracks[layerId]?.dx || s.tracks[layerId]?.dy))
    return { error: 'Reset this text layer’s rotation and movement before arranging its space.' };
  if (!bp.scenes.some((s) => interval(layer, s)))
    return { error: 'Show this text in at least one animation part first.' };
  const inset = bp.height <= 100 ? 4 : 8,
    gap = bp.height <= 100 ? 4 : 6;
  const obstacles = textObstacles(bp, layer).map((r) => ({
    x: r.x - gap,
    y: r.y - gap,
    width: r.width + 2 * gap,
    height: r.height + 2 * gap,
  }));
  const spaces = freeRectangles(
    { x: inset, y: inset, width: bp.width - 2 * inset, height: bp.height - 2 * inset },
    obstacles,
  ).filter(
    (r) =>
      r.width >= Math.max(20, layer.minFontSize * 2) &&
      r.height >= layer.minFontSize * layer.lineHeight,
  );
  const cx = layer.x + layer.width / 2,
    cy = layer.y + layer.height / 2;
  const score = (r) => {
    const near = cx >= r.x && cx <= r.x + r.width && cy >= r.y && cy <= r.y + r.height;
    const distance = Math.hypot(
      (r.x + r.width / 2 - cx) / bp.width,
      (r.y + r.height / 2 - cy) / bp.height,
    );
    return (r.width * r.height * (near ? 2 : 1)) / (1 + distance * 4);
  };
  spaces.sort((a, b) => score(b) - score(a));
  if (!spaces.length)
    return { error: 'No clear text area fits. Move nearby layers or use another animation part.' };
  const best = spaces[0],
    x = Math.ceil(best.x),
    y = Math.ceil(best.y);
  const width = Math.floor(best.x + best.width) - x,
    height = Math.floor(best.y + best.height) - y;
  return {
    patch: {
      x,
      y,
      width,
      height,
      verticalAlign: 'middle',
      textFlow:
        layer.textFlow === 'single-line'
          ? 'single-line'
          : layer.textOverride != null
            ? 'manual'
            : 'auto',
      fontSize: Math.max(
        layer.minFontSize,
        Math.min(160, Math.floor((height / layer.lineHeight) * 2) / 2),
      ),
    },
  };
}
