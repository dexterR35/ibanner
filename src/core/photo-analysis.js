import { z } from 'zod';
import { imagePlacement } from './image-position.js';
import { fadeAlphaAt } from './image-fade.js';
import { hexToRgb, luminance } from './color.js';

/**
 * Saved OpenCV measurements of the campaign photo, used to keep copy off busy or
 * low-contrast areas. Computed once per photo binding (upload, upscale, extension, cut-out)
 * and stored on the campaign; arrangement only reads it. No pixels are stored.
 */

/** Identity of the rendered photo: any change to the binding needs a fresh analysis. */
export const photoAnalysisKey = (campaign) =>
  JSON.stringify([
    campaign.heroAssetId ?? null,
    null, // retired slot (bundled example pack); kept so saved analyses stay valid
    campaign.heroUpscale ?? null,
    campaign.heroExtendWide ?? null,
    campaign.heroExtendTall ?? null,
    campaign.heroCutout ?? null,
  ]);

const percentGrid = z.array(z.number().int().min(0).max(100));
const unit = z.number().finite().min(0).max(1);
const boxSchema = z.object({ x: unit, y: unit, width: unit, height: unit }).strict();
const gridOf = (extra = {}) =>
  z
    .object({
      cols: z.number().int().min(1).max(64),
      rows: z.number().int().min(1).max(64),
      ...extra,
    })
    .strict();
export const photoAnalysisSchema = z
  .object({
    key: z.string().max(2000),
    engine: z.literal('OpenCV.js'),
    width: z.number().int().min(1).max(40000),
    height: z.number().int().min(1).max(40000),
    cols: z.number().int().min(1).max(64),
    rows: z.number().int().min(1).max(64),
    luminance: percentGrid,
    detail: percentGrid,
    // BiRefNet foreground map: where the subject is (0-100 per cell).
    subject: gridOf({ values: percentGrid, box: boxSchema.nullable() }).optional(),
    // PaddleOCR lines already printed on the photo; copy should not cover them.
    text: z
      .array(z.object({ text: z.string().max(200), box: boxSchema }).strict())
      .max(60)
      .optional(),
    // Florence-2 object regions (labels are untrusted model text).
    objects: z
      .array(z.object({ label: z.string().max(100), box: boxSchema }).strict())
      .max(40)
      .optional(),
    engines: z.array(z.enum(['opencv', 'birefnet', 'paddleocr', 'florence2'])).max(4),
  })
  .strict()
  .refine(
    (a) =>
      a.luminance.length === a.cols * a.rows &&
      a.detail.length === a.cols * a.rows &&
      (!a.subject || a.subject.values.length === a.subject.cols * a.subject.rows),
    'Photo analysis grid size does not match its dimensions.',
  );

/** A fresh analysis for the campaign's current photo, or null. */
export const currentPhotoAnalysis = (campaign) =>
  campaign.photoAnalysis?.key === photoAnalysisKey(campaign) ? campaign.photoAnalysis : null;

/** Short facts about the photo for the layout model's prompt (no pixels). */
export function photoFacts(analysis) {
  if (!analysis) return '';
  const facts = [`Photo ${analysis.width}x${analysis.height}.`];
  const box = analysis.subject?.box;
  if (box)
    facts.push(
      `Its subject covers x ${Math.round(box.x * 100)}-${Math.round((box.x + box.width) * 100)}% and y ${Math.round(box.y * 100)}-${Math.round((box.y + box.height) * 100)}% of the photo.`,
    );
  if (analysis.objects?.length)
    facts.push(
      `Objects: ${[...new Set(analysis.objects.map((o) => o.label))].slice(0, 6).join(', ')}.`,
    );
  if (analysis.text?.length)
    facts.push('The photo already contains printed text; keep copy off it.');
  return facts.join(' ');
}

const area = (r) => Math.max(0, r.width) * Math.max(0, r.height);
const intersect = (a, b) => {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.min(a.x + a.width, b.x + b.width) - x,
    height: Math.min(a.y + a.height, b.y + b.height) - y,
  };
};

/**
 * Readability cost of one copy layer over the photo painted below it: 0 when it does not
 * cover visible photo, rising with photo detail and with brightness that fights the text
 * colour. Fades count: where the background covers the photo, the background is measured.
 */
export function photoReadability(
  bp,
  layer,
  campaign,
  resources,
  analysis,
  { subjectOnly = false } = {},
) {
  const image = resources?.hero;
  if (!image || !analysis) return 0;
  const index = bp.layers.indexOf(layer);
  const textLight = luminance(hexToRgb(layer.fill || '#ffffff')) > 0.4;
  const backgroundLum = luminance(hexToRgb(bp.background));
  const fades = campaign.imageFadeEnabled !== false;
  let cost = 0;
  for (const photo of bp.layers.slice(0, Math.max(0, index))) {
    if (photo.type !== 'image' || photo.source !== 'hero' || !photo.visible || photo.rotation)
      continue;
    const overlap = intersect(layer, photo);
    if (area(overlap) <= 0) continue;
    const { sx, sy, scale, travelX, travelY } = imagePlacement(image, photo, resources.heroCrop);
    let sum = 0,
      n = 0;
    for (let iy = 0; iy < 4; iy++)
      for (let ix = 0; ix < 6; ix++) {
        const px = overlap.x + ((ix + 0.5) / 6) * overlap.width,
          py = overlap.y + ((iy + 0.5) / 4) * overlap.height;
        const u = (px - photo.x) / photo.width,
          v = (py - photo.y) / photo.height;
        const cover = fades ? fadeAlphaAt(photo, u, v) : 0;
        const srcX = (px - photo.x + travelX * photo.focalX) / scale + sx,
          srcY = (py - photo.y + travelY * photo.focalY) / scale + sy;
        const col = Math.floor((srcX / analysis.width) * analysis.cols),
          row = Math.floor((srcY / analysis.height) * analysis.rows);
        if (col < 0 || row < 0 || col >= analysis.cols || row >= analysis.rows) continue;
        const cell = row * analysis.cols + col;
        const lum = cover * backgroundLum + (1 - cover) * (analysis.luminance[cell] / 100);
        const detail = (1 - cover) * (analysis.detail[cell] / 100);
        const u0 = srcX / analysis.width,
          v0 = srcY / analysis.height;
        // Covering the subject or text printed in the photo costs as much as unreadable copy.
        const subject = analysis.subject
          ? analysis.subject.values[
              Math.min(analysis.subject.rows - 1, Math.floor(v0 * analysis.subject.rows)) *
                analysis.subject.cols +
                Math.min(analysis.subject.cols - 1, Math.floor(u0 * analysis.subject.cols))
            ] / 100
          : 0;
        const printed = analysis.text?.some(
          ({ box }) =>
            u0 >= box.x && u0 <= box.x + box.width && v0 >= box.y && v0 <= box.y + box.height,
        )
          ? 1
          : 0;
        // Buttons carry their own fill: only covering the subject or printed text counts.
        sum +=
          (subjectOnly ? 0 : detail + (textLight ? lum : 1 - lum)) +
          (1 - cover) * (subject + printed);
        n++;
      }
    if (n) cost += (sum / n) * (area(overlap) / area(layer));
  }
  return cost;
}
