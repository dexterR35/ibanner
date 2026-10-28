const clamp = (value) => Math.max(0, Math.min(1, value));

export function imagePlacement(image, layer, crop) {
  const [sx, sy, sw, sh] = crop || [
    0,
    0,
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
  ];
  const contain = layer.imageFit === 'contain';
  const scale = (contain ? Math.min : Math.max)(layer.width / sw, layer.height / sh) * layer.zoom;
  return {
    sx,
    sy,
    sw,
    sh,
    scale,
    travelX: contain ? sw * scale - layer.width : Math.max(0, sw * scale - layer.width),
    travelY: contain ? sh * scale - layer.height : Math.max(0, sh * scale - layer.height),
  };
}

/** Drag the artwork in canvas pixels; the frame and its fade never move. */
export function panImage(image, layer, crop, dx, dy) {
  const { travelX, travelY } = imagePlacement(image, layer, crop);
  // Convert a canvas-space drag into the rotated image frame's local axes.
  const angle = ((layer.rotation || 0) * Math.PI) / 180;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    focalX: travelX > 0.001 ? clamp(layer.focalX - localX / travelX) : layer.focalX,
    focalY: travelY > 0.001 ? clamp(layer.focalY - localY / travelY) : layer.focalY,
  };
}
