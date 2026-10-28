import { layerSchema } from './schema.js';
import { activeVariants, effectiveBox, heroFor } from './hero-variants.js';
import { cropFor } from './render.js';

export const SUBJECT_LAYER_PREFIX = 'subject-cutout-';
const FRONT_OF = ['headline', 'subtitle', 'custom'];
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** The cut-out's rectangle in banner pixels for an unrotated photo frame. */
export function subjectRect(photo, resources) {
  if (!resources?.cutout || !resources.hero || photo.rotation) return null;
  const { image, frame } = heroFor(photo, resources);
  const [cx, cy, cw, ch] = cropFor(image, photo, resources.heroCrop);
  const box = effectiveBox(resources.cutout.box, frame);
  const w = image.naturalWidth || image.width,
    h = image.naturalHeight || image.height;
  const x = photo.x + (box.x * w - cx) * (photo.width / cw),
    y = photo.y + (box.y * h - cy) * (photo.height / ch);
  const rect = {
    x: Math.max(x, photo.x),
    y: Math.max(y, photo.y),
    width: 0,
    height: 0,
  };
  rect.width = Math.min(x + box.width * w * (photo.width / cw), photo.x + photo.width) - rect.x;
  rect.height = Math.min(y + box.height * h * (photo.height / ch), photo.y + photo.height) - rect.y;
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * Put the cut-out subject above headline/subtitle text that it overlaps, so copy reads as
 * passing behind the person. Previously inserted subject layers are replaced; logo, CTA and
 * legal stay on top. Layouts where no copy meets the subject are left unchanged.
 */
export function placeSubjectInFront(bp, campaign, resources) {
  const layers = bp.layers.filter((l) => !l.id.startsWith(SUBJECT_LAYER_PREFIX));
  let result = layers;
  if (campaign.subjectInFront && activeVariants(campaign).cutout && resources?.cutout) {
    result = [...layers];
    for (const photo of layers.filter(
      (l) => l.type === 'image' && l.source === 'hero' && l.visible,
    )) {
      const rect = subjectRect(photo, resources);
      if (!rect) continue;
      const start = result.indexOf(photo);
      let last = -1;
      result.forEach((layer, index) => {
        if (
          index > start &&
          layer.type === 'text' &&
          FRONT_OF.includes(layer.source) &&
          layer.visible &&
          overlaps(layer, rect)
        )
          last = index;
      });
      if (last < 0) continue;
      result.splice(
        last + 1,
        0,
        layerSchema.parse({
          id: `${SUBJECT_LAYER_PREFIX}${photo.id}`,
          name: 'Subject cut-out',
          type: 'cutout',
          source: 'hero',
          linkedLayerId: photo.id,
          x: photo.x,
          y: photo.y,
          width: photo.width,
          height: photo.height,
          rotation: photo.rotation,
          fontSize: 24,
          minFontSize: 10,
        }),
      );
    }
  }
  if (result === bp.layers) return bp;
  const ids = new Set(result.map((l) => l.id));
  return {
    ...bp,
    layers: result,
    scenes: bp.scenes.map((scene) => ({
      ...scene,
      tracks: Object.fromEntries(Object.entries(scene.tracks).filter(([id]) => ids.has(id))),
    })),
  };
}
