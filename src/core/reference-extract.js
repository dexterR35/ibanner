import { validateBlueprint } from './schema.js';
import { uid } from '../data/defaults.js';

/**
 * Draft blueprint proposals from a finished banner image. Pure geometry: detection lives in
 * image-analysis.js (OpenCV) and the subject finders. No text is read (no OCR): layouts bind
 * to campaign copy. Results are editable drafts that always need review.
 */
const area = (r) => r.width * r.height;
const intersect = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const union = (a, b) => {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

/** Join glyph/word boxes that share a row into text lines. */
export function mergeLines(rects) {
  const lines = [];
  for (const rect of [...rects].sort((a, b) => a.x - b.x)) {
    const line = lines.find((l) => {
      const overlapY = Math.min(l.y + l.height, rect.y + rect.height) - Math.max(l.y, rect.y);
      const gap = rect.x - (l.x + l.width);
      return (
        overlapY > Math.min(l.height, rect.height) * 0.5 &&
        gap < Math.max(l.height, rect.height) * 1.2
      );
    });
    if (line) {
      Object.assign(line, union(line, rect));
      line.parts++;
    } else lines.push({ ...rect, parts: 1 });
  }
  // A lone compact blob is usually photo texture; words are wide or made of several parts.
  return lines.filter((l) => l.parts > 1 || l.width >= l.height * 1.4);
}

/** Stack lines with similar height and small vertical gaps into text blocks. */
export function groupBlocks(lines) {
  const blocks = [];
  for (const line of [...lines].sort((a, b) => a.y - b.y)) {
    const block = blocks.find((b) => {
      const last = b.lines.at(-1);
      const gap = line.y - (last.y + last.height);
      // Small type (legal) varies more with accents and descenders than display copy.
      const tallest = Math.max(line.height, last.height);
      const similar = tallest / Math.min(line.height, last.height) < (tallest < 14 ? 1.5 : 1.3);
      const shared = Math.min(b.x + b.width, line.x + line.width) - Math.max(b.x, line.x);
      return (
        gap >= -2 &&
        gap < Math.max(4, Math.min(line.height, last.height) * 0.6) &&
        similar &&
        shared > Math.min(b.width, line.width) * 0.3
      );
    });
    if (block) {
      block.lines.push(line);
      Object.assign(block, union(block, line));
    } else blocks.push({ ...line, lines: [line] });
  }
  for (const block of blocks)
    block.lineHeight = block.lines.reduce((sum, l) => sum + l.height, 0) / block.lines.length;
  return blocks;
}

/**
 * The photograph as the largest connected textured area of a coarse energy grid (text
 * removed). Its fade faces the widest open side, where the photo meets flat background.
 */
export function photoRegion({ values, cols, rows, cell }, width, height, threshold = 0.25) {
  const textured = values.map((v) => v >= threshold);
  const seen = new Uint8Array(values.length);
  let best = null;
  for (let start = 0; start < values.length; start++) {
    if (!textured[start] || seen[start]) continue;
    const queue = [start],
      members = [];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.pop(),
        x = i % cols,
        y = Math.floor(i / cols);
      members.push(i);
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]) {
        const n = ny * cols + nx;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && textured[n] && !seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
      }
    }
    if (!best || members.length > best.length) best = members;
  }
  if (!best || best.length < values.length * 0.08) return null;
  const xs = best.map((i) => i % cols),
    ys = best.map((i) => Math.floor(i / cols));
  const x = Math.min(...xs) * cell,
    y = Math.min(...ys) * cell;
  const rect = {
    x,
    y,
    width: Math.min(width, (Math.max(...xs) + 1) * cell) - x,
    height: Math.min(height, (Math.max(...ys) + 1) * cell) - y,
  };
  const open = [
    ['top', rect.y],
    ['bottom', height - rect.y - rect.height],
    ['left', rect.x],
    ['right', width - rect.x - rect.width],
  ].sort((a, b) => b[1] - a[1]);
  return { ...rect, fadeDirection: open[0][1] > cell ? open[0][0] : 'top' };
}

const LEGAL_ZONE = 0.86;

/** Assign roles to detected regions. Every role is optional. */
export function classifyRegions({ width, height, blocks, logo, button, photo }) {
  const inside = (block, rect) => rect && intersect(block, rect) > area(block) * 0.5;
  // Text within the logo or button belongs to them.
  let text = blocks.filter((b) => !inside(b, logo) && !inside(b, button));
  // Legal: the bottom-most wide block in the bottom zone (it may sit over the photo).
  const legal =
    text
      .filter((b) => b.y + b.height > height * LEGAL_ZONE && b.width > width * 0.3)
      .sort((a, b) => b.y + b.height - (a.y + a.height))[0] || null;
  text = text.filter((b) => b !== legal);
  let logoRect = logo;
  if (!logoRect && text.length > 1) {
    // Without a detected logo, a first block in the top fifth is treated as the lockup.
    const first = [...text].sort((a, b) => a.y - b.y)[0];
    if (first.y < height * 0.2) {
      logoRect = first;
      text = text.filter((b) => b !== first);
    }
  }
  const ordered = [...text].sort((a, b) => a.y - b.y || a.x - b.x);
  // Further copy must be comparable to the main copy; tiny detections are dropped.
  const main = ordered.slice(0, 2).map((b) => b.lineHeight);
  const extra = ordered
    .slice(2)
    .filter((b) => b.lineHeight >= Math.min(...main) * 0.6 && b.width >= width * 0.2);
  return {
    width,
    height,
    logo: logoRect,
    button,
    legal,
    photo,
    headline: ordered[0] || null,
    subtitle: ordered[1] || null,
    extra: extra.slice(0, 4),
  };
}

/**
 * Full pipeline from detections to roles. Lines inside the photo are kept only when large
 * (overlaid copy) or in the bottom legal zone; smaller ones are usually photo texture.
 */
export function extractRoles({ width, height, textRects, grid, button = null, logo = null }) {
  const photo = photoRegion(grid, width, height);
  const lines = mergeLines(textRects).filter(
    (l) =>
      !photo ||
      intersect(l, photo) <= area(l) * 0.5 ||
      l.y + l.height > height * LEGAL_ZONE ||
      (l.height >= height * 0.035 && l.width >= width * 0.25),
  );
  return classifyRegions({ width, height, blocks: groupBlocks(lines), logo, button, photo });
}

const round = (r) => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.max(4, Math.round(r.width)),
  height: Math.max(4, Math.round(r.height)),
});
const pad = (r, amount, width, height) => {
  const x = Math.max(0, r.x - amount),
    y = Math.max(0, r.y - amount);
  return {
    x,
    y,
    width: Math.min(width, r.x + r.width + amount) - x,
    height: Math.min(height, r.y + r.height + amount) - y,
  };
};

/** A schema-valid static blueprint from classified regions. */
export function blueprintFromRegions(roles, { marketId, background = '#070d1d', textColors = {} }) {
  const { width, height } = roles;
  const layers = [];
  const add = (id, type, rect, props = {}) =>
    layers.push({
      id,
      type,
      name: props.name || id,
      source: props.source || id,
      ...round(rect),
      ...props,
    });
  if (roles.photo)
    add('hero', 'image', roles.photo, {
      name: 'Campaign image',
      fadeDirection: roles.photo.fadeDirection,
      fade: 0.35,
    });
  if (roles.logo) add('logo', 'logo', pad(roles.logo, 2, width, height), { name: 'Logo' });
  const text = (id, block, props) => {
    const box = pad(block, Math.max(2, block.lineHeight * 0.15), width, height);
    const size = Math.max(6, Math.round(block.lineHeight));
    add(id, 'text', box, {
      fontSize: size,
      minFontSize: Math.max(5, Math.min(size, Math.round(size * 0.6))),
      maxLines: Math.max(1, Math.min(20, block.lines.length)),
      align: Math.abs(block.x + block.width / 2 - width / 2) < width * 0.08 ? 'center' : 'left',
      fill: textColors[id] || '#ffffff',
      ...props,
    });
  };
  if (roles.headline) text('headline', roles.headline, { name: 'Headline' });
  if (roles.subtitle) text('subtitle', roles.subtitle, { name: 'Offer / subtitle' });
  roles.extra.forEach((block, index) =>
    text(`text-${index + 1}`, block, {
      name: `Detected text ${index + 1}`,
      source: 'custom',
      text: '',
    }),
  );
  if (roles.button)
    add('cta', 'button', roles.button, {
      name: 'Call to action',
      fontSize: Math.max(8, Math.round(roles.button.height * 0.45)),
      minFontSize: Math.max(6, Math.round(roles.button.height * 0.3)),
      radius: Math.round(roles.button.height / 2),
      fill: textColors.cta || '#ef1929',
    });
  if (roles.legal)
    text('legal', roles.legal, {
      name: 'Market legal',
      fontWeight: 'normal',
      fill: textColors.legal || '#bfc3cc',
    });
  if (!layers.length) throw new Error('No layout regions were detected in this image.');
  return validateBlueprint({
    schemaVersion: 1,
    id: `${marketId}-${width}x${height}`,
    marketId,
    name: `${width}x${height}`,
    width,
    height,
    mode: 'static',
    repeat: 0,
    background,
    layers,
    scenes: [{ id: uid(), name: 'Artwork', durationMs: 3000, transitionMs: 0, tracks: {} }],
  });
}

/** Room a detected logo may grow into: above the next copy block and outside the photo. */
export function logoBounds(roles) {
  const { width, height, logo } = roles;
  const below = [roles.headline, roles.subtitle, roles.button, roles.photo]
    .filter((r) => r && r.y >= logo.y + logo.height / 2)
    .map((r) => r.y);
  const bottom = Math.min(height, ...below);
  const top =
    roles.photo && roles.photo.y + roles.photo.height <= logo.y
      ? roles.photo.y + roles.photo.height
      : 0;
  return { x: 0, y: top, width, height: Math.max(logo.y + logo.height, bottom) - top };
}
