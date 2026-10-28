/** Reserve the existing bottom legal box as a separate footer, without changing its copy. */
export function reserveLegalFooter(bp) {
  const stationary = (layer) =>
    !layer.rotation &&
    !bp.scenes.some((scene) => scene.tracks[layer.id]?.dx || scene.tracks[layer.id]?.dy);
  const legal = bp.layers.find(
    (layer) =>
      layer.type === 'text' &&
      layer.source === 'legal' &&
      layer.visible &&
      layer.y >= bp.height * 0.75 &&
      stationary(layer),
  );
  if (!legal) return bp;
  const gap = bp.height <= 100 ? 2 : 4;
  const bottom = legal.y - gap;
  let changed = false;
  const layers = bp.layers.map((layer) => {
    if (
      layer.type !== 'image' ||
      !layer.visible ||
      !stationary(layer) ||
      layer.y + layer.height <= bottom ||
      layer.y >= bottom ||
      layer.x >= legal.x + legal.width ||
      layer.x + layer.width <= legal.x ||
      !bp.scenes.some(
        (scene) =>
          scene.tracks[layer.id]?.visible !== false && scene.tracks[legal.id]?.visible !== false,
      )
    )
      return layer;
    const height = Math.max(4, Math.floor(bottom - layer.y));
    if (height === layer.height) return layer;
    changed = true;
    return { ...layer, height };
  });
  return changed ? { ...bp, layers } : bp;
}
