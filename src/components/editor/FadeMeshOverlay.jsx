import { Group, Line, Circle } from 'react-konva';
import { localToMesh, meshBoundary, meshToLocal, moveMeshPoint } from '../../core/fade-mesh.js';

/** Interaction overlay only; the shared renderer paints the exported fade. */
export default function FadeMeshOverlay({
  layer,
  visible,
  screenScale,
  accent,
  onStart,
  onPreview,
  onCommit,
}) {
  const mesh = layer.fadeMesh;
  function move(event, index) {
    const point = localToMesh({ x: event.target.x(), y: event.target.y() }, layer);
    const next = moveMeshPoint(mesh, index, point);
    event.target.position(meshToLocal(next.points[index], layer));
    return next;
  }
  return (
    <Group x={visible.x} y={visible.y} rotation={layer.rotation}>
      {[-mesh.softness / 2, 0, mesh.softness / 2].map((offset) => (
        <Line
          key={offset}
          points={meshBoundary(layer, offset).flatMap((p) => [p.x, p.y])}
          stroke={accent}
          strokeWidth={(offset ? 1 : 1.5) / screenScale}
          opacity={offset ? 0.45 : 1}
          dash={offset ? [4 / screenScale, 4 / screenScale] : undefined}
          listening={false}
        />
      ))}
      {mesh.points.map((point, index) => (
        <Circle
          key={index}
          {...meshToLocal(point, layer)}
          radius={5 / screenScale}
          fill={accent}
          stroke="#111315"
          strokeWidth={1.5 / screenScale}
          hitStrokeWidth={10 / screenScale}
          draggable
          onMouseDown={(event) => {
            event.cancelBubble = true;
          }}
          onTouchStart={(event) => {
            event.cancelBubble = true;
          }}
          onDragStart={onStart}
          onDragMove={(event) => onPreview({ fadeMesh: move(event, index) })}
          onDragEnd={(event) => {
            onCommit({ fadeMesh: move(event, index) });
            onPreview(null);
          }}
          onTouchCancel={() => onPreview(null)}
        />
      ))}
    </Group>
  );
}
