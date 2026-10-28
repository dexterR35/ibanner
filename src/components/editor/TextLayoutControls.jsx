import { Button, Field, NumberField, Select, Textarea } from '../ui/index.js';
import { RotateCcw } from 'lucide-react';

import { boundText } from '../../core/render.js';

export default function TextLayoutControls({ layer, campaign, onChange, showCopy = true }) {
  const flow = layer.textFlow || 'manual';
  return (
    <section className="text-layout-controls" aria-label="Text layout">
      <div className="panel-title">Text layout</div>
      <Field
        label="Text flow"
        hint={
          flow === 'auto'
            ? 'Reflows campaign text into balanced rows for this box.'
            : flow === 'single-line'
              ? 'Joins line breaks into one horizontal line.'
              : 'Keeps your line breaks; wraps long rows when needed.'
        }
      >
        <Select value={flow} onChange={(e) => onChange({ textFlow: e.target.value })}>
          <option value="auto">Auto · balanced rows</option>
          <option value="single-line">Single horizontal line</option>
          <option value="manual">Keep my line breaks</option>
        </Select>
      </Field>
      <div className="field-grid">
        <Field label="Vertical alignment">
          <Select
            value={layer.verticalAlign || 'middle'}
            onChange={(e) => onChange({ verticalAlign: e.target.value })}
          >
            <option value="top">Top</option>
            <option value="middle">Middle</option>
            <option value="bottom">Bottom</option>
          </Select>
        </Field>
        <NumberField
          label="Line spacing"
          value={layer.lineHeight}
          min={0.8}
          max={2}
          step={0.05}
          onChange={(v) => onChange({ lineHeight: Math.max(0.8, Math.min(2, v)) })}
        />
      </div>
      {showCopy && layer.source !== 'custom' && (
        <>
          <Field label="Text / rows for this format">
            <Textarea
              rows={3}
              value={boundText(layer, campaign)}
              onChange={(e) => onChange({ textOverride: e.target.value })}
            />
          </Field>
          {layer.textOverride != null && (
            <Button variant="subtle" onClick={() => onChange({ textOverride: null })}>
              <RotateCcw size={12} /> Use campaign copy
            </Button>
          )}
        </>
      )}
    </section>
  );
}
