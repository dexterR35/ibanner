import { useMemo } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { automationCounts } from '../../core/automation-state.js';
import { referenceSummary } from '../../core/ai-arrange.js';
import AutoPlaceSubject from './AutoPlaceSubject.jsx';

/** One-line summary of what automatic arrangement is doing for the active market. */
function automationStatus(campaign, counts, arranging) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (arranging)
    return { kind: 'busy', text: `Arranging ${plural(counts.pending || counts.total, 'format')}…` };
  // Pending without an active pass means images or fonts failed to load.
  if (counts.pending) return { kind: 'stale', text: `${counts.pending} waiting for assets` };
  if (campaign.autoArrange === false)
    return counts.stale
      ? { kind: 'stale', text: `Auto off · ${counts.stale} out of date` }
      : { kind: 'off', text: 'Auto off · layouts frozen' };
  const changed = counts.reflow + counts.photo;
  const mode = campaign.keepBlueprintBoxes ? 'Blueprint boxes' : 'Auto';
  return {
    kind: 'ready',
    text: `${mode} · ${plural(counts.total, 'format')} ready${changed ? ` · ${changed} adapted` : ''}`,
  };
}

export default function CanvasCampaignActions({ comparing = false, onCompare = () => {} }) {
  const {
    campaign,
    market,
    entries,
    project,
    resources,
    busy,
    arranging,
    changeCampaign,
    matchBlueprints,
    arrangeAll,
  } = useWorkspace();
  const disabled = !resources || !!busy;
  const examples = useMemo(
    () => referenceSummary(project, market.id),
    [project.blueprints, market.id],
  );
  // `entries` is re-filtered on every render; key on the stable project data instead.
  const counts = useMemo(
    () => automationCounts(entries, project.banners, campaign),
    [project.blueprints, project.banners, campaign, market.id],
  );
  const status = comparing
    ? { kind: 'compare', text: 'Showing saved designs · release to see automatic layouts' }
    : automationStatus(campaign, counts, arranging);
  const hold = (on) => (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    onCompare(on);
  };
  return (
    <div
      className="canvas-campaign-actions"
      role="group"
      aria-label={`${market.id} canvas actions`}
    >
      <AutoPlaceSubject />
      <Button
        variant="secondary"
        className="image-fade-action"
        aria-label="Image fade"
        aria-pressed={campaign.imageFadeEnabled !== false}
        onClick={() => changeCampaign({ imageFadeEnabled: campaign.imageFadeEnabled === false })}
        title={`Turn image fades ${campaign.imageFadeEnabled === false ? 'on' : 'off'} for all ${market.id} banners`}
        disabled={disabled}
      >
        Fade: {campaign.imageFadeEnabled === false ? 'Off' : 'On'}
      </Button>
      <Button
        variant="secondary"
        className="match-blueprints-action"
        aria-pressed={campaign.keepBlueprintBoxes === true}
        onClick={() =>
          campaign.keepBlueprintBoxes
            ? changeCampaign({ keepBlueprintBoxes: false })
            : matchBlueprints()
        }
        title={`Keep ${market.id} banners aligned to their blueprint boxes`}
        disabled={disabled}
      >
        Match blueprints
      </Button>
      <Button
        variant="secondary"
        className="arrange-now-action"
        onClick={arrangeAll}
        title={
          campaign.keepBlueprintBoxes
            ? `Fit ${market.id} copy inside the fixed blueprint boxes.`
            : `Arrange ${market.id} with AI: analyze the photo (OpenCV, BiRefNet, PaddleOCR, Florence-2), let Qwen3-VL propose layouts from the nearest measured blueprints, and keep the best-scoring layout per size. ${examples}.`
        }
        disabled={disabled}
      >
        Arrange now
      </Button>
      <Button
        variant="secondary"
        className="auto-arrange-action"
        aria-label="Automatic arrangement"
        aria-pressed={campaign.autoArrange !== false}
        onClick={() => {
          const enabled = campaign.autoArrange === false;
          changeCampaign({ autoArrange: enabled });
        }}
        title={`Refit ${market.id} layouts automatically after copy or image changes`}
        disabled={disabled}
      >
        Auto: {campaign.autoArrange === false ? 'Off' : 'On'}
      </Button>
      <Button
        variant="secondary"
        className="compare-action"
        aria-pressed={comparing}
        onPointerDown={hold(true)}
        onPointerUp={hold(false)}
        onPointerLeave={hold(false)}
        onPointerCancel={hold(false)}
        onKeyDown={(event) => (event.key === ' ' || event.key === 'Enter') && onCompare(true)}
        onKeyUp={(event) => (event.key === ' ' || event.key === 'Enter') && onCompare(false)}
        onBlur={() => onCompare(false)}
        title="Hold (or hold D) to show the saved designs instead of the automatic layouts"
        disabled={!counts.reflow && !counts.photo}
      >
        Hold to compare
      </Button>
      <span
        className={`automation-status is-${status.kind}`}
        role="status"
        aria-label="Automatic arrangement status"
        title={examples}
      >
        {status.kind === 'busy' && <LoaderCircle size={12} className="spin" />}
        {status.text}
      </span>
    </div>
  );
}
