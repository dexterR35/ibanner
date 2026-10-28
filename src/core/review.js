import { contrastRatio, hexToRgb } from './color.js';
import { canvasOf, drawLayer, qualityReport, renderFrame } from './render.js';
import { heroFor, effectiveBox } from './hero-variants.js';
import { placedSubject } from './subject-position.js';
import { reserveLegalFooter } from './legal-footer.js';
import { layerAt, sceneAt, sceneStart } from './timeline.js';

const area = (r) => r.width * r.height;
const intersection = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const moving = (bp, layer) =>
  layer.rotation || bp.scenes.some((s) => s.tracks[layer.id]?.dx || s.tracks[layer.id]?.dy);

/** WCAG 2.x non-text contrast target for a control against what surrounds it. */
export const CTA_EDGE_TARGET = 3;

/**
 * Contrast of a button colour against the pixels in a thin ring just outside the button.
 * Returns the 25th percentile, so a busy patch along one edge still counts.
 */
export function edgeContrast(pixels, width, height, rect, fill, ring = 3) {
  const rgb = hexToRgb(fill),
    ratios = [];
  const x0 = Math.max(0, Math.floor(rect.x - ring)),
    y0 = Math.max(0, Math.floor(rect.y - ring)),
    x1 = Math.min(width, Math.ceil(rect.x + rect.width + ring)),
    y1 = Math.min(height, Math.ceil(rect.y + rect.height + ring));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const inside =
        x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      if (inside) continue;
      const i = (y * width + x) * 4;
      ratios.push(contrastRatio(rgb, [pixels[i], pixels[i + 1], pixels[i + 2]]));
    }
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.25)];
}

/** Buttons that sit over the campaign photo, with the worst edge contrast in any part. */
export function ctaBackdrop(bp, campaign, resources) {
  bp = reserveLegalFooter(bp);
  const photos = bp.layers.filter((l) => l.type === 'image' && l.source === 'hero' && l.visible);
  const results = [];
  bp.layers.forEach((layer, index) => {
    if (layer.type !== 'button' || !layer.visible || moving(bp, layer)) return;
    if (!photos.some((photo) => intersection(photo, layer) > 0)) return;
    let worst = null;
    bp.scenes.forEach((scene, sceneIndex) => {
      if (bp.mode === 'static' && sceneIndex > 0) return;
      const time = sceneStart(bp, sceneIndex) + Math.floor(scene.durationMs / 2);
      const { scene: current, local } = sceneAt(bp, time);
      const placed = layerAt(layer, current, local);
      if (!placed.visible || placed.opacity <= 0) return;
      // Everything painted before the button is its backdrop at this moment.
      const below = canvasOf(bp.width, bp.height);
      renderFrame(below, { ...bp, layers: bp.layers.slice(0, index) }, campaign, resources, time);
      const ratio = edgeContrast(
        below.getContext('2d').getImageData(0, 0, bp.width, bp.height).data,
        bp.width,
        bp.height,
        layer,
        layer.fill,
      );
      if (ratio != null && (worst == null || ratio < worst)) worst = ratio;
    });
    if (worst != null) results.push({ id: layer.id, name: layer.name, ratio: worst });
  });
  return results;
}

/**
 * Painted coverage above a photo, one alpha mask per part where the photo shows. Uses the
 * real glyph and logo pixels, so empty space inside a layer box does not count as covering.
 */
function coverMasks(bp, photo, campaign, resources) {
  const index = bp.layers.findIndex((l) => l.id === photo.id);
  // The photo's own cut-out repaints the subject; it never hides it.
  const above = bp.layers
    .slice(index + 1)
    .filter((l) => !(l.type === 'cutout' && l.linkedLayerId === photo.id));
  const canvas = canvasOf(bp.width, bp.height),
    context = canvas.getContext('2d'),
    masks = [];
  bp.scenes.forEach((scene, sceneIndex) => {
    if (bp.mode === 'static' && sceneIndex > 0) return;
    const time = sceneStart(bp, sceneIndex) + Math.floor(scene.durationMs / 2);
    const { scene: current, local } = sceneAt(bp, time);
    const placed = layerAt(photo, current, local);
    if (!placed.visible || placed.opacity <= 0) return;
    context.clearRect(0, 0, bp.width, bp.height);
    for (const layer of above)
      drawLayer(context, layerAt(layer, current, local), campaign, resources, bp);
    masks.push(context.getImageData(0, 0, bp.width, bp.height).data);
  });
  return masks;
}
function coveredFraction(masks, rect, width, height) {
  const x0 = Math.max(0, Math.floor(rect.x)),
    y0 = Math.max(0, Math.floor(rect.y)),
    x1 = Math.min(width, Math.ceil(rect.x + rect.width)),
    y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  const total = Math.max(1, (x1 - x0) * (y1 - y0));
  let worst = 0;
  for (const mask of masks) {
    let covered = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) if (mask[(y * width + x) * 4 + 3] > 127) covered++;
    worst = Math.max(worst, covered / total);
  }
  return worst;
}

/**
 * Detected faces that the photo frame cuts through or that copy, logo or CTA covers.
 * Uses the stored subject search for the current photo; no detection runs here.
 */
export function faceIssues(bp, campaign, resources) {
  const search = campaign.subjectSearch;
  if (!resources?.hero || !search || search.assetId !== campaign.heroAssetId) return [];
  const faces = search.results.filter((r) => /face|head/i.test(r.label));
  if (!faces.length) return [];
  bp = reserveLegalFooter(bp);

  const issues = [];
  for (const layer of bp.layers) {
    if (layer.type !== 'image' || layer.source !== 'hero' || !layer.visible) continue;
    if (moving(bp, layer)) continue;
    const { image, frame } = heroFor(layer, resources);
    let masks = null;
    for (const face of faces) {
      const rect = placedSubject(image, layer, effectiveBox(face.box, frame), resources.heroCrop);
      const size = area(rect);
      if (!size) continue;
      const inside = intersection(rect, layer) / size;
      // A face fully outside the frame is a deliberate crop (or a background person).
      if (inside > 0.12 && inside < 0.9) issues.push({ kind: 'cut', face, visible: inside });
      else if (inside >= 0.9) {
        masks ??= coverMasks(bp, layer, campaign, resources);
        const covered = coveredFraction(masks, rect, bp.width, bp.height);
        if (covered > 0.3) issues.push({ kind: 'covered', face, covered });
      }
    }
  }
  return issues;
}

/**
 * Full review for Studio, the editor and export: the shared quality report plus checks that
 * need rendered pixels or stored subject detections. Notes are advisory; nothing is changed.
 */
export function reviewReport(bp, campaign, resources, entry) {
  const issues = qualityReport(bp, campaign, resources, entry);
  if (!resources) return issues;
  for (const cta of ctaBackdrop(bp, campaign, resources))
    if (cta.ratio < CTA_EDGE_TARGET)
      issues.push({
        code: `cta-backdrop-${cta.id}`,
        message: `${cta.name}: blends into the photo behind it (edge contrast ${cta.ratio.toFixed(1)}:1, target ${CTA_EDGE_TARGET}:1). Move it off the busy area or change the CTA colour.`,
      });
  const faces = faceIssues(bp, campaign, resources);
  const cut = faces.find((f) => f.kind === 'cut'),
    covered = faces.find((f) => f.kind === 'covered');
  if (cut)
    issues.push({
      code: 'face-crop',
      message: `Photo crop cuts through a detected face (${Math.round(cut.visible * 100)}% visible). Adjust the photo focus or zoom.`,
    });
  if (covered)
    issues.push({
      code: 'face-covered',
      message: `Copy, logo or CTA covers ${Math.round(covered.covered * 100)}% of a detected face.`,
    });
  return issues;
}
