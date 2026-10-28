import { Button } from '../ui/index.js';
import BannerPreview from '../banner/BannerPreview.jsx';
import { sceneStart } from '../../core/timeline.js';

export const gifGroupHeight = (bp) =>
  bp.height + 36 + (bp.mode === 'animated' ? bp.scenes.length * (bp.height + 56) : 0);

/** Native-size snapshots from the same scene renderer used by GIF export. */
export default function GifParts({ blueprint, campaign, resources, disabled, onSelectPart }) {
  if (blueprint.mode !== 'animated') return null;
  return (
    <div
      className="gif-parts"
      aria-label={`${blueprint.width}x${blueprint.height} animation parts`}
    >
      {blueprint.scenes.map((scene, index) => (
        <div className="gif-part" key={scene.id}>
          <div className="gif-part-heading">
            <span title={scene.name}>
              {index + 1} · {scene.name}
            </span>
            <span>{scene.durationMs / 1000}s</span>
          </div>
          <Button
            variant="plain"
            className="artboard-preview gif-part-preview"
            aria-label={`Select part ${index + 1} of ${blueprint.width}x${blueprint.height}: ${scene.name}`}
            disabled={disabled || !resources}
            onClick={() => onSelectPart(scene.id)}
          >
            {resources && (
              <BannerPreview
                blueprint={blueprint}
                campaign={campaign}
                resources={resources}
                time={sceneStart(blueprint, index) + scene.durationMs / 2}
              />
            )}
          </Button>
        </div>
      ))}
    </div>
  );
}
