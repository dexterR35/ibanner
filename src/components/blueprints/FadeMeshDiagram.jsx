import { useRef } from 'react';
import { localToMesh, meshBoundary, meshToLocal, moveMeshPoint } from '../../core/fade-mesh.js';

export default function FadeMeshDiagram({ layer, onChange }) {
  const group = useRef(null),
    dragging = useRef(null),
    mesh = layer.fadeMesh;
  if (!mesh?.enabled) return null;
  const radius = Math.max(3, Math.min(10, layer.width / 55));
  function drag(event, index) {
    if (dragging.current !== index) return;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      group.current.getScreenCTM().inverse(),
    );
    onChange(moveMeshPoint(mesh, index, localToMesh(local, layer)));
  }
  return (
    <g
      ref={group}
      className="fade-mesh-diagram"
      transform={`translate(${layer.x} ${layer.y}) rotate(${layer.rotation})`}
    >
      {[-mesh.softness / 2, 0, mesh.softness / 2].map((offset) => (
        <polyline
          key={offset}
          points={meshBoundary(layer, offset)
            .map((p) => `${p.x},${p.y}`)
            .join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={offset ? 0.75 : 1.5}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={offset ? '3 3' : undefined}
          opacity={offset ? 0.5 : 1}
          pointerEvents="none"
        />
      ))}
      {onChange &&
        mesh.points.map((point, index) => {
          const p = meshToLocal(point, layer);
          return (
            <circle
              key={index}
              cx={p.x}
              cy={p.y}
              r={radius}
              fill="var(--accent)"
              stroke="#101719"
              strokeWidth={1}
              role="button"
              tabIndex={0}
              aria-label={`Fade point ${index + 1}`}
              style={{ touchAction: 'none', cursor: 'move' }}
              onPointerDown={(event) => {
                event.preventDefault();
                dragging.current = index;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.focus();
              }}
              onPointerMove={(event) => drag(event, index)}
              onPointerUp={(event) => {
                drag(event, index);
                dragging.current = null;
              }}
              onPointerCancel={() => {
                dragging.current = null;
              }}
              onKeyDown={(event) => {
                const delta = {
                  ArrowLeft: [-1, 0],
                  ArrowRight: [1, 0],
                  ArrowUp: [0, -1],
                  ArrowDown: [0, 1],
                }[event.key];
                if (!delta) return;
                event.preventDefault();
                const step = event.shiftKey ? 10 : 1;
                onChange(
                  moveMeshPoint(
                    mesh,
                    index,
                    localToMesh({ x: p.x + delta[0] * step, y: p.y + delta[1] * step }, layer),
                  ),
                );
              }}
            />
          );
        })}
    </g>
  );
}
