import {
  activeRevision,
  createBlueprint,
  duplicateForSize,
  resolveBanner,
} from '../data/defaults.js';
import { validateBlueprint } from './schema.js';
import { arrangeBanner, layoutKey, layoutScore } from './auto-layout.js';
import { focusBlueprint } from './subject-position.js';
import { applyTree, blueprintToTree, treeElements } from './layout-tree.js';
import { currentPhotoAnalysis, photoFacts } from './photo-analysis.js';

/** The AI-chosen geometry for a banner, while it still matches the pinned revision. */
export const currentAiLayout = (banner) =>
  banner?.aiLayout && !banner.override && banner.aiLayout.versionId === banner.blueprintVersionId
    ? banner.aiLayout.blueprint
    : null;

/**
 * Hybrid AI arrangement for one market (Studio "Arrange now").
 *
 * For every banner the candidates are: the saved design, the nearest reference scaled to this
 * size, and the PosterO-style layouts Qwen3-VL proposes from the nearest references (each also
 * with the reference's photo frame, because the model places photos poorly). Every candidate is
 * finished by the same deterministic arrangement (text fit, subject crop) and scored with the
 * same checks; the lowest cost wins. A model that is missing or wrong can therefore never make a
 * banner worse than the saved design or the nearest reference.
 */

export const EXAMPLES_PER_TARGET = 4;
// Pull toward the market's references: a candidate far from the nearest reference pays for it.
const REFERENCE_PULL = 40;
// Reversing the reference's reading order (button above headline, logo below copy) is a defect.
const ORDER_WEIGHT = 150;

const shapeDistance = (a, width, height) =>
  Math.abs(Math.log(a.width / a.height / (width / height))) +
  0.25 * Math.abs(Math.log((a.width * a.height) / (width * height)));

/** Reference designs ordered nearest-first: the market's own, then every other market's. */
export function nearestReferences(project, marketId, width, height, limit = EXAMPLES_PER_TARGET) {
  const designs = (own) =>
    project.blueprints
      .filter((e) => e.measured && (own ? e.marketId === marketId : e.marketId !== marketId))
      .map((entry) => ({ entry, bp: activeRevision(entry).blueprint }))
      .sort((a, b) => shapeDistance(a.bp, width, height) - shapeDistance(b.bp, width, height));
  const own = designs(true);
  return (own.length ? own : designs(false)).slice(0, limit);
}

/**
 * A starting layout for a new size or market: the nearest reference design scaled to the size
 * (the market's own references first, otherwise every market's). Only when no reference
 * exists anywhere does the built-in proportional factory seed it.
 */
export function seedBlueprint(project, marketId, width, height) {
  const nearest = nearestReferences(project, marketId, width, height, 1)[0];
  const bp = nearest
    ? duplicateForSize(nearest.bp, marketId, width, height)
    : createBlueprint(marketId, width, height);
  // Stable part ids: the same project always seeds the same design, so Create snapshots of a
  // new size stay current until something real changes.
  bp.scenes = bp.scenes.map((scene, i) => ({ ...scene, id: `${bp.id}-part-${i + 1}` }));
  if (!nearest) return validateBlueprint(bp);
  delete bp.resourcePreset;
  // Whole native pixels, like every authored blueprint; local copy belongs to the source size.
  bp.layers = bp.layers.map((l) => ({
    ...l,
    x: Math.round(l.x),
    y: Math.round(l.y),
    width: Math.max(1, Math.round(l.width)),
    height: Math.max(1, Math.round(l.height)),
    ...(l.textOverride != null ? { textOverride: null } : {}),
  }));
  return validateBlueprint(bp);
}

const copyFacts = (bp, campaign) =>
  treeElements(bp, campaign)
    .filter((e) => e.chars)
    .map((e) => `${e.id.split('_')[0]} ${e.chars} chars`)
    .join(', ');

/**
 * One layout-service target: the base's movable elements and the reference designs (nearest
 * first) as in-context examples, nearest last so it sits closest to the question. Null when
 * the base has nothing to place besides the photo.
 */
export function layoutTarget({ id, base, references, campaign, facts = '' }) {
  const elements = treeElements(base, campaign);
  if (!elements.some((e) => e.role !== 'photo')) return null;
  return {
    id,
    width: base.width,
    height: base.height,
    description: `Copy: ${copyFacts(base, campaign)}. ${facts}`.trim(),
    elements: elements.map(({ layerId, role, ...element }) => element),
    examples: [...references].reverse().map((ref) => ({
      description: `${ref.width}x${ref.height} approved ${ref.marketId} banner. Copy: ${copyFacts(ref, campaign)}.`,
      svg: blueprintToTree(ref, campaign),
    })),
  };
}

/** Studio's request: every banner of the market without a manual edit. */
export function layoutRequest(project, marketId, { seed = 0, samples = 3 } = {}) {
  const campaign = project.campaigns[marketId];
  const facts = photoFacts(currentPhotoAnalysis(campaign));
  const targets = [];
  for (const entry of project.blueprints.filter((e) => e.marketId === marketId)) {
    const banner = project.banners[entry.id];
    if (banner.override) continue; // manual edits stay as edited
    const base = resolveBanner(entry, { ...banner, arrangement: null, aiLayout: null });
    const references = nearestReferences(project, marketId, base.width, base.height).map(
      (r) => r.bp,
    );
    const target = layoutTarget({ id: entry.id, base, references, campaign, facts });
    if (target) targets.push(target);
  }
  return { targets, samples, seed, temperature: 0.7 };
}

const boxesOf = (bp, elements = treeElements(bp)) =>
  Object.fromEntries(
    elements.map((e) => {
      const l = bp.layers.find((x) => x.id === e.layerId);
      return [e.id, { x: l.x, y: l.y, width: l.width, height: l.height }];
    }),
  );
const iou = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = w * h;
  return inter / Math.max(1e-9, a.width * a.height + b.width * b.height - inter);
};
/** Mean box overlap with a reference layout (1 = identical), over the shared element ids. */
export function referenceSimilarity(boxes, reference) {
  const ids = Object.keys(reference).filter((id) => boxes[id]);
  return ids.length
    ? ids.reduce((sum, id) => sum + iou(boxes[id], reference[id]), 0) / ids.length
    : 0;
}

/**
 * Pairs of elements whose reading order (top-to-bottom or left-to-right) is the reverse of the
 * nearest reference, e.g. the button above the headline when the reference puts it below.
 * Only clear separations count on both sides, so elements sharing a row or a GIF slot are free.
 */
export function readingOrderInversions(boxes, reference, width, height) {
  const ids = Object.keys(reference).filter((id) => boxes[id] && !id.startsWith('photo_'));
  const centre = (b) => [b.x + b.width / 2, b.y + b.height / 2];
  let inversions = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const [ra, rb, ca, cb] = [
        reference[ids[i]],
        reference[ids[j]],
        boxes[ids[i]],
        boxes[ids[j]],
      ].map(centre);
      for (const [axis, size] of [
        [1, height],
        [0, width],
      ]) {
        const want = rb[axis] - ra[axis],
          got = cb[axis] - ca[axis],
          clear = 0.08 * size;
        if (Math.abs(want) > clear && Math.abs(got) > clear && Math.sign(want) !== Math.sign(got)) {
          inversions++;
          break;
        }
      }
    }
  return inversions;
}

/**
 * Candidate geometries for one banner: the base design, the nearest reference scaled to its
 * size (unless the base is that reference), and every model proposal.
 */
export function candidateLayouts(base, reference, modelCandidates = []) {
  const elements = treeElements(base);
  const list = [{ source: 'design', blueprint: base }];
  let referenceBoxes = null;
  if (reference) {
    const scaled = duplicateForSize(reference, base.marketId, base.width, base.height);
    referenceBoxes = boxesOf(scaled);
    if (reference.id !== base.id) {
      // The photo frame and its fade belong together: take the reference's fade edge as well.
      const moved = applyTree(base, referenceBoxes, elements);
      const refPhoto = scaled.layers.find((l) => l.type === 'image' && l.source === 'hero');
      list.push({
        source: 'reference',
        blueprint: refPhoto
          ? {
              ...moved,
              layers: moved.layers.map((l) =>
                l.type === 'image' && l.source === 'hero'
                  ? {
                      ...l,
                      fade: refPhoto.fade,
                      fadeDirection: refPhoto.fadeDirection,
                      ...(refPhoto.fadeMesh
                        ? { fadeMesh: refPhoto.fadeMesh }
                        : { fadeMesh: undefined }),
                    }
                  : l,
              ),
            }
          : moved,
      });
    }
  }
  for (const candidate of modelCandidates) {
    if (!candidate?.boxes || !Object.keys(candidate.boxes).length) continue;
    list.push({ source: 'qwen', blueprint: applyTree(base, candidate.boxes, elements) });
    const photo =
      referenceBoxes && Object.keys(referenceBoxes).find((id) => id.startsWith('photo_'));
    if (photo && candidate.boxes[photo])
      list.push({
        source: 'qwen+reference-photo',
        blueprint: applyTree(
          base,
          { ...candidate.boxes, [photo]: referenceBoxes[photo] },
          elements,
        ),
      });
  }
  return { list, referenceBoxes };
}

/** Finish and score every candidate; return the cheapest. Deterministic. */
export function chooseLayout(candidates, campaign, resources, { context, referenceBoxes }) {
  let best = null;
  for (const candidate of candidates) {
    const arranged = arrangeBanner(candidate.blueprint, campaign, resources, { context });
    const scoped = resources;
    const focus = focusBlueprint(arranged, campaign, scoped).score;
    const boxes = boxesOf(arranged);
    const similarity = referenceBoxes ? referenceSimilarity(boxes, referenceBoxes) : 1;
    const inversions = referenceBoxes
      ? readingOrderInversions(boxes, referenceBoxes, arranged.width, arranged.height)
      : 0;
    const score =
      layoutScore(arranged, campaign, scoped, context, focus) +
      (1 - similarity) * REFERENCE_PULL +
      inversions * ORDER_WEIGHT;
    if (!best || score < best.score - 0.01) best = { ...candidate, arranged, score, similarity };
  }
  return best;
}

/**
 * Arrange every banner of one market with the hybrid pipeline. `request(op, payload)` is the
 * local AI service call; when it fails the result still uses design and reference candidates.
 * Returns the next project plus a per-banner summary.
 */
export async function aiArrangeMarket(
  project,
  marketId,
  resources,
  { request, context, signal } = {},
) {
  const campaign = project.campaigns[marketId];
  context ??= document.createElement('canvas').getContext('2d');
  if (campaign.keepBlueprintBoxes)
    throw new Error('Match blueprints keeps the saved boxes. Turn it off to arrange with AI.');
  const payload = layoutRequest(project, marketId, {
    seed: hashSeed(layoutKey(campaign) + marketId),
  });
  let response = null,
    modelError = null;
  if (payload.targets.length && request)
    try {
      response = await request('layout', payload, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      modelError = error.message;
    }
  const proposals = new Map((response?.targets || []).map((t) => [t.id, t.candidates]));
  const banners = { ...project.banners },
    summary = [],
    key = layoutKey(campaign),
    createdAt = new Date().toISOString();
  for (const entry of project.blueprints.filter((e) => e.marketId === marketId)) {
    const banner = banners[entry.id];
    if (banner.override) {
      summary.push({ id: entry.id, source: 'edited' });
      continue;
    }
    const base = resolveBanner(entry, { ...banner, arrangement: null, aiLayout: null });
    const reference = nearestReferences(project, marketId, base.width, base.height, 1)[0]?.bp;
    const { list, referenceBoxes } = candidateLayouts(base, reference, proposals.get(entry.id));
    const best = chooseLayout(list, campaign, resources, { context, referenceBoxes });
    banners[entry.id] = {
      ...banner,
      layoutKey: key,
      arrangement: best.arranged,
      aiLayout: {
        source: best.source,
        createdAt,
        versionId: banner.blueprintVersionId,
        blueprint: best.blueprint,
      },
    };
    summary.push({ id: entry.id, source: best.source, score: Math.round(best.score) });
  }
  return {
    project: { ...project, banners },
    summary,
    modelError,
    model: response ? { elapsedMs: response.elapsedMs, provenance: response.provenance } : null,
  };
}

/** Where Arrange now takes its examples from, for the canvas tooltips. */
export function referenceSummary(project, marketId) {
  const own = project.blueprints.filter((e) => e.marketId === marketId && e.measured).length;
  if (own) return `Examples: ${own} measured ${marketId} blueprint${own === 1 ? '' : 's'}`;
  const all = project.blueprints.filter((e) => e.measured).length;
  return all
    ? `No measured ${marketId} blueprints: examples come from ${all} in other markets (unverified)`
    : 'No measured blueprints: Arrange now compares the saved design with Qwen layouts only';
}

/** Stable 31-bit seed so the same content asks the model the same question. */
export function hashSeed(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) % 2 ** 31;
}

/** Create's frozen image evidence (Florence-2 subjects, PaddleOCR text) as prompt facts. */
export function analysisFacts(analysis) {
  if (!analysis) return '';
  const facts = [];
  const main = analysis.subjects?.find((s) => s.primary) || null;
  const box =
    main?.box || (analysis.focusSource !== 'whole-image-fallback' ? analysis.focus : null);
  if (box)
    facts.push(
      `Main subject${main?.label ? ` (${main.label})` : ''} covers x ${Math.round(box.x * 100)}-${Math.round((box.x + box.width) * 100)}% and y ${Math.round(box.y * 100)}-${Math.round((box.y + box.height) * 100)}% of the photo.`,
    );
  const labels = [...new Set((analysis.subjects || []).map((s) => s.label))].slice(0, 6);
  if (labels.length) facts.push(`Objects: ${labels.join(', ')}.`);
  const text = analysis.observations?.ocr?.ocr || analysis.observations?.florence?.ocr;
  if (text?.length) facts.push('The photo already contains printed text; keep copy off it.');
  return facts.join(' ');
}
