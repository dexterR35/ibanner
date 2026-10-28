import { autoAnimate, needsAutoAnimation } from '../../core/auto-animation.js';
import { Checkbox, Button, Field, Input, NumberField } from '../ui/index.js';
import { Layers, Image as ImageIcon, Type, Square, Eye, EyeOff, Plus } from 'lucide-react';
import BannerTypography from '../campaign/BannerTypography.jsx';

export default function EditorLayers({
  blueprintMode = false,
  bp,
  selected,
  setSelected,
  editLayer,
  addLayer,
  guides,
  setGuides,
  update,
  campaign,
  onCampaignChange,
  assetsBusy,
  entry,
  setPlaying,
  setTime,
}) {
  return (
    <aside className="layer-panel">
      <div className="panel-title">
        <Layers size={15} /> Layers <span>{bp.layers.length}</span>
      </div>
      <div className="layer-list">
        {[...bp.layers].reverse().map((l) => (
          <div className={`layer-row ${selected === l.id ? 'active' : ''}`} key={l.id}>
            <Button variant="plain" onClick={() => setSelected(l.id)}>
              {['image', 'logo'].includes(l.type) ? (
                <ImageIcon size={15} />
              ) : l.type === 'text' ? (
                <Type size={15} />
              ) : (
                <Square size={15} />
              )}
              <span>{l.name}</span>
            </Button>
            <Button
              variant="icon"
              title={`Toggle ${l.name}`}
              onClick={() => editLayer(l.id, { visible: !l.visible })}
            >
              {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </Button>
          </div>
        ))}
      </div>
      <div className="layer-actions">
        {blueprintMode ? (
          ['headline', 'subtitle', 'legal'].map((source) => (
            <Button
              key={source}
              aria-label={`Add ${source} layer`}
              variant="secondary"
              onClick={() => addLayer('text', source)}
            >
              <Plus size={14} />{' '}
              {{ headline: 'Headline', subtitle: 'Subtitle', legal: 'Legal' }[source]}
            </Button>
          ))
        ) : (
          <Button variant="secondary" onClick={() => addLayer('text')}>
            <Plus size={14} /> Text
          </Button>
        )}
        <Button variant="secondary" onClick={() => addLayer('shape')}>
          <Plus size={14} /> Shape
        </Button>
        {blueprintMode &&
          ['image', 'logo', 'button'].map((type) => (
            <Button key={type} variant="secondary" onClick={() => addLayer(type)}>
              <Plus size={14} /> {{ image: 'Image', logo: 'Logo', button: 'CTA' }[type]}
            </Button>
          ))}
      </div>
      <Checkbox
        label="Show 8 px guide"
        checked={guides}
        onChange={(e) => setGuides(e.target.checked)}
      />
      <Field label="Canvas background">
        <Input
          type="color"
          value={bp.background}
          onChange={(e) => update({ ...bp, background: e.target.value })}
        />
      </Field>
      {onCampaignChange && (
        <BannerTypography campaign={campaign} onChange={onCampaignChange} disabled={assetsBusy} />
      )}
      <Checkbox
        label="Create GIF"
        checked={bp.mode === 'animated'}
        onChange={(event) => {
          setPlaying(false);
          setTime(0);
          update(
            event.target.checked && needsAutoAnimation(bp)
              ? autoAnimate(bp, blueprintMode ? null : campaign)
              : { ...bp, mode: event.target.checked ? 'animated' : 'static' },
          );
        }}
      />
      {bp.mode === 'animated' && (
        <NumberField
          label="GIF repeat (0 = forever)"
          value={bp.repeat}
          min={0}
          max={100}
          onChange={(v) => update({ ...bp, repeat: Math.max(0, Math.min(100, Math.round(v))) })}
        />
      )}
    </aside>
  );
}
