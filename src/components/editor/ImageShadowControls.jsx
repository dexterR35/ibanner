import { Field, Input, NumberField } from '../ui/index.js';

export default function ImageShadowControls({ layer, onChange }) {
  const shadow = {
    enabled: false,
    color: '#000000',
    opacity: 0.5,
    blur: 8,
    offsetX: 0,
    offsetY: 4,
    ...layer.shadow,
  };
  const change = (patch) => onChange({ shadow: { ...shadow, ...patch } });
  return (
    <div className="image-shadow-controls">
      <label className="check">
        <Input
          type="checkbox"
          aria-label="Image shadow"
          checked={shadow.enabled}
          onChange={(e) => change({ enabled: e.target.checked })}
        />
        Image shadow
      </label>
      {shadow.enabled && (
        <>
          <Field label="Shadow color">
            <Input
              type="color"
              value={shadow.color}
              onChange={(e) => change({ color: e.target.value })}
            />
          </Field>
          <div className="field-grid">
            <NumberField
              label="Shadow blur"
              value={shadow.blur}
              min={0}
              max={40}
              onChange={(v) => change({ blur: Math.max(0, Math.min(40, v)) })}
            />
            <NumberField
              label="Shadow opacity %"
              value={Math.round(shadow.opacity * 100)}
              min={0}
              max={100}
              onChange={(v) => change({ opacity: Math.max(0, Math.min(1, v / 100)) })}
            />
            <NumberField
              label="Shadow horizontal"
              value={shadow.offsetX}
              min={-100}
              max={100}
              onChange={(v) => change({ offsetX: Math.max(-100, Math.min(100, v)) })}
            />
            <NumberField
              label="Shadow vertical"
              value={shadow.offsetY}
              min={-100}
              max={100}
              onChange={(v) => change({ offsetY: Math.max(-100, Math.min(100, v)) })}
            />
          </div>
        </>
      )}
    </div>
  );
}
