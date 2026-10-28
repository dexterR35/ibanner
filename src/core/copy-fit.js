import { boundText } from './render.js';
import { buttonTextBox, fitText } from './text-fit.js';

/**
 * Copy that cannot fit its box at the layer's minimum size, with how many leading characters
 * would fit. Studio offers Qwen3-VL shorter versions for these; an approved version is stored
 * per size in campaign.copyFits (shared with Create). Legal copy is never shortened.
 */
const ROLES = ['headline', 'subtitle', 'cta'];

function fitsAtMinimum(context, text, layer, resources) {
  const box = layer.type === 'button' ? buttonTextBox(layer) : layer;
  const fit = fitText(context, text, { ...box, fontSize: layer.minFontSize }, resources, {
    grow: false,
  });
  return !fit.overflow;
}

/** Longest leading-word prefix that fits at the minimum size (characters), or 0. */
export function copyCapacity(context, text, layer, resources) {
  const words = String(text).trim().split(/\s+/);
  let best = 0;
  for (let n = 1; n <= words.length; n++) {
    const prefix = words.slice(0, n).join(' ');
    if (!fitsAtMinimum(context, prefix, layer, resources)) break;
    best = prefix.length;
  }
  return best;
}

/** [{ size, role, text, capacity }] for one resolved banner. */
export function copyFitIssues(bp, campaign, resources, context) {
  const size = `${bp.width}x${bp.height}`,
    issues = [];
  for (const layer of bp.layers) {
    if (!layer.visible || !ROLES.includes(layer.source) || !['text', 'button'].includes(layer.type))
      continue;
    if (layer.sourcePart && layer.sourcePart !== 'all') continue;
    const text = boundText(layer, campaign);
    if (!text.trim() || fitsAtMinimum(context, text, layer, resources)) continue;
    if (issues.some((i) => i.role === layer.source)) continue;
    issues.push({
      size,
      role: layer.source,
      text,
      capacity: copyCapacity(context, text, layer, resources),
    });
  }
  return issues;
}
