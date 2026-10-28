import { reserveLegalFooter } from '../../core/legal-footer.js';
import FadeMeshDiagram from './FadeMeshDiagram.jsx';

/** Blueprints are structural diagrams; they never receive campaign content or uploads. */
export default function BlueprintPreview({ blueprint, editingLayerId, onMeshChange }) {
  blueprint = reserveLegalFooter(blueprint);
  return (
    <div className="blueprint-placeholder">
      <svg
        className="blueprint-diagram"
        viewBox={`0 0 ${blueprint.width} ${blueprint.height}`}
        role="img"
        aria-label={`Layout diagram ${blueprint.width} by ${blueprint.height}`}
      >
        <rect width={blueprint.width} height={blueprint.height} fill="#101719" />
        {blueprint.layers
          .filter((layer) => layer.visible)
          .map((layer) => (
            <g
              key={layer.id}
              transform={`translate(${layer.x} ${layer.y}) rotate(${layer.rotation})`}
            >
              <rect
                width={layer.width}
                height={layer.height}
                fill={layer.type === 'image' ? '#293e3b' : '#1c2629'}
                fillOpacity="0.8"
                stroke={layer.type === 'image' ? '#82b7a9' : '#9bacae'}
                strokeWidth="0.8"
                strokeDasharray="3 3"
              />
              <text
                x={
                  ['text', 'button'].includes(layer.type) && layer.align === 'left'
                    ? 3
                    : ['text', 'button'].includes(layer.type) && layer.align === 'right'
                      ? layer.width - 3
                      : layer.width / 2
                }
                y={layer.height / 2}
                dominantBaseline="central"
                textAnchor={
                  ['text', 'button'].includes(layer.type) && layer.align === 'left'
                    ? 'start'
                    : ['text', 'button'].includes(layer.type) && layer.align === 'right'
                      ? 'end'
                      : 'middle'
                }
                fill="#c9d5d3"
                fontSize={Math.max(3, Math.min(12, layer.height * 0.5, layer.width / 8))}
              >
                {layer.source === 'hero'
                  ? 'Image'
                  : layer.source === 'custom'
                    ? layer.type
                    : layer.source}
              </text>
            </g>
          ))}
        {blueprint.layers
          .filter((l) => l.type === 'image' && l.visible && l.fadeMesh?.enabled)
          .map((layer) => (
            <FadeMeshDiagram
              key={layer.id}
              layer={layer}
              onChange={layer.id === editingLayerId ? onMeshChange : undefined}
            />
          ))}
      </svg>
      <small>Layout diagram</small>
    </div>
  );
}
