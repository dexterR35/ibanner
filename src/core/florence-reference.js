import { z } from 'zod';
import { blueprintFromTextLines } from './reference-text-layout.js';

const boxSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .refine((box) => box.x + box.width <= 1.001 && box.y + box.height <= 1.001);

export const florenceReferenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('florence2'),
    width: z.number().int().min(32).max(2048),
    height: z.number().int().min(32).max(2048),
    textRegions: z
      .array(
        z
          .object({
            text: z.string().min(1).max(200),
            box: boxSchema,
          })
          .strict(),
      )
      .max(128),
    objects: z
      .array(
        z
          .object({
            label: z.string().max(100),
            box: boxSchema,
          })
          .strict(),
      )
      .max(64),
    profileId: z.string().length(64),
    provenance: z
      .object({
        model: z.string(),
        revision: z.string().length(40),
        device: z.string(),
        coordinateSpace: z.literal('normalized-oriented-preview'),
        tasks: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

/**
 * Florence fallback for Blueprint import: its text boxes go through the same role
 * suggestions as PaddleOCR (campaign copy, size, length, position; colours when pixels
 * are supplied). OCR text only names layers; it is never copied into the Blueprint.
 */
export function blueprintFromFlorence(raw, { marketId, width, height, pixels, campaign }) {
  const result = florenceReferenceSchema.parse(raw);
  if (result.textRegions.length === 0)
    throw new Error('Florence found no text regions. No blueprint was created.');
  return blueprintFromTextLines({
    lines: result.textRegions,
    engine: 'florence2',
    marketId,
    width,
    height,
    pixels,
    campaign,
  }).blueprint;
}
