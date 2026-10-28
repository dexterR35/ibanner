import { z } from 'zod';

/**
 * Derived campaign-image variants. Originals are never changed: an upscale, background
 * extension or subject cut-out is a separate content-hashed asset bound to the campaign.
 * A variant applies only while it still derives from the current campaign image.
 */
const id = z.string().regex(/^[a-f0-9]{64}$/);
export const rectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((r) => r.x + r.width <= 1.0001 && r.y + r.height <= 1.0001, 'Box leaves the image.');

export const heroUpscaleSchema = z.object({
  assetId: id,
  sourceAssetId: id,
  scale: z.union([z.literal(2), z.literal(4)]),
  engine: z.string().max(60),
});
export const heroExtendSchema = z.object({
  assetId: id,
  sourceAssetId: id,
  // Where the input image sits inside the extended result, normalized to the result.
  frame: rectSchema,
  engine: z.string().max(60),
});
export const heroCutoutSchema = z.object({
  assetId: id,
  sourceAssetId: id,
  // Cut-out bounds in normalized original-image coordinates.
  box: rectSchema,
  label: z.string().max(160),
  engine: z.string().max(60),
});

const FULL = { x: 0, y: 0, width: 1, height: 1 };
// A frame this much wider/taller than the photo uses the extended variant.
const VARIANT_RATIO = 1.15;

export function activeVariants(campaign) {
  const hero = campaign.heroAssetId;
  if (!hero) return { upscale: null, wide: null, tall: null, cutout: null };
  const upscale = campaign.heroUpscale?.sourceAssetId === hero ? campaign.heroUpscale : null;
  const bases = [hero, upscale?.assetId];
  const extension = (variant) => (bases.includes(variant?.sourceAssetId) ? variant : null);
  return {
    upscale,
    wide: extension(campaign.heroExtendWide),
    tall: extension(campaign.heroExtendTall),
    cutout: campaign.heroCutout?.sourceAssetId === hero ? campaign.heroCutout : null,
  };
}

/** The photo drawn in a frame, and where the original sits inside it. */
export function heroFor(layer, resources) {
  const base = { image: resources?.hero, frame: FULL };
  if (!resources?.hero || !layer?.width || !layer?.height) return base;
  const aspect = layer.width / layer.height,
    source = resources.hero.width / resources.hero.height;
  if (resources.heroWide && aspect > source * VARIANT_RATIO) return resources.heroWide;
  if (resources.heroTall && aspect < source / VARIANT_RATIO) return resources.heroTall;
  return base;
}

/** Map a box in original-image coordinates into a (possibly extended) variant. */
export function effectiveBox(box, frame = FULL) {
  return {
    ...box,
    x: frame.x + box.x * frame.width,
    y: frame.y + box.y * frame.height,
    width: box.width * frame.width,
    height: box.height * frame.height,
  };
}

/**
 * Per-direction extension so wide/tall frames can show the whole photo height/width.
 * Returns normalized side padding relative to the source size, or null per direction.
 */
export function extensionFor(frames, width, height, { maxGrow = 1.5 } = {}) {
  const aspect = width / height;
  const wide = Math.max(...frames.map((f) => f.width / f.height), 0);
  const tall = Math.max(...frames.map((f) => f.height / f.width), 0);
  const extraX = wide > aspect * VARIANT_RATIO ? Math.min(maxGrow, (wide * height) / width - 1) : 0;
  const extraY =
    tall > (1 / aspect) * VARIANT_RATIO ? Math.min(maxGrow, (tall * width) / height - 1) : 0;
  return {
    wide: extraX >= 0.05 ? { left: extraX / 2, right: extraX / 2, top: 0, bottom: 0 } : null,
    tall: extraY >= 0.05 ? { left: 0, right: 0, top: extraY / 2, bottom: extraY / 2 } : null,
  };
}

/** Normalized placement of the input inside an extension result. */
export function extensionFrame(pads) {
  const w = 1 + pads.left + pads.right,
    h = 1 + pads.top + pads.bottom;
  return { x: pads.left / w, y: pads.top / h, width: 1 / w, height: 1 / h };
}

/** Smallest supported upscale that removes enlargement beyond source pixels, if any. */
export function upscaleFor(frames, width, height) {
  const need = Math.max(
    1,
    ...frames.map((f) => Math.max(f.width / width, f.height / height) * (f.zoom || 1)),
  );
  if (need <= 1.05) return null;
  return need <= 2 ? 2 : 4;
}
