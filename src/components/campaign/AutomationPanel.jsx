import { useEffect, useMemo, useState } from 'react';
import { Wand2, Scissors, Expand, ImageUp, Download, Palette, Type } from 'lucide-react';
import { Button, Checkbox, NumberField, SelectField } from '../ui/index.js';
import { useWorkspace } from '../../hooks/useWorkspace.js';
import { toolsStatus } from '../../core/tools-service.js';
import { extractPalette, suggestColors } from '../../core/palette.js';
import { canvasOf } from '../../core/render.js';
import { getAsset } from '../../core/storage.js';
import { download } from '../../core/export.js';
import { resolveBanner } from '../../data/defaults.js';
import { COPY_ROLE_NAMES, DEFAULT_TEXT_HIERARCHY } from '../../data/text-hierarchy.js';

function useToolsStatus() {
  const [revision, setRevision] = useState(0),
    [status, setStatus] = useState({ checking: true });
  useEffect(() => {
    const controller = new AbortController();
    setStatus({ checking: true });
    toolsStatus(controller.signal).then(
      (value) => !controller.signal.aborted && setStatus(value),
      () => !controller.signal.aborted && setStatus({ offline: true }),
    );
    return () => controller.abort();
  }, [revision]);
  return { status, refresh: () => setRevision((value) => value + 1) };
}

/** Palette of a small proxy of the original photo; recomputed when the photo changes. */
function usePalette(image) {
  return useMemo(() => {
    if (!image) return [];
    const scale = Math.min(1, 96 / Math.max(image.width, image.height)),
      canvas = canvasOf(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale)),
      ),
      context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return extractPalette(context.getImageData(0, 0, canvas.width, canvas.height).data);
  }, [image]);
}

function ColourSuggestions() {
  const { campaign, entries, project, resources, changeCampaign } = useWorkspace();
  const colors = usePalette(resources?.heroSource);
  const background = entries[0]
    ? resolveBanner(entries[0], project.banners[entries[0].id]).background
    : '#0c1320';
  if (!colors.length) return null;
  const { accent, cta } = suggestColors(colors, background);
  return (
    <div className="automation-block" role="group" aria-label="Colour suggestions">
      <div className="automation-title">
        <Palette size={14} /> Colours from the photo
      </div>
      <div className="palette-swatches">
        {colors.map((item) => (
          <span
            key={item.color}
            title={`${item.color} · ${Math.round(item.weight * 100)}%`}
            style={{ background: item.color, flexGrow: Math.max(0.3, item.weight * 10) }}
          />
        ))}
      </div>
      <div className="suggestion-row">
        <Button
          variant="subtle"
          onClick={() => changeCampaign({ accentColor: accent })}
          aria-pressed={campaign.accentColor === accent}
        >
          <i style={{ background: accent }} /> Use as accent
        </Button>
        <Button
          variant="subtle"
          onClick={() => changeCampaign({ ctaColor: cta })}
          aria-pressed={campaign.ctaColor === cta}
        >
          <i style={{ background: cta }} /> Use for CTA
        </Button>
      </div>
      {campaign.ctaColor && (
        <Button
          variant="plain"
          className="text-action"
          onClick={() => changeCampaign({ ctaColor: null })}
        >
          Restore layout CTA colours
        </Button>
      )}
      <p>
        Suggestions keep the accent readable on the banner background and white CTA text readable.
      </p>
    </div>
  );
}

/** Market copy hierarchy kept by automatic arrangement (stored on the market's campaign). */
function TextHierarchy() {
  const { campaign, market, changeCampaign } = useWorkspace();
  const rule = campaign.textHierarchy;
  const fallback = DEFAULT_TEXT_HIERARCHY[market.id] || {
    larger: 'subtitle',
    smaller: 'headline',
    minRatio: 1,
  };
  const change = (patch) => changeCampaign({ textHierarchy: { ...rule, ...patch } });
  const exceptions = Object.entries(rule?.sizes || {});
  return (
    <div className="automation-block" role="group" aria-label="Copy hierarchy">
      <div className="automation-title">
        <Type size={14} /> Copy hierarchy
      </div>
      <Checkbox
        label="Keep copy hierarchy when arranging"
        checked={Boolean(rule)}
        onChange={(event) =>
          changeCampaign({ textHierarchy: event.target.checked ? structuredClone(fallback) : null })
        }
      />
      {rule && (
        <div className="row">
          <SelectField
            label="Larger copy"
            value={rule.larger}
            onChange={(event) =>
              change({
                larger: event.target.value,
                smaller: event.target.value === 'headline' ? 'subtitle' : 'headline',
              })
            }
          >
            {Object.entries(COPY_ROLE_NAMES).map(([role, name]) => (
              <option key={role} value={role}>
                {name}
              </option>
            ))}
          </SelectField>
          <NumberField
            label="At least ×"
            min="0.5"
            max="3"
            step={0.05}
            value={rule.minRatio}
            onChange={(value) =>
              change({ minRatio: Math.round(Math.max(0.5, Math.min(3, value)) * 100) / 100 })
            }
          />
        </div>
      )}
      <p>
        {rule
          ? `${COPY_ROLE_NAMES[rule.larger]} renders at least ${rule.minRatio}× the ${COPY_ROLE_NAMES[rule.smaller].toLowerCase()} size${exceptions.length ? `; ${exceptions.map(([size, ratio]) => `${size.replace('x', '×')} uses ${ratio}×`).join(', ')}` : ''}. Only automatic arrangement applies it; saved edits are kept.`
          : `No hierarchy rule for ${market.id}. Copy keeps the sizes its boxes give it.`}
      </p>
    </div>
  );
}

function ImageTools() {
  const { campaign, tools, setTreatment, changeCampaign, subject } = useWorkspace();
  const { status, refresh } = useToolsStatus();
  const { job, needs, variants } = tools;
  const ready = (tool) => status.tools?.[tool]?.ready;
  const busy = job?.loading || subject.placing;
  const disabled = (tool) => !campaign.heroAssetId || !ready(tool) || busy;
  const describe = (pads) =>
    pads &&
    `${Math.round((pads.left + pads.right + pads.top + pads.bottom) * 100)}% more ${pads.left ? 'width' : 'height'}`;
  const focus =
    campaign.subjectFocus?.assetId === campaign.heroAssetId ? campaign.subjectFocus : null;
  return (
    <div className="automation-block" role="group" aria-label="Image tools">
      <div className="automation-title">
        <Wand2 size={14} /> Image tools
        <span>{status.checking ? 'Checking…' : status.offline ? 'Offline' : status.device}</span>
      </div>
      {!campaign.heroAssetId && (
        <p>Upload a campaign image to use cut-out, upscale and extension.</p>
      )}
      {status.offline && (
        <p>
          Start the local service with npm run dev. Tools run on this computer only.{' '}
          <Button variant="plain" className="text-action" onClick={refresh}>
            Check again
          </Button>
        </p>
      )}
      {status.tools &&
        Object.entries(status.tools)
          .filter(([, tool]) => !tool.ready)
          .map(([name, tool]) => (
            <p key={name}>
              {name}: {tool.issues.map((issue) => issue.message).join(' ')}
            </p>
          ))}
      <div className="tool-row">
        <Button
          variant="secondary"
          disabled={disabled('cutout')}
          onClick={() => tools.cutout()}
          title={
            focus ? `Cut out ${focus.label}` : 'Choose a subject focus first for a single object'
          }
        >
          <Scissors size={14} /> Cut out {focus ? 'subject' : 'foreground'}
        </Button>
        <Button
          variant="subtle"
          disabled={disabled('cutout')}
          onClick={() => tools.cutout({ whole: true })}
        >
          Remove background
        </Button>
      </div>
      {variants.cutout && (
        <>
          <Checkbox
            label="Subject in front of text"
            checked={campaign.subjectInFront !== false}
            onChange={(event) => setTreatment({ subjectInFront: event.target.checked })}
          />
          <Button
            variant="plain"
            className="text-action"
            onClick={async () =>
              download(
                await getAsset(variants.cutout.assetId),
                `cutout-${campaign.heroAssetId.slice(0, 8)}.png`,
              )
            }
          >
            <Download size={12} /> Download transparent PNG
          </Button>
        </>
      )}
      <div className="tool-row">
        <Button variant="secondary" disabled={disabled('upscale')} onClick={() => tools.upscale()}>
          <ImageUp size={14} /> Upscale ×{needs.upscale || 2}
        </Button>
        <small>
          {variants.upscale
            ? `Using ×${variants.upscale.scale}`
            : needs.upscale
              ? 'Needed for sharp output'
              : 'Not needed'}
        </small>
      </div>
      <div className="tool-row">
        <Button
          variant="secondary"
          disabled={disabled('extend') || (!needs.extend.wide && !needs.extend.tall)}
          onClick={tools.extend}
        >
          <Expand size={14} /> Extend background
        </Button>
        <small>
          {[variants.wide && 'wide ✓', variants.tall && 'tall ✓'].filter(Boolean).join(' · ') ||
            [describe(needs.extend.wide), describe(needs.extend.tall)]
              .filter(Boolean)
              .join(' · ') ||
            'Not needed'}
        </small>
      </div>
      {job && (
        <p role="status" className={job.error ? 'field-error' : ''}>
          {job.message}{' '}
          {job.loading && (
            <Button variant="plain" className="text-action" onClick={tools.cancel}>
              Cancel
            </Button>
          )}
        </p>
      )}
      <Checkbox
        label="Run image tools automatically after upload"
        checked={campaign.autoImageTools === true}
        onChange={(event) => changeCampaign({ autoImageTools: event.target.checked })}
      />
      <p>
        Results are new images; the original upload is never changed. CPU processing can take a
        minute or more.
        {campaign.autoArrange === false &&
          ' Auto arrange is off: use Arrange now to re-frame formats.'}
      </p>
    </div>
  );
}

export default function AutomationPanel() {
  const { campaign, setTreatment } = useWorkspace();
  return (
    <section className="automation-panel" aria-label="Automatic enhancements">
      <div className="subject-heading">
        <Wand2 size={16} />
        <strong>Automatic enhancements</strong>
      </div>
      <Checkbox
        label="Keep text readable"
        checked={campaign.autoReadability === true}
        onChange={(event) => setTreatment({ autoReadability: event.target.checked })}
      />
      <p>
        Adds a draft contrast treatment over busy photos. Designed glows are kept; review the final
        artwork at native size.
      </p>
      <TextHierarchy />
      <ColourSuggestions />
      <ImageTools />
    </section>
  );
}
