import { contrastRatio, hexToRgb, luminance } from './color.js';
import { boundText, canvasOf, drawLayer, renderFrame } from './render.js';
import { fitText } from './text-fit.js';
import { layerAt, sceneAt, sceneStart } from './timeline.js';

/** WCAG 2.x text contrast targets: large text is ≥ 18.66 px bold or ≥ 24 px regular. */
export const targetFor = (size, bold) => (size >= (bold ? 18.66 : 24) ? 3 : 4.5);

/**
 * Contrast of a fill colour against the pixels behind its glyphs. Uses the 10th percentile,
 * so a few dark pixels cannot hide a bright patch behind part of the text.
 */
export function glyphContrast(background, mask, fill) {
  const rgb = hexToRgb(fill),
    ratios = [];
  for (let i = 0; i < mask.length; i += 4)
    if (mask[i + 3] > 127)
      ratios.push(contrastRatio(rgb, [background[i], background[i + 1], background[i + 2]]));
  if (!ratios.length) return null;
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length * 0.1)];
}

/** A strong halo in a contrasting colour counts as the text's local background. */
export function haloPasses(layer, target) {
  const glow = layer.glow;
  return Boolean(
    glow?.enabled &&
    glow.opacity >= 0.8 &&
    glow.blur >= 3 &&
    contrastRatio(hexToRgb(layer.fill), hexToRgb(glow.color)) >= target,
  );
}

const checked = (layer, campaign) =>
  layer.type === 'text' && layer.visible && boundText(layer, campaign).trim();

/** Measure every visible text layer in every part where it appears (browser only). */
export function assessReadability(bp, campaign, resources) {
  const results = [],
    context = canvasOf(1, 1).getContext('2d');
  bp.layers.forEach((layer, index) => {
    if (!checked(layer, campaign)) return;
    const fit = fitText(context, boundText(layer, campaign), layer, resources);
    const target = targetFor(fit.size, layer.fontWeight === 'bold');
    let worst = null;
    bp.scenes.forEach((scene, sceneIndex) => {
      if (bp.mode === 'static' && sceneIndex > 0) return;
      const time = sceneStart(bp, sceneIndex) + Math.floor(scene.durationMs / 2);
      const { scene: current, local } = sceneAt(bp, time);
      const placed = layerAt(layer, current, local);
      if (!placed.visible || placed.opacity <= 0) return;
      const below = canvasOf(bp.width, bp.height),
        glyphs = canvasOf(bp.width, bp.height);
      // Everything painted before this text is its background at this moment.
      renderFrame(below, { ...bp, layers: bp.layers.slice(0, index) }, campaign, resources, time);
      drawLayer(
        glyphs.getContext('2d'),
        { ...placed, glow: { ...placed.glow, enabled: false }, opacity: 1 },
        campaign,
        resources,
        bp,
      );
      const ratio = glyphContrast(
        below.getContext('2d').getImageData(0, 0, bp.width, bp.height).data,
        glyphs.getContext('2d').getImageData(0, 0, bp.width, bp.height).data,
        layer.fill,
      );
      if (ratio != null && (worst == null || ratio < worst)) worst = ratio;
    });
    if (worst == null) return;
    const halo = haloPasses(layer, target);
    results.push({
      id: layer.id,
      name: layer.name,
      ratio: worst,
      target,
      halo,
      pass: halo || worst >= target,
    });
  });
  return results;
}

/**
 * Add a legibility halo to text that fails its contrast target. The halo uses the banner
 * background when that contrasts with the text, otherwise black or white. Layers with a
 * designed glow keep it and remain flagged for review.
 */
export function improveReadability(bp, results) {
  const failing = new Map(results.filter((r) => !r.pass).map((r) => [r.id, r]));
  if (!failing.size) return bp;
  return {
    ...bp,
    layers: bp.layers.map((layer) => {
      const result = failing.get(layer.id);
      if (!result || layer.glow?.enabled) return layer;
      const fill = hexToRgb(layer.fill);
      const halo =
        contrastRatio(fill, hexToRgb(bp.background)) >= result.target
          ? bp.background
          : luminance(fill) > 0.18
            ? '#000000'
            : '#ffffff';
      const size = Math.min(layer.height, layer.fontSize);
      return {
        ...layer,
        glow: {
          enabled: true,
          color: halo,
          blur: Math.max(3, Math.min(14, size * 0.45)),
          opacity: 0.9,
          auto: true,
        },
      };
    }),
  };
}

/** Remove halos previously added by improveReadability; designed glows are untouched. */
export function clearAutomaticHalos(bp) {
  if (!bp.layers.some((l) => l.glow?.auto)) return bp;
  return {
    ...bp,
    layers: bp.layers.map((l) =>
      l.glow?.auto
        ? { ...l, glow: { enabled: false, color: '#ff162d', blur: 8, opacity: 0.85 } }
        : l,
    ),
  };
}
