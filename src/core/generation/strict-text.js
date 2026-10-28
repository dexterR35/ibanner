import { canvasFont } from '../typography.js';

// Preserve hard breaks and nonbreaking spaces. No emergency word splitting or rewriting.
function wrapExact(ctx, text, width, single) {
  if (single) return [text];
  const result = [];
  for (const paragraph of text.split('\n')) {
    const tokens = paragraph.match(/[^ \t]+[ \t]*|[ \t]+/gu) || [''];
    let line = '';
    for (const token of tokens) {
      if (line && ctx.measureText(line + token.trimEnd()).width > width + 0.01) {
        result.push(line.trimEnd());
        line = token;
      } else line += token;
    }
    result.push(line.trimEnd());
  }
  return result;
}
/** Finite descending search shared by strict preview, solving and encoding. */
export function measureStrictText(ctx, text, layer, resources = {}) {
  const sourceText = String(text);
  const min = layer.minFontSize;
  const max = Math.max(min, Math.min(500, layer.fontSize));
  let result;
  const sizes = Array.from({ length: Math.floor(max - min) + 1 }, (_, i) => max - i);
  if (sizes.at(-1) !== min) sizes.push(min);
  for (const size of sizes) {
    ctx.font = canvasFont(layer, size, resources);
    ctx.direction = layer.direction || 'ltr';
    const lines = wrapExact(ctx, sourceText, layer.width, layer.textFlow === 'single-line');
    const metrics = lines.map((line) => ctx.measureText(line));
    const widths = metrics.map((m) =>
      Math.max(m.width, (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || 0)),
    );
    const glyphHeight = Math.max(
      size,
      ...metrics.map((m) => (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0)),
    );
    const height = Math.max(
      lines.length * size * layer.lineHeight,
      (lines.length - 1) * size * layer.lineHeight + glyphHeight,
    );
    const violations = [];
    if (lines.length > layer.maxLines) violations.push('line-limit');
    if (widths.some((w) => w > layer.width + 0.1)) violations.push('text-width');
    if (height > layer.height + 0.1) violations.push('text-height');
    if (layer.textFlow === 'single-line' && sourceText.includes('\n'))
      violations.push('hard-break');
    result = {
      sourceText,
      lines,
      widths,
      size,
      height,
      overflow: violations.length > 0,
      violations,
      belowMinimum: false,
      truncated: false,
      font: ctx.font,
    };
    if (!result.overflow) break;
  }
  return result;
}
