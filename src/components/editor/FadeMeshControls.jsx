import { Button, Field, Input, Select } from '../ui/index.js';
import { createFadeMesh, resampleFadeMesh } from '../../core/fade-mesh.js';

export default function FadeMeshControls({ layer, onChange, editing, onEdit }) {
  const mesh = layer.fadeMesh,
    enabled = !!mesh?.enabled;
  return (
    <section className="fade-mesh-controls" aria-label="Fade shape">
      <Field label="Fade shape">
        <Select
          value={enabled ? 'mesh' : 'linear'}
          onChange={(event) => {
            const enable = event.target.value === 'mesh';
            onChange({ fadeMesh: { ...(mesh || createFadeMesh()), enabled: enable } });
            onEdit?.(enable);
          }}
        >
          <option value="linear">Linear fade</option>
          <option value="mesh">Mesh · editable points</option>
        </Select>
      </Field>
      {enabled && (
        <>
          <div className="fade-presets" aria-label="Fade presets">
            {['straight', 'u', 'arch'].map((preset) => (
              <Button
                key={preset}
                variant="secondary"
                onClick={() => {
                  onChange({
                    fadeMesh: {
                      ...createFadeMesh(preset, mesh.points.length, layer.fade / 2),
                      softness: mesh.softness,
                    },
                  });
                  onEdit?.(true);
                }}
              >
                {preset === 'u' ? 'U shape' : preset === 'arch' ? 'Arch' : 'Straight'}
              </Button>
            ))}
          </div>
          <Field label="Fade points">
            <Select
              value={mesh.points.length}
              onChange={(event) =>
                onChange({ fadeMesh: resampleFadeMesh(mesh, +event.target.value) })
              }
            >
              {Array.from({ length: 15 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n} points
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Fade softness · ${Math.round(mesh.softness * 100)}%`}>
            <Input
              aria-label="Fade softness"
              type="range"
              min={0.01}
              max={1}
              step={0.01}
              value={mesh.softness}
              onChange={(event) =>
                onChange({ fadeMesh: { ...mesh, softness: +event.target.value } })
              }
            />
          </Field>
          {onEdit && (
            <Button
              variant={editing ? 'primary' : 'secondary'}
              className="full"
              aria-pressed={editing}
              onClick={() => onEdit(!editing)}
            >
              {editing ? 'Done editing fade' : 'Edit fade points'}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
