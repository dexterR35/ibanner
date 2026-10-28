import { boundText } from './render.js';
import { fitText } from './text-fit.js';
import { suggestTextLayout, textObstacles } from './text-layout.js';
import { focusBlueprint } from './subject-position.js';
import { reserveLegalFooter } from './legal-footer.js';
import { hierarchyRatio } from '../data/text-hierarchy.js';
import { photoReadability, currentPhotoAnalysis } from './photo-analysis.js';

// Rendered text settles slightly taller than its measured rows; leftover space stays as air.
const SETTLE_HEADROOM = 1.12;
// How strongly busy or low-contrast photo areas behind copy count against a candidate.
const PHOTO_WEIGHT = 60;

/** Only content that changes composition invalidates a campaign's arranged snapshots. */
export const layoutKey = (campaign) =>
  JSON.stringify([
    campaign.headline,
    campaign.subtitle,
    campaign.cta,
    campaign.legal,
    campaign.heroAssetId,
    campaign.logoAssetId,
    campaign.fontAssetId,
    ...(campaign.heroUpscale ||
    campaign.heroCutout ||
    campaign.heroExtendWide ||
    campaign.heroExtendTall ||
    campaign.ctaColor ||
    campaign.subjectInFront ||
    campaign.autoReadability
      ? [
          campaign.heroUpscale,
          campaign.heroCutout,
          campaign.heroExtendWide,
          campaign.heroExtendTall,
          campaign.ctaColor,
          campaign.subjectInFront,
          campaign.autoReadability,
        ]
      : []),
    ...(campaign.typography === 'outfit' ? ['outfit-800-600-400'] : []),
    ...(campaign.subjectFocus ? [campaign.subjectFocus] : []),
    ...(campaign.keepBlueprintBoxes ? ['fixed-blueprint-boxes'] : []),
    ...(campaign.textHierarchy ? [campaign.textHierarchy] : []),
    // A finished photo analysis re-arranges once; projects without one keep their key.
    ...(campaign.photoAnalysis
      ? [`photo:${campaign.photoAnalysis.key}:${campaign.photoAnalysis.engines.join(',')}`]
      : []),
    ...(campaign.copyFits && Object.keys(campaign.copyFits).length ? [campaign.copyFits] : []),
  ]);

/**
 * Shorter copy approved for one size (campaign.copyFits, shared with Create) becomes that
 * banner's local text for the derived snapshot. Explicit local edits and legal copy win.
 */
export function applyCopyFits(bp, campaign) {
  const fits = campaign.copyFits?.[`${bp.width}x${bp.height}`];
  if (!fits) return bp;
  let changed = false;
  const layers = bp.layers.map((l) => {
    if (l.textOverride != null || !['text', 'button'].includes(l.type) || fits[l.source] == null)
      return l;
    if (l.sourcePart && l.sourcePart !== 'all') return l;
    changed = true;
    return { ...l, textOverride: fits[l.source] };
  });
  return changed ? { ...bp, layers } : bp;
}

const overlap = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const stationary = (bp, layer) =>
  !layer.rotation &&
  !bp.scenes.some((scene) => scene.tracks[layer.id]?.dx || scene.tracks[layer.id]?.dy);
const together = (bp, a, b) => textObstacles({ ...bp, layers: [a, b] }, a).length > 0;

/**
 * Reflow co-visible copy into the free space around logo, photo and CTA.
 * `wide` lets copy use the whole free width (minus a proportional side margin); otherwise
 * each box keeps its designed horizontal extent so headline/offer hierarchy survives.
 * Boxes are sized from the designed font size, not stretched to fill every free pixel.
 */
function arrangeText(bp, campaign, resources, context, preserveFlow, wide = false) {
  const texts = bp.layers.filter(
    (layer) =>
      layer.type === 'text' && layer.source !== 'legal' && layer.visible && stationary(bp, layer),
  );
  const textIds = new Set(texts.map((layer) => layer.id));
  const candidates = texts
    .filter((layer) => boundText(layer, campaign).trim() || layer.sourcePart === 'remaining-lines')
    .map((layer) => {
      const space = suggestTextLayout(
        {
          ...bp,
          layers: bp.layers.map((other) =>
            textIds.has(other.id) && other.id !== layer.id ? { ...other, visible: false } : other,
          ),
        },
        layer.id,
      ).patch;
      if (!space) return null;
      return { layer, space };
    })
    .filter(Boolean);
  // Text visible in separate GIF parts can share the same area. Co-visible copy gets rows.
  const groups = [];
  for (const candidate of candidates) {
    const matching = groups.filter((group) =>
      group.some(
        (other) =>
          overlap(candidate.space, other.space) && together(bp, candidate.layer, other.layer),
      ),
    );
    if (!matching.length) groups.push([candidate]);
    else {
      const merged = [candidate, ...matching.flat()];
      matching.forEach((group) => groups.splice(groups.indexOf(group), 1));
      groups.push(merged);
    }
  }
  const patches = new Map();
  const sideRoom = Math.round(bp.width * 0.9);
  const gap = bp.height <= 100 ? 3 : 6;
  for (const group of groups) {
    group.sort((a, b) => a.layer.y - b.layer.y || a.layer.x - b.layer.x);
    const sx = Math.max(...group.map(({ space }) => space.x));
    const y = Math.max(...group.map(({ space }) => space.y));
    const spaceWidth = Math.min(...group.map(({ space }) => space.x + space.width)) - sx;
    const height = Math.min(...group.map(({ space }) => space.y + space.height)) - y;
    const available = height - gap * (group.length - 1);
    if (
      spaceWidth < 20 ||
      available < group.reduce((sum, { layer }) => sum + layer.minFontSize * layer.lineHeight, 0)
    )
      continue;
    // Wide copy keeps a proportional side margin instead of running edge to edge.
    const width = Math.min(spaceWidth, sideRoom);
    const aligned = (side) => group.every(({ layer }) => layer.align === side);
    const x =
      width === spaceWidth || aligned('left')
        ? sx
        : aligned('right')
          ? sx + spaceWidth - width
          : Math.round(sx + (spaceWidth - width) / 2);
    const extent = (layer) => {
      if (wide) return { x, width };
      const left = Math.max(sx, layer.x),
        right = Math.min(sx + spaceWidth, layer.x + layer.width);
      return right - left >= Math.max(20, layer.minFontSize * 2)
        ? { x: left, width: right - left }
        : { x, width };
    };
    const measured = group.map(({ layer }) => {
      const textFlow =
        preserveFlow || layer.textOverride != null || layer.textFlow === 'single-line'
          ? layer.textFlow
          : 'auto';
      const box = extent(layer);
      const next = { ...layer, ...box, height: bp.height, textFlow };
      // Largest size up to the designed one that fits this width.
      const fitted = fitText(context, boundText(layer, campaign), next, resources, { grow: false });
      const rows = Math.max(1, fitted.lines.length);
      return {
        layer: next,
        wanted: Math.max(
          layer.minFontSize * layer.lineHeight,
          rows * fitted.size * layer.lineHeight,
        ),
      };
    });
    const wanted = measured.reduce((sum, item) => sum + item.wanted, 0);
    // A little headroom lets the renderer settle; leftover space stays as breathing room.
    const ideal = measured.map((item) => Math.ceil(item.wanted * SETTLE_HEADROOM));
    const idealTotal = ideal.reduce((sum, value) => sum + value, 0);
    const roomy = idealTotal <= available;
    const used = roomy ? idealTotal + gap * (group.length - 1) : height;
    const designTop = Math.min(...group.map(({ layer }) => layer.y));
    const designBottom = Math.max(...group.map(({ layer }) => layer.y + layer.height));
    const centre = (designTop + designBottom) / 2;
    let top = roomy ? Math.round(Math.min(y + height - used, Math.max(y, centre - used / 2))) : y;
    measured.forEach(({ layer }, index) => {
      const boxHeight = roomy
        ? ideal[index]
        : index === measured.length - 1
          ? y + height - top
          : Math.floor((available * measured[index].wanted) / wanted);
      patches.set(layer.id, {
        ...layer,
        y: top,
        height: boxHeight,
        verticalAlign: preserveFlow ? layer.verticalAlign : 'middle',
      });
      top += boxHeight + gap;
    });
  }
  return { ...bp, layers: bp.layers.map((layer) => patches.get(layer.id) || layer) };
}

function photoVariant(bp, photo, factor) {
  if (!photo || factor === 1) return bp;
  const next = { ...photo };
  if (photo.fadeDirection === 'left' && Math.abs(photo.x + photo.width - bp.width) <= 8) {
    next.width = Math.min(bp.width * 0.55, Math.max(24, photo.width * factor));
    next.x = photo.x + photo.width - next.width;
  } else if (photo.fadeDirection === 'right' && photo.x <= 8) {
    next.width = Math.min(bp.width * 0.55, Math.max(24, photo.width * factor));
  } else if (photo.fadeDirection === 'top' && photo.y > bp.height * 0.2) {
    next.height = Math.min(bp.height * 0.7, Math.max(24, photo.height * factor));
    next.y = Math.max(0, photo.y + photo.height - next.height);
  } else if (photo.fadeDirection === 'bottom' && photo.y <= 8) {
    next.height = Math.min(bp.height * 0.7, Math.max(24, photo.height * factor));
  }
  return { ...bp, layers: bp.layers.map((layer) => (layer.id === photo.id ? next : layer)) };
}

const arrangeable = (bp, layer, campaign) =>
  layer.type === 'text' &&
  layer.source !== 'legal' &&
  layer.visible &&
  stationary(bp, layer) &&
  boundText(layer, campaign).trim();

/**
 * Text cost of one candidate; lower is better. Copy below its minimum size or colliding with
 * co-visible layers dominates, then copy that shrank or ballooned away from its designed size
 * (arrangement never changes `fontSize`, so it remains the designed size).
 */
function textCost(candidate, campaign, resources, context) {
  let cost = 0;
  const analysis = currentPhotoAnalysis(campaign);
  for (const layer of candidate.layers) {
    if (!arrangeable(candidate, layer, campaign)) continue;
    const fitted = fitText(context, boundText(layer, campaign), layer, resources);
    if (fitted.size < layer.minFontSize - 0.01)
      cost += 400 + (layer.minFontSize - fitted.size) * 80;
    const ratio = fitted.size / layer.fontSize;
    cost += Math.max(0, 1 - ratio) * 120 + Math.max(0, ratio - 1.3) * 60;
    if (textObstacles(candidate, layer).some((box) => overlap(insetBox(layer), box))) cost += 3000;
    // OpenCV photo grid: copy over busy or low-contrast visible photo reads worse.
    if (analysis)
      cost += photoReadability(candidate, layer, campaign, resources, analysis) * PHOTO_WEIGHT;
  }
  return cost;
}
const insetBox = (r) => ({ x: r.x + 0.5, y: r.y + 0.5, width: r.width - 1, height: r.height - 1 });

/**
 * Comparable cost of a finished candidate (lower is better), used to choose between the saved
 * design, the nearest reference and model-proposed layouts. Copy readability and fit
 * (textCost), subject obstruction (focus score), and collisions between logo, button and legal
 * boxes shown together. Text-vs-text collisions are already inside textCost.
 */
export function layoutScore(candidate, campaign, resources, context, focusScore = 0) {
  let cost = textCost(candidate, campaign, resources, context) + focusScore;
  const fixed = candidate.layers.filter(
    (l) => l.visible && !l.rotation && ['logo', 'button'].includes(l.type),
  );
  const legal = candidate.layers.filter((l) => l.visible && l.source === 'legal');
  const boxes = [...fixed, ...legal];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (overlap(insetBox(boxes[i]), boxes[j]) && together(candidate, boxes[i], boxes[j]))
        cost += 3000;
  // Buttons and the logo must not cover the photo's subject or text printed in it.
  const analysis = currentPhotoAnalysis(campaign);
  if (analysis)
    for (const layer of fixed)
      cost +=
        photoReadability(candidate, layer, campaign, resources, analysis, { subjectOnly: true }) *
        PHOTO_WEIGHT;
  return cost;
}

/**
 * Keep the market's copy hierarchy: when the `smaller` copy renders too close to (or above)
 * the `larger` copy, its box height is reduced around the same centre so the shared renderer
 * fits it at the capped size. Font sizes and the `larger` copy are never changed.
 */
export function applyTextHierarchy(bp, campaign, resources, context) {
  const rule = campaign.textHierarchy,
    ratio = hierarchyRatio(rule, bp.width, bp.height);
  if (!ratio) return bp;
  const fitted = (source) =>
    bp.layers
      .filter((layer) => layer.source === source && arrangeable(bp, layer, campaign))
      .map((layer) => ({
        layer,
        fit: fitText(context, boundText(layer, campaign), layer, resources),
      }));
  const larger = fitted(rule.larger),
    smaller = fitted(rule.smaller);
  if (!larger.length || !smaller.length) return bp;
  const cap = Math.max(...larger.map(({ fit }) => fit.size)) / ratio;
  const patches = new Map();
  for (const { layer, fit } of smaller) {
    const target = Math.max(layer.minFontSize, cap);
    if (fit.size <= target + 0.25) continue;
    // Rows at the capped size; a box exactly that tall cannot fit anything larger.
    const capped = fitText(
      context,
      boundText(layer, campaign),
      { ...layer, fontSize: target, height: bp.height * 4 },
      resources,
      { grow: false },
    );
    if (capped.overflow) continue;
    const height = Math.ceil(capped.lines.length * capped.size * layer.lineHeight + 0.5);
    if (height >= layer.height) continue;
    const shift =
      layer.verticalAlign === 'top'
        ? 0
        : layer.verticalAlign === 'bottom'
          ? layer.height - height
          : (layer.height - height) / 2;
    patches.set(layer.id, { ...layer, y: Math.round(layer.y + shift), height });
  }
  if (!patches.size) return bp;
  return { ...bp, layers: bp.layers.map((layer) => patches.get(layer.id) || layer) };
}

/**
 * Deterministic content layout; retains market orientation, logo/legal, crop focus and timing.
 * The saved design wins whenever the campaign copy reads well in it. Copy is reflowed (and,
 * only as a last resort, the photo frame resized) when the design cannot hold the copy.
 */
export function arrangeBanner(
  bp,
  campaign,
  resources,
  {
    context = document.createElement('canvas').getContext('2d'),
    preserveFlow = false,
    resizeImage = true,
  } = {},
) {
  if (bp.layers.some((l) => l.fitPolicy === 'strict-v1')) return bp;
  bp = applyCopyFits(reserveLegalFooter(bp), campaign);

  // Text fitting happens inside each saved box in the shared renderer. Subject focus
  // can still pan/zoom the photograph without moving its frame or the text layers.
  if (campaign.keepBlueprintBoxes) return focusBlueprint(bp, campaign, resources).blueprint;
  const photo = bp.layers.find(
    (layer) =>
      layer.type === 'image' && layer.source === 'hero' && layer.visible && stationary(bp, layer),
  );
  const options = [{ factor: 1, reflow: false }];
  for (const wide of [false, true])
    for (const factor of photo && resizeImage ? [1, 0.85, 0.7] : [1])
      options.push({ factor, wide, reflow: true });
  if (photo && resizeImage) options.push({ factor: 1.15, wide: false, reflow: true });
  let best = bp,
    bestScore = Infinity;
  for (const { factor, wide, reflow } of options) {
    const arranged = reflow
      ? arrangeText(
          reserveLegalFooter(photoVariant(bp, photo, factor)),
          campaign,
          resources,
          context,
          preserveFlow,
          wide,
        )
      : bp;
    const focused = focusBlueprint(arranged, campaign, resources);
    const candidate = focused.blueprint;
    let score =
      Math.abs(Math.log(factor)) * 45 +
      (reflow ? (wide ? 10 : 4) : 0) +
      focused.score +
      textCost(candidate, campaign, resources, context);
    if (photo && resources.hero) {
      const frame = candidate.layers.find((layer) => layer.id === photo.id);
      const [w, h] = resources.heroCrop?.slice(2) || [resources.hero.width, resources.hero.height];
      if (w && h) score += Math.abs(Math.log(frame.width / frame.height / (w / h))) * 6;
    }
    if (score < bestScore - 0.01) {
      bestScore = score;
      best = candidate;
    }
  }
  return applyTextHierarchy(best, campaign, resources, context);
}

/** What automation did to one format, for Studio badges. Pure geometry comparison. */
export function arrangementSummary(design, arranged) {
  if (!arranged || arranged === design) return { kind: 'design', label: 'Design kept' };
  // The legal footer reservation is part of every resolved design, not an automatic change.
  const before = new Map(reserveLegalFooter(design).layers.map((layer) => [layer.id, layer]));
  const moved = (layer) => {
    const old = before.get(layer.id);
    return (
      old &&
      ['x', 'y', 'width', 'height'].some(
        (key) => Math.abs((old[key] || 0) - (layer[key] || 0)) > 0.5,
      )
    );
  };
  const photo = arranged.layers.some((layer) => layer.type === 'image' && moved(layer));
  const copy = arranged.layers.some((layer) => layer.type === 'text' && moved(layer));
  if (photo) return { kind: 'photo', label: 'Photo resized' };
  if (copy) return { kind: 'reflow', label: 'Copy reflowed' };
  return { kind: 'design', label: 'Design kept' };
}
