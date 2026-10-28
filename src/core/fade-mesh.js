const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));

/** A normalized edge-to-edge fade boundary. x runs across the edge, y into the image. */
export function meshDepth(points, x) {
  const i = Math.max(
    0,
    points.findIndex((p, i) => i < points.length - 1 && x <= points[i + 1].x),
  );
  const a = points[i],
    b = points[i + 1];
  if (x >= 1) return points.at(-1).y;
  const t = clamp((x - a.x) / (b.x - a.x));
  // Smooth, bounded interpolation; moving a point cannot cause overshoot outside the frame.
  return a.y + (b.y - a.y) * t * t * (3 - 2 * t);
}

export function createFadeMesh(preset = 'u', count = 16, depth = 0.35) {
  return {
    enabled: true,
    softness: 0.25,
    points: Array.from({ length: count }, (_, i) => {
      const x = i / (count - 1),
        curve = Math.sin(Math.PI * x) ** 2;
      return {
        x,
        y:
          preset === 'straight' ? depth : preset === 'arch' ? 0.6 - 0.4 * curve : 0.2 + 0.4 * curve,
      };
    }),
  };
}

export function resampleFadeMesh(mesh, count) {
  return {
    ...mesh,
    points: Array.from({ length: count }, (_, i) => {
      const x = i / (count - 1);
      return { x, y: meshDepth(mesh.points, x) };
    }),
  };
}

export function meshToLocal(point, layer) {
  const { width: w, height: h, fadeDirection: direction } = layer;
  if (direction === 'left') return { x: point.y * w, y: point.x * h };
  if (direction === 'right') return { x: (1 - point.y) * w, y: point.x * h };
  return { x: point.x * w, y: (direction === 'bottom' ? 1 - point.y : point.y) * h };
}

export function localToMesh(point, layer) {
  const x = point.x / layer.width,
    y = point.y / layer.height;
  if (layer.fadeDirection === 'left') return { x: y, y: x };
  if (layer.fadeDirection === 'right') return { x: y, y: 1 - x };
  return { x, y: layer.fadeDirection === 'bottom' ? 1 - y : y };
}

export function moveMeshPoint(mesh, index, point) {
  const min = index === 0 ? 0 : mesh.points[index - 1].x + 0.005;
  const max = index === mesh.points.length - 1 ? 1 : mesh.points[index + 1].x - 0.005;
  const x = index === 0 ? 0 : index === mesh.points.length - 1 ? 1 : clamp(point.x, min, max);
  return {
    ...mesh,
    points: mesh.points.map((p, i) => (i === index ? { x, y: clamp(point.y) } : p)),
  };
}

export function meshBoundary(layer, offset = 0, samples = 128) {
  return Array.from({ length: samples + 1 }, (_, i) => {
    const x = i / samples;
    return meshToLocal({ x, y: clamp(meshDepth(layer.fadeMesh.points, x) + offset) }, layer);
  });
}

export function meshAlpha(mesh, across, depth) {
  const t = clamp((depth - meshDepth(mesh.points, across)) / mesh.softness + 0.5);
  return 1 - t * t * (3 - 2 * t);
}

/** Conservative rectangular clear/dark regions for layout and crop suggestions. */
export function meshFadeExtent(layer, clear = false) {
  const mesh = layer.fadeMesh;
  return clamp(
    (clear ? Math.max : Math.min)(...mesh.points.map((p) => p.y)) +
      (clear ? 0.25 : -0.25) * mesh.softness,
  );
}

// Bound retained surfaces to four megapixels; crops and GIF opacity/movement reuse the same mask.
const masks = new Map();
export function drawMeshFade(ctx, layer, background) {
  const ratio = Math.min(1, 1024 / Math.max(layer.width, layer.height));
  const w = Math.max(1, Math.ceil(layer.width * ratio)),
    h = Math.max(1, Math.ceil(layer.height * ratio));
  const key = JSON.stringify([w, h, background, layer.fadeDirection, layer.fadeMesh]);
  let canvas = masks.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d'),
      pixels = context.createImageData(w, h);
    const rgb = [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16));
    const horizontal = ['left', 'right'].includes(layer.fadeDirection);
    const reversed = ['right', 'bottom'].includes(layer.fadeDirection);
    const count = horizontal ? h : w,
      length = horizontal ? w : h;
    const depths = Array.from({ length: count }, (_, i) =>
      meshDepth(layer.fadeMesh.points, (i + 0.5) / count),
    );
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let d = ((horizontal ? x : y) + 0.5) / length;
        if (reversed) d = 1 - d;
        const t = clamp((d - depths[horizontal ? y : x]) / layer.fadeMesh.softness + 0.5);
        const i = (y * w + x) * 4;
        pixels.data[i] = rgb[0];
        pixels.data[i + 1] = rgb[1];
        pixels.data[i + 2] = rgb[2];
        pixels.data[i + 3] = Math.round(255 * (1 - t * t * (3 - 2 * t)));
      }
    context.putImageData(pixels, 0, 0);
    masks.set(key, canvas);
    if (masks.size > 4) masks.delete(masks.keys().next().value);
  }
  ctx.drawImage(canvas, 0, 0, layer.width, layer.height);
}
