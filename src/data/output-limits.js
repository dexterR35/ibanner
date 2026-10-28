import { z } from 'zod';

/**
 * File-size targets for exported banners. These are configurable review targets, not
 * authoritative platform rules: confirm each ad platform's current specification.
 */
export const OUTPUT_LIMIT_PRESETS = [
  { id: 'none', name: 'No limit', maxKB: null },
  { id: 'display-150', name: 'Display ads · 150 KB', maxKB: 150 },
  { id: 'display-200', name: 'Display ads · 200 KB', maxKB: 200 },
  { id: 'custom', name: 'Custom limit', maxKB: 150 },
];

export const outputLimitSchema = z.object({
  preset: z.enum(OUTPUT_LIMIT_PRESETS.map((p) => p.id)),
  maxKB: z.number().int().min(10).max(5000).nullable(),
});

export const limitBytes = (limit) =>
  limit && limit.preset !== 'none' && limit.maxKB ? limit.maxKB * 1024 : null;
