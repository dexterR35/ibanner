import {
  Checkbox,
  Button,
  Field,
  Input,
  NumberField,
  Select,
  Textarea,
  AssetUpload,
} from '../ui/index.js';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import TextLayoutControls from './TextLayoutControls.jsx';
import { focusImage } from '../../core/subject-position.js';
import LayerAssetPreview from './LayerAssetPreview.jsx';
import FadeMeshControls from './FadeMeshControls.jsx';
import ImageShadowControls from './ImageShadowControls.jsx';

export default function LayerInspector({
  blueprintMode = false,
  bp,
  selectedLayer,
  selected,
  imageMode,
  setImageMode,
  setPlaying,
  campaign,
  resources,
  change,
  entry,
  logoAssetName,
  onLogoUpload,
  assetsBusy,
  reorder,
  deleteLayer,
  issues,
}) {
  return (
    <aside className="inspector">
      <div className="panel-title">
        Properties <span>{selectedLayer?.type || 'canvas'}</span>
      </div>
      {selectedLayer ? (
        <>
          {!blueprintMode && (
            <details className="generation-locks">
              <summary>Automatic generation locks</summary>
              {['position', 'size', 'font', 'crop', 'visibility', 'copy', 'variant'].map((lock) => (
                <Checkbox
                  key={lock}
                  label={`Lock ${lock}`}
                  checked={selectedLayer.locks?.includes(lock) || false}
                  onChange={(e) =>
                    change({
                      locks: e.target.checked
                        ? [...(selectedLayer.locks || []), lock]
                        : (selectedLayer.locks || []).filter((v) => v !== lock),
                    })
                  }
                />
              ))}
            </details>
          )}
          {selectedLayer.type === 'image' && (
            <div className="image-position-controls">
              {!blueprintMode && (
                <LayerAssetPreview
                  image={resources.hero}
                  crop={resources.heroCrop}
                  label="Campaign image source"
                />
              )}
              {!blueprintMode && campaign.imageFadeEnabled === false && (
                <p className="panel-note">
                  Image fades are off for {entry.marketId}. Your fade settings are kept. Turn “Fade:
                  On” in Studio to preview them.
                </p>
              )}
              <FadeMeshControls
                layer={selectedLayer}
                onChange={change}
                editing={imageMode === 'mesh'}
                onEdit={(active) => {
                  setImageMode(active ? 'mesh' : blueprintMode ? 'frame' : 'pan');
                  setPlaying(false);
                }}
              />
              <ImageShadowControls layer={selectedLayer} onChange={change} />
              {!blueprintMode && (
                <div className="segmented image-edit-mode" aria-label="Image editing mode">
                  <Button
                    variant="plain"
                    aria-pressed={imageMode === 'pan'}
                    className={imageMode === 'pan' ? 'active' : ''}
                    onClick={() => {
                      setImageMode('pan');
                      setPlaying(false);
                    }}
                  >
                    Reposition image
                  </Button>
                  <Button
                    variant="plain"
                    aria-pressed={imageMode === 'frame'}
                    className={imageMode === 'frame' ? 'active' : ''}
                    onClick={() => setImageMode('frame')}
                  >
                    Edit frame
                  </Button>
                </div>
              )}
              <p className="panel-note">
                {imageMode === 'mesh'
                  ? 'Drag the fade points. The photo and frame stay fixed.'
                  : imageMode === 'pan'
                    ? 'Drag the photo inside its fixed frame. Zoom in to reposition both axes. The fade stays anchored.'
                    : 'Move or resize the whole image frame and its fade together.'}
              </p>
              {!blueprintMode &&
                campaign.subjectFocus?.assetId === campaign.heroAssetId &&
                campaign.subjectFocus && (
                  <Button
                    variant="secondary"
                    className="full"
                    disabled={
                      !!selectedLayer.rotation ||
                      bp.scenes.some((s) => s.tracks[selected]?.dx || s.tracks[selected]?.dy)
                    }
                    onClick={() => {
                      setPlaying(false);
                      change(
                        focusImage(
                          bp,
                          selectedLayer,
                          resources.hero,
                          campaign.subjectFocus.box,
                          resources.heroCrop,
                        ).patch,
                      );
                    }}
                  >
                    Focus on {campaign.subjectFocus.label}
                  </Button>
                )}
            </div>
          )}
          {selectedLayer.type === 'image' && <div className="panel-title">Frame geometry</div>}
          <div className="field-grid">
            {['width', 'height'].map((key) => (
              <NumberField
                key={key}
                label={key.toUpperCase()}
                value={selectedLayer[key]}
                disabled={selectedLayer.type === 'image' && imageMode !== 'frame'}
                min={4}
                max={4096}
                onChange={(v) => change({ [key]: Math.max(4, Math.min(4096, v)) })}
              />
            ))}
            <NumberField
              label="Opacity %"
              value={Math.round(selectedLayer.opacity * 100)}
              min={0}
              max={100}
              onChange={(v) => change({ opacity: Math.max(0, Math.min(1, v / 100)) })}
            />
          </div>
          {['text', 'button'].includes(selectedLayer.type) && (
            <>
              <TextLayoutControls
                showCopy={!blueprintMode}
                layer={selectedLayer}
                campaign={campaign}
                onChange={(patch) => {
                  setPlaying(false);
                  change(patch);
                }}
              />
              <div className="panel-title">Typography</div>
              {!blueprintMode && selectedLayer.source === 'custom' && (
                <Field label="Text">
                  <Textarea
                    value={selectedLayer.text}
                    onChange={(e) => change({ text: e.target.value })}
                  />
                </Field>
              )}
              <div className="field-grid">
                <NumberField
                  label="Minimum size"
                  value={selectedLayer.minFontSize}
                  min={1}
                  max={500}
                  onChange={(v) =>
                    change({
                      minFontSize: Math.max(1, Math.min(500, v)),
                      fontSize: Math.max(selectedLayer.fontSize, Math.max(1, Math.min(500, v))),
                    })
                  }
                />
                <NumberField
                  label="Max lines"
                  value={selectedLayer.maxLines}
                  min={1}
                  max={20}
                  onChange={(v) => change({ maxLines: Math.max(1, Math.min(20, Math.round(v))) })}
                />
                <Field label="Alignment">
                  <Select
                    value={selectedLayer.align}
                    onChange={(e) => change({ align: e.target.value })}
                  >
                    {['left', 'center', 'right'].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label={selectedLayer.type === 'button' ? 'Button color' : 'Text color'}>
                <Input
                  type="color"
                  value={selectedLayer.fill}
                  onChange={(e) => change({ fill: e.target.value })}
                />
              </Field>
              <div className="glow-controls">
                {selectedLayer.type === 'button' && (
                  <>
                    <Field label="Button text color">
                      <Input
                        type="color"
                        value={selectedLayer.textFill || '#ffffff'}
                        onChange={(e) => change({ textFill: e.target.value })}
                      />
                    </Field>
                    <div className="field-grid">
                      <NumberField
                        label="Text padding horizontal"
                        value={selectedLayer.textPaddingX ?? 6}
                        min={0}
                        max={500}
                        onChange={(v) => change({ textPaddingX: Math.max(0, Math.min(500, v)) })}
                      />
                      <NumberField
                        label="Text padding vertical"
                        value={selectedLayer.textPaddingY ?? 2}
                        min={0}
                        max={500}
                        onChange={(v) => change({ textPaddingY: Math.max(0, Math.min(500, v)) })}
                      />
                    </div>
                  </>
                )}
                <label className="check glow-toggle">
                  <Input
                    type="checkbox"
                    aria-label="Text glow"
                    checked={selectedLayer.glow?.enabled ?? false}
                    onChange={(e) =>
                      change({
                        glow: {
                          color: '#ff162d',
                          blur: 8,
                          opacity: 0.85,
                          ...selectedLayer.glow,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  Text glow <span>On / off</span>
                </label>
                {selectedLayer.glow?.enabled && (
                  <>
                    <Field label="Glow color">
                      <Input
                        type="color"
                        value={selectedLayer.glow.color}
                        onChange={(e) =>
                          change({ glow: { ...selectedLayer.glow, color: e.target.value } })
                        }
                      />
                    </Field>
                    <NumberField
                      label="Glow radius (px)"
                      value={selectedLayer.glow.blur}
                      min={0}
                      max={40}
                      onChange={(value) =>
                        change({
                          glow: {
                            ...selectedLayer.glow,
                            blur: Math.max(0, Math.min(40, value)),
                          },
                        })
                      }
                    />
                    <Field
                      label={`Glow strength · ${Math.round(selectedLayer.glow.opacity * 100)}%`}
                    >
                      <Input
                        type="range"
                        aria-label="Glow strength"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedLayer.glow.opacity}
                        onChange={(e) =>
                          change({ glow: { ...selectedLayer.glow, opacity: +e.target.value } })
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
            </>
          )}
          {selectedLayer.type === 'image' && (
            <>
              <div className="panel-title">Image treatment</div>
              {[
                ['focalX', 'Horizontal focus', 0, 1, 0.01],
                ['focalY', 'Vertical focus', 0, 1, 0.01],
                ['zoom', 'Zoom', 1, 4, 0.05],
                ['fade', 'Background fade', 0, 1, 0.01],
              ]
                .filter(
                  ([key]) =>
                    (!blueprintMode || key === 'fade') &&
                    (key !== 'fade' || !selectedLayer.fadeMesh?.enabled),
                )
                .map(([key, label, min, max, step]) => (
                  <Field key={key} label={`${label} · ${selectedLayer[key].toFixed(2)}`}>
                    <Input
                      type="range"
                      value={selectedLayer[key]}
                      min={min}
                      max={max}
                      step={step}
                      onChange={(e) => change({ [key]: +e.target.value })}
                    />
                  </Field>
                ))}
              <Field label="Fade from">
                <Select
                  value={selectedLayer.fadeDirection}
                  onChange={(e) => change({ fadeDirection: e.target.value })}
                >
                  {['top', 'bottom', 'left', 'right'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </Field>
              {!blueprintMode && (
                <Button
                  variant="secondary"
                  className="full"
                  onClick={() => change({ focalX: 0.5, focalY: 0.5, zoom: 1 })}
                >
                  Reset image position
                </Button>
              )}
            </>
          )}
          {selectedLayer.type === 'logo' && (
            <>
              {!blueprintMode && (
                <LayerAssetPreview
                  image={resources.logo}
                  label={`Logo source · ${logoAssetName || 'Campaign logo'}`}
                />
              )}
              {onLogoUpload && (
                <AssetUpload
                  label={selectedLayer.name}
                  assetName={logoAssetName}
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  hint={`Logo image shared across ${entry.marketId} formats. SVG or transparent PNG recommended.`}
                  onUpload={onLogoUpload}
                  disabled={assetsBusy}
                />
              )}
            </>
          )}
          {selectedLayer.type === 'shape' && (
            <Field label="Fill">
              <Input
                type="color"
                value={selectedLayer.fill}
                onChange={(e) => change({ fill: e.target.value })}
              />
            </Field>
          )}
          <div className="row">
            <Button variant="secondary" onClick={() => reorder(1)} title="Bring forward">
              <ArrowUp size={14} />
            </Button>
            <Button variant="secondary" onClick={() => reorder(-1)} title="Send backward">
              <ArrowDown size={14} />
            </Button>
            <Button variant="secondary" disabled={bp.layers.length === 1} onClick={deleteLayer}>
              <Trash2 size={14} /> Remove
            </Button>
          </div>
        </>
      ) : (
        <p className="muted">Select a layer from the canvas or layer list.</p>
      )}
      {!blueprintMode && (
        <details className="review-notes">
          <summary>Review notes ({issues.length})</summary>
          {issues.map((i) => (
            <p key={i.code}>{i.message}</p>
          ))}
        </details>
      )}
    </aside>
  );
}
