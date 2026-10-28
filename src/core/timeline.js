export const totalDuration = (bp) => bp.scenes.reduce((n, scene) => n + scene.durationMs, 0);
export function sceneAt(bp, timeMs) {
  const total = totalDuration(bp);
  let local = ((timeMs % total) + total) % total;
  for (let index = 0; index < bp.scenes.length; index++) {
    const scene = bp.scenes[index];
    if (local < scene.durationMs) return { scene, index, local };
    local -= scene.durationMs;
  }
}
export const sceneStart = (bp, index) =>
  bp.scenes.slice(0, index).reduce((n, s) => n + s.durationMs, 0);
export function layerAt(layer, scene, local) {
  const track = scene.tracks[layer.id];
  if (!layer.visible || track?.visible === false) return { ...layer, visible: false };
  const start = track?.startMs ?? 0,
    end = track?.endMs ?? scene.durationMs;
  if (local < start || local >= end) return { ...layer, visible: false };
  const enter = track?.fadeInMs ? Math.min(1, (local - start) / track.fadeInMs) : 1;
  const leave = track?.fadeOutMs ? Math.min(1, (end - local) / track.fadeOutMs) : 1;
  const progress = (local - start) / (end - start);
  return {
    ...layer,
    opacity: layer.opacity * Math.min(enter, leave),
    x: layer.x + (track?.dx ?? 0) * progress,
    y: layer.y + (track?.dy ?? 0) * progress,
  };
}
/** Boundaries are included so cut-only GIFs keep their original timing exactly. */
export function animationSamples(bp, fps = 10) {
  const total = totalDuration(bp),
    points = new Set([0, total]);
  let offset = 0;
  for (const scene of bp.scenes) {
    points.add(offset);
    points.add(offset + scene.durationMs);
    const moving =
      scene.transitionMs > 0 ||
      Object.values(scene.tracks).some((t) => t.fadeInMs || t.fadeOutMs || t.dx || t.dy);
    if (moving)
      for (let t = 1000 / fps; t < scene.durationMs; t += 1000 / fps)
        points.add(offset + Math.round(t));
    for (const track of Object.values(scene.tracks)) {
      points.add(offset + (track.startMs ?? 0));
      points.add(offset + (track.endMs ?? scene.durationMs));
    }
    offset += scene.durationMs;
  }
  const times = [...points].sort((a, b) => a - b);
  return times.slice(0, -1).map((time, i) => ({ time, delay: times[i + 1] - time }));
}
