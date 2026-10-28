import { z } from 'zod';

/**
 * Per-market copy hierarchy used by automatic arrangement: the `larger` copy should render at
 * least `minRatio` times the size of the `smaller` copy. `sizes` holds exceptions per format.
 *
 * BANNER1 uses a measured rule: 320×480 shows the offer clearly larger than the headline
 * (about 1.3×), while 300×250, 300×600 and 160×600 show them at about the same size, so the
 * default only stops the offer from falling well below the headline.
 * Other markets have no rule until one is approved.
 */
export const DEFAULT_TEXT_HIERARCHY = {
  BANNER1: { larger: 'subtitle', smaller: 'headline', minRatio: 0.9, sizes: { '320x480': 1.25 } },
};

const ratio = z.number().min(0.5).max(3);
export const textHierarchySchema = z
  .object({
    larger: z.enum(['headline', 'subtitle']),
    smaller: z.enum(['headline', 'subtitle']),
    minRatio: ratio,
    sizes: z.record(z.string().regex(/^\d{2,4}x\d{2,4}$/), ratio).optional(),
  })
  .refine((rule) => rule.larger !== rule.smaller, 'A hierarchy compares two different copy roles.');

/** The ratio that applies to one format, or null when the market has no rule. */
export const hierarchyRatio = (rule, width, height) =>
  rule ? (rule.sizes?.[`${width}x${height}`] ?? rule.minRatio) : null;

export const COPY_ROLE_NAMES = { headline: 'Headline', subtitle: 'Offer' };
