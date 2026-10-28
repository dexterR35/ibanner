import { measureStrictText } from './generation/strict-text.js';
import { canvasFont } from './typography.js';

export function buttonTextBox(layer) {
  const paddingX = Math.min(layer.textPaddingX ?? 6, (layer.width - 1) / 2);
  const paddingY = Math.min(layer.textPaddingY ?? 2, (layer.height - 1) / 2);
  return {
    ...layer,
    width: layer.width - paddingX * 2,
    height: layer.height - paddingY * 2,
    maxLines: 1,
    paddingX,
    paddingY,
  };
}

function wrap(ctx, text, width, breakWords = false) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (breakWords && ctx.measureText(word).width > width) {
        if (line) lines.push(line);
        line = '';
        const characters = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
        for (const { segment } of characters) {
          if (line && ctx.measureText(line + segment).width > width) {
            lines.push(line);
            line = '';
          }
          line += segment;
        }
        continue;
      }
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
const flatten = (text) => String(text).trim().replace(/\s+/g, ' ');

/** Balance the chosen row count without rearranging or dropping any words. */
function balancedRows(ctx, text, width, rows) {
  const words = flatten(text).split(' '),
    n = words.length;
  if (rows <= 1 || n > 80) return null;
  const lengths = Array.from({ length: n }, () => []);
  for (let start = 0; start < n; start++) {
    let line = '';
    for (let end = start; end < n; end++) {
      line += `${line ? ' ' : ''}${words[end]}`;
      lengths[start][end + 1] = ctx.measureText(line).width;
    }
  }
  const costs = Array.from({ length: rows + 1 }, () => Array(n + 1).fill(Infinity));
  const previous = Array.from({ length: rows + 1 }, () => []);
  costs[0][0] = 0;
  for (let row = 1; row <= rows; row++)
    for (let end = row; end <= n; end++) {
      for (let start = row - 1; start < end; start++) {
        const length = lengths[start][end];
        if (length > width + 0.1) continue;
        const cost = costs[row - 1][start] + (width - length) ** 2;
        if (cost < costs[row][end]) {
          costs[row][end] = cost;
          previous[row][end] = start;
        }
      }
    }
  if (!Number.isFinite(costs[rows][n])) return null;
  const lines = [];
  let end = n;
  for (let row = rows; row > 0; row--) {
    const start = previous[row][end];
    lines.unshift(words.slice(start, end).join(' '));
    end = start;
  }
  return lines;
}
/** Fill the existing box; saved minimum sizes and row counts are preferences, never truncation limits. */
export function fitText(ctx, text, layer, font = 'Arial', { grow = true } = {}) {
  if (layer.fitPolicy === 'strict-v1') return measureStrictText(ctx, text, layer, font);
  const flow = layer.textFlow || 'manual';
  const content = flow === 'manual' ? String(text) : flatten(text);
  const minimum = layer.minFontSize;
  const maximum = grow
    ? Math.max(minimum, Math.min(500, layer.height / layer.lineHeight))
    : Math.max(minimum, layer.fontSize);
  const measure = (size, flexible = false) => {
    ctx.font = canvasFont(layer, size, font);
    const lines =
      flow === 'single-line' && !flexible ? [content] : wrap(ctx, content, layer.width, flexible);
    return {
      lines,
      size,
      overflow:
        (!flexible && lines.length > layer.maxLines) ||
        lines.length * size * layer.lineHeight > layer.height + 0.1 ||
        lines.some((line) => ctx.measureText(line).width > layer.width + 0.1),
    };
  };
  let result = measure(minimum);
  if (result.overflow) {
    // Composition scoring still reports its preferred-size overflow. Actual rendering
    // must retain every character, adding rows and shrinking below that preference.
    if (!grow) return result;
    let low = Math.min(
      0.01,
      layer.width / (Math.max(1, content.length) * 10),
      layer.height / (Math.max(1, content.length) * layer.lineHeight * 10),
    );
    let high = maximum;
    result = measure(low, true);
    for (let step = 0; step < 20; step++) {
      const middle = (low + high) / 2;
      const next = measure(middle, true);
      if (next.overflow) high = middle;
      else {
        result = next;
        low = middle;
      }
    }
    ctx.font = canvasFont(layer, result.size, font);
    return { ...result, belowMinimum: result.size < minimum };
  }
  // Monotone half-pixel search avoids hundreds of measurements per artboard.
  let low = 1,
    high = Math.floor((maximum - minimum) * 2);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const next = measure(minimum + middle / 2);
    if (next.overflow) high = middle - 1;
    else {
      result = next;
      low = middle + 1;
    }
  }
  ctx.font = canvasFont(layer, result.size, font);
  if (flow === 'auto')
    result.lines = balancedRows(ctx, content, layer.width, result.lines.length) || result.lines;
  return result;
}

export function textTop(layer, lineCount, size) {
  const room = Math.max(0, layer.height - lineCount * size * layer.lineHeight);
  return layer.verticalAlign === 'top' ? 0 : layer.verticalAlign === 'bottom' ? room : room / 2;
}
