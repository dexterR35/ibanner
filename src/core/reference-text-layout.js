import { z } from 'zod';
import { validateBlueprint } from './schema.js';

/**
 * Suggested Blueprint layers from text read in a finished banner.
 *
 * Signals, strongest first: the market's own campaign copy (headline, subtitle, CTA,
 * legal), a solid button behind the text, then size, length, colour and position.
 * Every role is a suggestion with a stated reason. The OCR text only names layers;
 * it is never copied into the Blueprint, so campaign copy stays the source of truth.
 */

const boxSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
  .refine((box) => box.x + box.width <= 1.001 && box.y + box.height <= 1.001);

export const ocrResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    engine: z.literal('rapidocr'),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    lines: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            confidence: z.number().min(0).max(1),
            box: boxSchema,
          })
          .strict(),
      )
      .max(300),
    profileId: z.string().length(64),
    provenance: z.record(z.string(), z.json()),
  })
  .strict();

/**
 * Font size per pixel of detected line height. PP-OCRv6 boxes measured about 1.45x the
 * em size across Arial, Arial Bold and Impact (sizes 10-60 px). Florence is uncalibrated
 * and keeps its previous 1:1 estimate.
 */
export const FONT_SCALE = { rapidocr: 0.7, florence2: 1 };

const ROLE_LABELS = {
  logo: 'Logo',
  headline: 'Headline',
  'headline-support': 'Supporting headline',
  subtitle: 'Offer / subtitle',
  cta: 'Call to action',
  legal: 'Market legal',
  custom: 'Unassigned text',
};

// ---------- colour sampling (works on any { width, height, data } RGBA buffer) ----------

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const medianColor = (colors) => [0, 1, 2].map((i) => median(colors.map((c) => c[i])));
const toHex = (c) =>
  `#${c
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

function pixelAt(pixels, x, y) {
  const i =
    (Math.max(0, Math.min(pixels.height - 1, y)) * pixels.width +
      Math.max(0, Math.min(pixels.width - 1, x))) *
    4;
  return [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
}
/** Pixels of `outer` minus `inner`, thinned to at most ~`limit` samples. */
function sampleRect(pixels, outer, inner = null, limit = 3000) {
  const x0 = Math.max(0, Math.floor(outer.x)),
    y0 = Math.max(0, Math.floor(outer.y)),
    x1 = Math.min(pixels.width, Math.ceil(outer.x + outer.width)),
    y1 = Math.min(pixels.height, Math.ceil(outer.y + outer.height));
  const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / limit)));
  const out = [];
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      if (
        inner &&
        x >= inner.x &&
        x < inner.x + inner.width &&
        y >= inner.y &&
        y < inner.y + inner.height
      )
        continue;
      out.push(pixelAt(pixels, x, y));
    }
  return out;
}

/** Median colour of the image's outer frame: the banner's page background. */
export function pageColor(pixels) {
  const frame = [];
  const step = Math.max(1, Math.round((pixels.width + pixels.height) / 400));
  for (let x = 0; x < pixels.width; x += step)
    frame.push(pixelAt(pixels, x, 0), pixelAt(pixels, x, pixels.height - 1));
  for (let y = 0; y < pixels.height; y += step)
    frame.push(pixelAt(pixels, 0, y), pixelAt(pixels, pixels.width - 1, y));
  return medianColor(frame);
}

/** Follow a uniform fill outward from the text to the edges of its button. */
function buttonBounds(pixels, box, fill) {
  const same = (x, y) => dist(pixelAt(pixels, x, y), fill) < 60;
  const cy = Math.round(box.y + box.height / 2),
    cx = Math.round(box.x + box.width / 2);
  let left = Math.floor(box.x),
    right = Math.ceil(box.x + box.width),
    top = Math.floor(box.y),
    bottom = Math.ceil(box.y + box.height);
  while (left > 0 && same(left - 1, cy)) left--;
  while (right < pixels.width - 1 && same(right + 1, cy)) right++;
  // Columns just inside the text edges avoid glyph pixels along the centre line.
  const probe = [Math.round(box.x + 2), cx, Math.round(box.x + box.width - 2)];
  while (top > 0 && probe.some((x) => same(x, top - 1))) top--;
  while (bottom < pixels.height - 1 && probe.some((x) => same(x, bottom + 1))) bottom++;
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Text colour, surrounding colour and whether a solid button sits behind each line. */
export function sampleLineColors(pixels, lines) {
  const page = pageColor(pixels);
  return lines.map((line) => {
    const h = line.height,
      ring = {
        x: line.x - Math.max(2, h * 0.5),
        y: line.y - Math.max(2, h * 0.3),
        width: line.width + Math.max(4, h),
        height: line.height + Math.max(4, h * 0.6),
      };
    const around = sampleRect(pixels, ring, line);
    if (!around.length) return line;
    const back = medianColor(around);
    const spread = around.reduce((s, c) => s + dist(c, back), 0) / around.length;
    const inner = sampleRect(pixels, line).sort((a, b) => dist(b, back) - dist(a, back));
    const ink = medianColor(inner.slice(0, Math.max(1, Math.floor(inner.length / 7))));
    // Measured: buttons differ from the page by ~220; glows and photos stay under ~65.
    const button = dist(back, page) > 120 && spread < 40 && dist(ink, back) > 60;
    return {
      ...line,
      ink,
      back,
      button,
      ...(button ? { buttonBox: buttonBounds(pixels, line, back) } : {}),
    };
  });
}

// ---------- copy matching ----------

// Matching only: accents are folded because OCR often misreads them (ö as õ, ä as ā).
const normalize = (s) =>
  String(s || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
// A lone letter is usually a misread separator ("|" as "I"); lone digits stay.
const tokens = (s) =>
  normalize(s)
    .split(' ')
    .filter((t) => t && (t.length > 1 || /\p{N}/u.test(t)));
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function similar(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  const x = bigrams(a),
    y = bigrams(b);
  let shared = 0;
  for (const g of x) if (y.has(g)) shared++;
  return (2 * shared) / (x.size + y.size) >= 0.75;
}
/**
 * Role whose campaign copy covers the line, or null: at least 60% of its words, or (for
 * 8+ letters, where OCR may drop spaces or misread "|") 85% of its letter pairs.
 */
export function matchCopyRole(text, copy) {
  const words = tokens(text),
    compact = words.join('');
  if (!words.length) return null;
  let best = null;
  for (const [role, value] of Object.entries(copy)) {
    const roleWords = tokens(value);
    if (!roleWords.length) continue;
    const wordScore =
      words.filter((w) => roleWords.some((r) => similar(w, r))).length / words.length;
    let pairScore = 0;
    if (compact.length >= 8) {
      const own = bigrams(compact),
        theirs = bigrams(roleWords.join(''));
      pairScore = [...own].filter((g) => theirs.has(g)).length / own.size;
    }
    const score = Math.max(wordScore >= 0.6 ? wordScore : 0, pairScore >= 0.85 ? pairScore : 0);
    if (score && (!best || score > best.score)) best = { role, score };
  }
  return best?.role || null;
}

// ---------- grouping and roles ----------

function joinable(a, b, width) {
  const h = Math.min(a.height, b.height),
    ratio = b.height / a.height,
    gap = b.y - (a.y + a.height);
  if (ratio < 0.75 || ratio > 1.34 || gap > h * 0.5 || gap < -h * 0.5) return false;
  if (a.copyRole !== b.copyRole || Boolean(a.button) !== Boolean(b.button)) return false;
  if (a.ink && b.ink && dist(a.ink, b.ink) > 40) return false;
  const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  return (
    overlap >= 0.4 * Math.min(a.width, b.width) ||
    Math.abs(a.x + a.width / 2 - (b.x + b.width / 2)) <= 0.12 * width ||
    Math.abs(a.x - b.x) <= 0.04 * width
  );
}
function blockOf(lines) {
  const x = Math.min(...lines.map((l) => l.x)),
    y = Math.min(...lines.map((l) => l.y)),
    right = Math.max(...lines.map((l) => l.x + l.width)),
    bottom = Math.max(...lines.map((l) => l.y + l.height));
  const text = lines.map((l) => l.text).join(' ');
  return {
    lines,
    x,
    y,
    width: right - x,
    height: bottom - y,
    lineHeight: median(lines.map((l) => l.height)),
    text,
    words: tokens(text).length,
    chars: normalize(text).replace(/ /g, '').length,
    copyRole: lines[0].copyRole,
    button: Boolean(lines[0].button),
    ink: lines[0].ink,
  };
}
export function groupTextLines(lines, width) {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x),
    groups = [];
  for (const line of sorted) {
    const group = groups.findLast((g) => joinable(g.at(-1), line, width));
    if (group) group.push(line);
    else groups.push([line]);
  }
  return groups.map(blockOf).sort((a, b) => a.y - b.y || a.x - b.x);
}

const LEGAL_MARK = /\d+\s*\+|[|©®]|\b[a-z]{2,4}\/[a-z0-9]+\//i;

function assignRoles(blocks, { height, hasCopy }) {
  const free = () => blocks.filter((b) => !b.role);
  const set = (block, role, reason) => Object.assign(block, { role, reason });
  // 1. Campaign copy is the strongest evidence.
  for (const b of blocks) if (b.copyRole) set(b, b.copyRole, 'matches campaign copy');
  const taken = (role) => blocks.some((b) => b.role === role);
  const maxText = Math.max(...blocks.map((b) => b.lineHeight));
  // 2. A solid button behind short text is the CTA.
  if (!taken('cta')) {
    const button = free().find((b) => b.button && b.words <= 4);
    if (button) set(button, 'cta', 'text on a solid button');
  }
  // 3. Small text at the bottom, or text with age/licence marks, is legal.
  // Several small lines (age mark, licence) form one legal layer.
  free()
    .filter(
      (b) =>
        b.lineHeight <= 0.6 * maxText &&
        (b.y + b.height >= 0.75 * height || b.chars >= 25 || LEGAL_MARK.test(b.text)),
    )
    .forEach((b) => set(b, 'legal', 'smallest text near the bottom'));
  // 4. A short wordmark above all copy is usually the logo (it can be stacked over two lines).
  if (!taken('logo')) {
    const ordered = [...blocks].sort((a, b) => a.y - b.y);
    const logo = [];
    for (const b of ordered) {
      const prev = logo.at(-1);
      const chars = logo.reduce((n, l) => n + l.chars, 0) + b.chars;
      // Stacked wordmark parts are close and similarly sized (one word over another).
      const stacked =
        !prev ||
        (b.y - (prev.y + prev.height) <= 0.3 * prev.lineHeight &&
          b.lineHeight / prev.lineHeight >= 0.85 &&
          b.lineHeight / prev.lineHeight <= 1.18);
      const fits =
        !b.role && chars <= 12 && b.words <= 2 && b.y + b.height <= 0.25 * height && stacked;
      if (!fits) break;
      logo.push(b);
    }
    if (logo.length && blocks.length - logo.length >= 2)
      logo.forEach((b) => set(b, 'logo', 'short wordmark above the copy'));
  }
  // 5. Largest remaining text is the headline, the next largest the subtitle.
  const bySize = () =>
    free().sort((a, b) => b.lineHeight - a.lineHeight || a.y - b.y || b.chars - a.chars);
  if (!taken('headline') && bySize()[0])
    set(bySize()[0], 'headline', hasCopy ? 'largest unmatched text' : 'largest text');
  if (!taken('subtitle') && bySize()[0]) set(bySize()[0], 'subtitle', 'next largest text');
  // 6. A short single line below the copy is a likely CTA when no button was seen.
  if (!taken('cta')) {
    const headline = blocks.find((b) => b.role === 'headline');
    const cta = free()
      .filter(
        (b) =>
          b.lines.length === 1 && b.words <= 3 && b.chars <= 24 && (!headline || b.y > headline.y),
      )
      .sort((a, b) => b.y - a.y)[0];
    if (cta) set(cta, 'cta', 'short line below the copy');
  }
  for (const b of free()) set(b, 'custom', 'not matched to a role');
  return blocks;
}

// ---------- layers ----------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function alignOf(block, width) {
  const centre = block.x + block.width / 2;
  if (Math.abs(centre - width / 2) <= 0.05 * width) return 'center';
  const lefts = block.lines.map((l) => l.x),
    rights = block.lines.map((l) => l.x + l.width);
  if (Math.max(...lefts) - Math.min(...lefts) <= 0.03 * width) return 'left';
  if (Math.max(...rights) - Math.min(...rights) <= 0.03 * width) return 'right';
  return 'center';
}
function union(blocks) {
  return blockOf(blocks.flatMap((b) => b.lines));
}

function layerFor(id, role, block, { width, height, scale, reason }) {
  const lines = block.lines;
  const fontSize = clamp(Math.round(block.lineHeight * scale), 6, 500);
  const pitch =
    lines.length > 1 ? (lines.at(-1).y - lines[0].y) / (lines.length - 1) : block.lineHeight;
  const box = role === 'cta' && lines[0].buttonBox ? lines[0].buttonBox : block;
  const x = clamp(Math.round(box.x), 0, width - 4),
    y = clamp(Math.round(box.y), 0, height - 4);
  const common = {
    id,
    name: `${ROLE_LABELS[role]} · ${reason} · “${block.text.slice(0, 40)}”`,
    x,
    y,
    width: clamp(Math.round(box.width), 4, width - x),
    height: clamp(Math.round(box.height), 4, height - y),
  };
  if (role === 'logo') return { ...common, type: 'logo', source: 'logo' };
  const text = {
    ...common,
    type: role === 'cta' ? 'button' : 'text',
    source: role === 'headline-support' ? 'headline' : role,
    text: '',
    fontSize,
    minFontSize: Math.max(5, Math.min(fontSize, Math.round(fontSize * 0.6))),
    maxLines: clamp(lines.length, 1, 20),
    lineHeight:
      lines.length > 1 ? Number(clamp(pitch / Math.max(1, fontSize), 0.8, 2).toFixed(2)) : 1,
    align: role === 'cta' ? 'center' : alignOf(block, width),
    verticalAlign: 'middle',
    textFlow: 'manual',
    fontWeight: role === 'legal' ? 'normal' : 'bold',
  };
  if (role === 'cta')
    return {
      ...text,
      ...(block.lines[0].back && block.button ? { fill: toHex(block.lines[0].back) } : {}),
      ...(block.ink ? { textFill: toHex(block.ink) } : {}),
      radius: Math.round(common.height / 2),
    };
  return block.ink ? { ...text, fill: toHex(block.ink) } : text;
}

/**
 * @param lines   [{ text, box: normalized, confidence }]
 * @param pixels  optional RGBA buffer of the reference at width x height
 * @param campaign optional market campaign copy ({ headline, subtitle, cta, legal })
 */
const AI_ROLES = new Set(['logo', 'headline', 'subtitle', 'cta', 'legal', 'other']);

/** Blocks grouped within each Qwen3-VL role; the model's role is the block's role. */
function roleBlocks(px, width) {
  const roles = [...new Set(px.map((l) => l.aiRole))];
  return roles
    .flatMap((role) =>
      groupTextLines(
        px.filter((l) => l.aiRole === role),
        width,
      ).map((block) =>
        Object.assign(block, {
          role: role === 'other' ? 'custom' : role,
          reason: 'Qwen3-VL',
        }),
      ),
    )
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * @param lineRoles optional Qwen3-VL role per input line (logo, headline, subtitle, cta, legal,
 *   other). When present it replaces the rule-based role guesses below.
 */
export function suggestReferenceLayout({
  lines,
  width,
  height,
  engine,
  pixels = null,
  campaign = null,
  lineRoles = null,
}) {
  const scale = FONT_SCALE[engine] ?? 1;
  const copy = Object.fromEntries(
    ['headline', 'subtitle', 'cta', 'legal']
      .map((role) => [role, campaign?.[role] || ''])
      .filter(([, value]) => value.trim()),
  );
  let px = lines
    .map((l, index) => ({ l, aiRole: lineRoles?.[index] }))
    .filter(({ l }) => l.text.trim())
    .slice(0, 120)
    .map(({ l, aiRole }) => ({
      text: l.text.trim(),
      confidence: l.confidence ?? null,
      x: l.box.x * width,
      y: l.box.y * height,
      width: l.box.width * width,
      height: l.box.height * height,
      aiRole: AI_ROLES.has(aiRole) ? aiRole : 'other',
    }));
  if (pixels) px = sampleLineColors(pixels, px);
  px = px.map((l) => ({ ...l, copyRole: matchCopyRole(l.text, copy) }));
  const blocks = lineRoles
    ? roleBlocks(px, width)
    : assignRoles(groupTextLines(px, width), {
        height,
        hasCopy: Object.keys(copy).length > 0,
      });

  const layers = [],
    suggestions = [];
  const add = (id, role, block, reason) => {
    layers.push(layerFor(id, role, block, { width, height, scale, reason }));
    suggestions.push({ role, text: block.text, reason });
  };
  const of = (role) => blocks.filter((b) => b.role === role);
  if (of('logo').length) add('logo', 'logo', union(of('logo')), of('logo')[0].reason);
  const headline = of('headline');
  // Two differently styled headline blocks map onto the copy's first line and the rest.
  if (headline.length >= 2 && String(campaign?.headline || '').includes('\n')) {
    add('headline', 'headline', headline[0], `${headline[0].reason}, first line`);
    add(
      'headline-support',
      'headline-support',
      union(headline.slice(1)),
      `${headline[1].reason}, remaining lines`,
    );
    const [first, support] = layers.slice(-2);
    first.sourcePart = 'first-line';
    first.maxLines = 1;
    support.sourcePart = 'remaining-lines';
  } else if (headline.length) add('headline', 'headline', union(headline), headline[0].reason);
  for (const role of ['subtitle', 'cta', 'legal'])
    if (of(role).length) add(role, role, union(of(role)), of(role)[0].reason);
  of('custom').forEach((b, i) => add(`ocr-text-${i + 1}`, 'custom', b, b.reason));
  return { layers, suggestions, page: pixels ? toHex(pageColor(pixels)) : null };
}

/** A draft Blueprint whose text layers carry suggested roles for review. */
export function blueprintFromTextLines({
  lines,
  engine,
  marketId,
  width,
  height,
  pixels,
  campaign,
  lineRoles = null,
}) {
  if (!lines.length)
    throw new Error('No text was found in the reference. No blueprint was created.');
  const { layers, suggestions, page } = suggestReferenceLayout({
    lines,
    width,
    height,
    engine,
    pixels,
    campaign,
    lineRoles,
  });
  const blueprint = validateBlueprint({
    schemaVersion: 1,
    id: `${marketId}-${width}x${height}`,
    marketId,
    name: `${width}x${height}`,
    width,
    height,
    mode: 'static',
    repeat: 0,
    background: page || '#070d1d',
    layers,
    scenes: [
      {
        id: 'text-reference',
        name: 'Suggested from reference',
        durationMs: 2000,
        transitionMs: 0,
        tracks: {},
      },
    ],
  });
  return { blueprint, suggestions };
}

/** Plain sentence for the import notice, e.g. "headline, subtitle, CTA and legal". */
export function describeSuggestions(suggestions) {
  const names = [
    ...new Set(
      suggestions
        .filter((s) => s.role !== 'custom')
        .map((s) => ({ 'headline-support': 'headline', cta: 'CTA' })[s.role] || s.role),
    ),
  ];
  const unassigned = suggestions.filter((s) => s.role === 'custom').length;
  const list =
    names.length > 1
      ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
      : names[0] || 'no roles';
  return `${list}${unassigned ? `; ${unassigned} unassigned` : ''}`;
}
