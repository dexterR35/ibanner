import { contrastRatio, hexToRgb, rgbToHex, rgbToHsl, withContrast } from './color.js';

/**
 * Deterministic k-means over sampled RGBA pixels (transparent pixels ignored).
 * Returns up to `k` colours sorted by coverage.
 */
export function extractPalette(pixels, { k = 6, iterations = 12, maxSamples = 12000 } = {}) {
  const stride = Math.max(1, Math.floor(pixels.length / 4 / maxSamples));
  const samples = [];
  for (let i = 0; i < pixels.length; i += 4 * stride)
    if (pixels[i + 3] > 127) samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  if (!samples.length) return [];
  const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Farthest-point initialisation from the mean keeps results stable and diverse.
  const mean = [0, 1, 2].map((c) => samples.reduce((sum, p) => sum + p[c], 0) / samples.length);
  const centers = [];
  let next = samples.reduce((best, p) => (distance(p, mean) < distance(best, mean) ? p : best));
  while (centers.length < Math.min(k, samples.length)) {
    centers.push([...next]);
    next = samples.reduce(
      (best, p) => {
        const d = Math.min(...centers.map((c) => distance(p, c)));
        return d > best.d ? { p, d } : best;
      },
      { p: samples[0], d: -1 },
    ).p;
  }
  let counts = [];
  for (let round = 0; round < iterations; round++) {
    const sums = centers.map(() => [0, 0, 0]);
    counts = centers.map(() => 0);
    for (const p of samples) {
      let index = 0;
      for (let c = 1; c < centers.length; c++)
        if (distance(p, centers[c]) < distance(p, centers[index])) index = c;
      counts[index]++;
      for (let ch = 0; ch < 3; ch++) sums[index][ch] += p[ch];
    }
    centers.forEach((center, c) => {
      if (counts[c]) for (let ch = 0; ch < 3; ch++) center[ch] = sums[c][ch] / counts[c];
    });
  }
  return centers
    .map((center, c) => ({ color: rgbToHex(center), weight: counts[c] / samples.length }))
    .filter((item) => item.weight > 0.01)
    .sort((a, b) => b.weight - a.weight);
}

const vividness = (hexColor) => {
  const [, s, l] = rgbToHsl(hexToRgb(hexColor));
  return s * (1 - Math.abs(l - 0.5) * 2);
};

/**
 * Accent: the photo's most vivid colour, adjusted to stand out from the banner background.
 * CTA: that hue adjusted so white button text stays readable (≥ 4.5:1).
 */
export function suggestColors(colors, background) {
  const bg = hexToRgb(background);
  const vivid = [...colors].sort(
    (a, b) => vividness(b.color) * Math.sqrt(b.weight) - vividness(a.color) * Math.sqrt(a.weight),
  )[0];
  const base = hexToRgb(vivid?.color || '#ff2638');
  const accent = withContrast(base, bg, 3);
  let cta = withContrast(base, [255, 255, 255], 4.5);
  if (contrastRatio(cta, bg) < 1.5) cta = withContrast(cta, bg, 1.5);
  return { accent: rgbToHex(accent), cta: rgbToHex(cta) };
}
