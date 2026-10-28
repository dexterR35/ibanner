import { z } from 'zod';
// Detection matching scores are not calibrated probabilities. Keep tentative
// matches selectable; do not label them as certain identifications.
export const SUBJECT_THRESHOLD = 0.06;

export const subjectBoxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((b) => b.x + b.width <= 1.000001 && b.y + b.height <= 1.000001);
export const subjectSchema = z.object({
  id: z.string().max(100),
  label: z.string().max(160),
  box: subjectBoxSchema,
  source: z.enum(['detected', 'manual']),
  score: z.number().min(0).max(1).optional(),
});
export const subjectSearchSchema = z.object({
  assetId: z.string().regex(/^[a-f0-9]{64}$/),
  query: z.string().min(1).max(160),
  results: z.array(subjectSchema).max(12),
  engine: z.enum(['browser', 'sam3', 'florence']).optional(),
  preference: z.enum(['auto', 'browser', 'sam3', 'florence']).optional(),
});
export const subjectFocusSchema = subjectSchema.extend({
  assetId: z.string().regex(/^[a-f0-9]{64}$/),
});
export const subjectQuery = (text = 'person') =>
  (typeof text === 'string' ? text.trim().slice(0, 160) : '') || 'person';
export function subjectLabels(query) {
  const labels = [
    ...new Set(
      subjectQuery(query)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, 5);
  if (labels.includes('person') && !labels.includes('human face')) labels.push('human face');
  return labels;
}
const intersection = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
export function normalizeDetections(raw) {
  const kept = [];
  for (const item of [...raw].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    if (
      (item.score != null &&
        (!Number.isFinite(item.score) || item.score < SUBJECT_THRESHOLD || item.score > 1)) ||
      !item.box ||
      typeof item.label !== 'string'
    )
      continue;
    const { xmin, ymin, xmax, ymax } = item.box;
    if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) continue;
    const x = Math.max(0, xmin),
      y = Math.max(0, ymin);
    const box = { x, y, width: Math.min(1, xmax) - x, height: Math.min(1, ymax) - y };
    if (!subjectBoxSchema.safeParse(box).success) continue;
    if (
      kept.some((other) => {
        const area = intersection(box, other.box);
        return (
          other.label === item.label &&
          area / (box.width * box.height + other.box.width * other.box.height - area) > 0.45
        );
      })
    )
      continue;
    kept.push({
      id: `subject-${kept.length}`,
      label: item.label.slice(0, 160),
      ...(item.score != null ? { score: item.score } : {}),
      box,
      source: 'detected',
    });
    if (kept.length === 12) break;
  }
  return kept;
}
export const preferredSubject = (results) =>
  results.find((r) => /face/i.test(r.label)) || results[0] || null;

/** A detected face may select its enclosing person; a manual box is authoritative. */
export function cutoutTarget(focus, detections = []) {
  if (!focus) return null;
  if (focus.source === 'manual') return { box: focus.box, label: null };
  const f = focus.box;
  const parents = /face/i.test(focus.label)
    ? detections
        .filter(
          (d) =>
            /person|human body/i.test(d.label) &&
            d.box.x <= f.x &&
            d.box.y <= f.y &&
            d.box.x + d.box.width >= f.x + f.width &&
            d.box.y + d.box.height >= f.y + f.height,
        )
        .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)
    : [];
  const selected = parents[0] || focus;
  return { box: selected.box, label: selected.label };
}
