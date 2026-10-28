import { z } from 'zod';
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const normalizedRect = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001);
export const analysisSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1).max(200),
    assetId: hashSchema,
    inputHash: hashSchema,
    component: z.enum(['subjects', 'ocr', 'visual', 'composition', 'florence']),
    status: z.enum(['unknown', 'ready', 'no_match', 'failed', 'unavailable']),
    profileId: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
    provenance: z.record(z.string(), z.json()),
    subjects: z
      .array(
        z
          .object({
            id: z.string(),
            label: z.string().max(160),
            box: normalizedRect,
            score: z.number().min(0).max(1).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    ocr: z
      .array(
        z
          .object({
            text: z.string().max(2000),
            box: normalizedRect,
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(500)
      .optional(),
    visual: z
      .object({
        palette: z.array(z.string().regex(/^#[a-f0-9]{6}$/i)).max(32),
        luminance: z.number().finite(),
        edgeVariance: z.number().finite(),
      })
      .strict()
      .optional(),
    message: z.string().max(2000).optional(),
  })
  .strict();
export const correctionSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
    rejectedTags: z.array(z.string().max(80)).max(50).default([]),
    focal: normalizedRect.nullable().default(null),
    ocrText: z.string().max(20000).default(''),
    protectedRegions: z.array(normalizedRect).max(20).default([]),
  })
  .strict();
