import { useState } from 'react';
import { Button, Field, Input, Select, Modal } from '../ui/index.js';
import { activeRevision } from '../../data/defaults.js';
import { validateBlueprint, validationMessage } from '../../core/schema.js';
import FadeMeshControls from '../editor/FadeMeshControls.jsx';
import BlueprintPreview from './BlueprintPreview.jsx';

export default function BlueprintFadeEditor({ entry, onSave, onClose, disabled }) {
  const [bp, setBp] = useState(() => structuredClone(activeRevision(entry).blueprint));
  const images = bp.layers.filter((l) => l.type === 'image');
  const [selected, setSelected] = useState(images[0]?.id),
    [error, setError] = useState('');
  const layer = images.find((l) => l.id === selected);
  const change = (patch) =>
    setBp((old) => ({
      ...old,
      layers: old.layers.map((l) => (l.id === selected ? { ...l, ...patch } : l)),
    }));
  return (
    <Modal
      title={`Blueprint fade · ${entry.marketId} ${bp.width} × ${bp.height}`}
      onClose={onClose}
      wide
    >
      <fieldset disabled={disabled} inert={disabled} className="studio-selection-fields">
        <div className="blueprint-fade-editor">
          <BlueprintPreview
            entry={entry}
            blueprint={bp}
            editingLayerId={selected}
            onMeshChange={(fadeMesh) => change({ fadeMesh })}
          />
          <div>
            {images.length > 1 && (
              <Field label="Image area">
                <Select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  {images.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {layer && (
              <>
                <FadeMeshControls layer={layer} onChange={change} />
                {!layer.fadeMesh?.enabled && (
                  <Field label="Background fade">
                    <Input
                      aria-label="Background fade"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={layer.fade}
                      onChange={(e) => change({ fade: +e.target.value })}
                    />
                  </Field>
                )}
                <Field label="Fade from">
                  <Select
                    value={layer.fadeDirection}
                    onChange={(e) => change({ fadeDirection: e.target.value })}
                  >
                    {['top', 'bottom', 'left', 'right'].map((d) => (
                      <option key={d}>{d}</option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <p className="panel-note">
              Drag the points to shape the fade. Dashed lines show its softness.
            </p>
          </div>
        </div>
        <p className="panel-note">
          Saves a new blueprint revision and updates the matching Studio banner. Campaign text and
          image placement are kept.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              try {
                onSave(validateBlueprint(bp));
                onClose();
              } catch (e) {
                setError(validationMessage(e));
              }
            }}
          >
            Save blueprint fade
          </Button>
        </div>
      </fieldset>
    </Modal>
  );
}
