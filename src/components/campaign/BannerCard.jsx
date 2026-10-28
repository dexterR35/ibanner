import { Button } from '../ui/index.js';
import { Maximize2, Film, LoaderCircle, Download } from 'lucide-react';
import { resolveBanner } from '../../data/defaults.js';
import { automationState, AUTOMATION_HINTS } from '../../core/automation-state.js';
import BannerPreview from '../banner/BannerPreview.jsx';
import GifParts from './GifParts.jsx';

/** One artboard on the shared Studio surface; output pixels keep their native dimensions. */
export default function BannerCard({
  entry,
  banner,
  campaign,
  resources,
  busy = false,
  onEdit,
  onExport,
  onSelect,
  onSelectPart,
  selected = false,
  labelRoom = Infinity,
  showDesign = false,
  children,
}) {
  const state = automationState(entry, banner, campaign);
  // Compare mode shows the saved design wherever automation changed the layout.
  const comparing = showDesign && ['reflow', 'photo'].includes(state?.kind);
  const bp = resolveBanner(entry, comparing ? { ...banner, arrangement: null } : banner);
  // Heading room in screen pixels: full label, a dot, or nothing on very narrow boards.
  const automation = labelRoom >= 100 ? state : null;
  const compact = labelRoom < 280;
  // Narrow boards (160 px wide at overview zoom) keep the size and the editor button only;
  // export stays available in the focused editor and in the set export.
  const tight = labelRoom < 150;
  return (
    <article
      className={`banner-card banner-artboard ${bp.mode === 'animated' ? 'gif-artboard-group' : ''} ${selected ? 'is-selected' : ''} ${comparing ? 'is-comparing' : ''}`}
      aria-label={`${bp.width} by ${bp.height} artboard`}
      style={{
        '--artboard-width': `${bp.width}px`,
        '--artboard-ratio': `${bp.width} / ${bp.height}`,
      }}
    >
      <div className={`artboard-heading ${tight ? 'is-tight' : ''}`}>
        <Button
          variant="plain"
          className="artboard-move-handle"
          data-artboard-move={entry.id}
          aria-label={`Move artboard ${bp.width}x${bp.height}`}
          title="Drag to arrange artboards"
          disabled={busy}
          onClick={onSelect}
        >
          {bp.width} <span>×</span> {bp.height}
          {entry.variantLabel ? ` · ${entry.variantLabel}` : ''}
        </Button>
        <div className="artboard-actions">
          {comparing && (
            <span className="artboard-compare" data-compare title="Showing the saved design">
              {compact ? 'Saved' : 'Saved design'}
            </span>
          )}
          {automation && !comparing && (
            <span
              className={`artboard-automation is-${automation.kind} ${compact ? 'is-compact' : ''}`}
              data-automation={automation.kind}
              title={`${automation.label}: ${AUTOMATION_HINTS[automation.kind]}`}
            >
              <span className="artboard-automation-label">{automation.label}</span>
            </span>
          )}
          <Button
            variant="icon"
            title="Open focused editor"
            aria-label={`Edit banner ${bp.width}x${bp.height}`}
            disabled={!resources || busy}
            onClick={onEdit}
          >
            <Maximize2 size={13} />
          </Button>
          {bp.mode === 'animated' && !tight && (
            <span className="artboard-gif" title="Animated GIF">
              <Film size={12} /> {compact ? 'GIF' : 'GIF · Main'}
            </span>
          )}
          {!tight && (
            <Button
              variant="icon"
              title={`Export ${bp.width}x${bp.height}`}
              aria-label={`Export ${bp.width}x${bp.height}`}
              disabled={!resources || busy}
              onClick={() => onExport(bp)}
            >
              <Download size={13} />
            </Button>
          )}
        </div>
      </div>
      {selected ? (
        <div className="artboard-preview selected-artboard-preview">{children}</div>
      ) : (
        <Button
          variant="plain"
          className="artboard-preview"
          aria-label={`Select banner ${bp.width}x${bp.height}`}
          onClick={onSelect}
          disabled={!resources || busy}
        >
          {resources ? (
            <BannerPreview blueprint={bp} campaign={campaign} resources={resources} />
          ) : (
            <LoaderCircle className="spin" />
          )}
          <span className="artboard-edit">Select banner</span>
        </Button>
      )}
      <GifParts
        blueprint={bp}
        campaign={campaign}
        resources={resources}
        disabled={busy}
        onSelectPart={onSelectPart}
      />
    </article>
  );
}
