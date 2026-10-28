import { boundText } from './render.js';
import { uid } from '../data/defaults.js';
import { trackSchema } from './schema.js';

const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * Turn a static layout into GIF parts following the measured BANNER1 GIF sequence:
 * introduction (headline) → offer (subtitle) → call to action, with cuts between parts as in
 * that sequence (fades would multiply the sampled frames). Logo, background, photo and
 * legal copy stay visible throughout. The CTA joins every part when it has its own space;
 * otherwise it gets a final part. Durations use the measured BANNER1 timings (2000/2000/1800 ms).
 */
export function autoAnimate(bp, campaign = null) {
  // Without a campaign (blueprint diagrams) every text role counts as present.
  const has = (layer) =>
    layer.visible &&
    (!campaign || !['text', 'button'].includes(layer.type) || boundText(layer, campaign).trim());
  const role = (source, type) =>
    bp.layers.filter((l) => l.source === source && (!type || l.type === type) && has(l));
  const headline = role('headline', 'text'),
    subtitle = role('subtitle', 'text'),
    cta = role('cta', 'button'),
    photo = role('hero', 'image');
  const copy = [...headline, ...subtitle];
  const ctaShared = cta.length > 0 && !cta.some((c) => copy.some((t) => overlaps(c, t)));
  const photoWithCta = !photo.some((p) => cta.some((c) => overlaps(c, p)));

  // Normalized like saved tracks, so the editor draft equals what validation stores.
  const track = (visible) => trackSchema.parse({ visible });
  const show = (layers) => Object.fromEntries(layers.map((l) => [l.id, track(true)]));
  const hide = (layers) => Object.fromEntries(layers.map((l) => [l.id, track(false)]));
  const parts = [];
  if (headline.length)
    parts.push({
      name: 'Introduction',
      tracks: { ...show(headline), ...hide(subtitle), ...(ctaShared ? {} : hide(cta)) },
    });
  if (subtitle.length)
    parts.push({
      name: 'The offer',
      tracks: { ...show(subtitle), ...hide(headline), ...(ctaShared ? {} : hide(cta)) },
    });
  if (cta.length && (!ctaShared || !parts.length))
    parts.push({
      name: 'Call to action',
      tracks: { ...show(cta), ...hide(copy), ...(photoWithCta ? {} : hide(photo)) },
    });
  if (!parts.length) parts.push({ name: 'Part 1', tracks: {} });
  const durations = [2000, 2000, 1800].slice(-parts.length);
  return {
    ...bp,
    mode: 'animated',
    scenes: parts.map((part, index) => ({
      id: uid(),
      name: part.name,
      durationMs: durations[index],
      transitionMs: 0,
      tracks: part.tracks,
    })),
  };
}

/**
 * A single part where every layer simply shows (seed layouts store explicit visible tracks)
 * means the GIF has not been designed yet.
 */
export const needsAutoAnimation = (bp) =>
  bp.scenes.length === 1 &&
  Object.values(bp.scenes[0].tracks).every(
    (t) =>
      t.visible !== false &&
      !t.startMs &&
      t.endMs == null &&
      !t.fadeInMs &&
      !t.fadeOutMs &&
      !t.dx &&
      !t.dy,
  );
