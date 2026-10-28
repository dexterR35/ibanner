export const clampZoom = (value) => Math.max(0.1, Math.min(3, value));

/** Keep the artboard collection within a finite workspace, with a small edge gutter. */
export function constrainCamera(camera, layout, viewport, top = 32, left = 32, bottom = 32) {
  const zoom = clampZoom(camera.zoom);
  const axis = (position, content, available, start, end = 32) => {
    const far = available - content * zoom - end;
    return Math.max(Math.min(start, far), Math.min(Math.max(start, far), position));
  };
  return {
    x: axis(camera.x, layout.width, viewport.width, left),
    y: axis(camera.y, layout.height, viewport.height, top, bottom),
    zoom,
  };
}
