import { validateBlueprint } from '../core/schema.js';
import { createFadeMesh } from '../core/fade-mesh.js';

export const BANNER3_MARKET = {
  id: 'BANNER3',
  name: 'Banner 3',
  logoLabel: 'Logo',
  locale: 'en',
  flag: 'B3',
  legal: '',
  legalStatus: 'missing',
};

// Layout boxes per size, in native pixels: [x, y, width, height]. A role that is absent
// stays absent in that format. durationsMs holds one entry per GIF part; empty is static.
const measured = [
  {
    size: [160, 120],
    durationsMs: [2000, 2000],
    logo: [14, 13, 55, 17],
    headline: [7, 40, 73, 25],
    subtitle: [5, 40, 74, 23],
    cta: [11, 74, 65, 14],
    hero: [80, 0, 80, 93],
    legal: [2, 99, 156, 17],
    sequence: 'headline-offer',
  },
  {
    size: [170, 100],
    durationsMs: [2000, 2000, 2000],
    logo: [23, 8, 54, 17],
    headline: [7, 34, 83, 28],
    subtitle: [7, 35, 80, 27],
    cta: [12, 72, 73, 17],
    hero: [91, 0, 79, 100],
    legal: [11, 10, 74, 72],
    sequence: 'headline-offer-legal',
  },
  {
    size: [180, 150],
    durationsMs: [],
    logo: [23, 14, 59, 18],
    headline: [9, 42, 79, 26],
    subtitle: [10, 72, 80, 23],
    cta: [14, 104, 71, 16],
    hero: [94, 0, 86, 121],
    legal: [3, 125, 174, 19],
    sequence: 'static',
  },
  {
    size: [240, 100],
    durationsMs: [2000, 2000, 2000],
    logo: [32, 8, 54, 17],
    headline: [9, 34, 100, 29],
    subtitle: [7, 37, 106, 24],
    cta: [24, 74, 75, 17],
    hero: [111, 0, 129, 100],
    legal: [8, 10, 91, 81],
    sequence: 'headline-offer-legal',
  },
  {
    size: [300, 100],
    durationsMs: [2000, 2000],
    logo: [9, 29, 66, 23],
    headline: [86, 12, 127, 39],
    subtitle: [84, 24, 132, 23],
    cta: [110, 56, 80, 18],
    hero: [218, 0, 82, 81],
    legal: [3, 86, 294, 11],
    sequence: 'headline-offer',
  },
  {
    size: [300, 250],
    durationsMs: [],
    logo: [50, 17, 113, 34],
    headline: [9, 69, 199, 65],
    subtitle: [12, 139, 191, 34],
    cta: [40, 191, 135, 30],
    hero: [208, 0, 92, 230],
    legal: [5, 235, 290, 11],
    sequence: 'static',
  },
  {
    size: [300, 50],
    durationsMs: [2000, 2000],
    logo: [7, 9, 66, 20],
    headline: [105, 6, 91, 25],
    subtitle: [94, 7, 115, 23],
    hero: [212, 0, 88, 36],
    legal: [4, 39, 292, 8],
    sequence: 'headline-offer',
  },
  {
    size: [320, 100],
    durationsMs: [2000, 2000],
    logo: [7, 27, 78, 23],
    headline: [105, 10, 124, 36],
    subtitle: [99, 22, 133, 23],
    cta: [120, 55, 91, 20],
    hero: [240, 0, 80, 80],
    legal: [7, 86, 306, 11],
    sequence: 'headline-offer',
  },
  {
    size: [320, 50],
    durationsMs: [2000, 2000, 2000],
    logo: [7, 5, 76, 27],
    headline: [119, 6, 91, 25],
    subtitle: [106, 6, 116, 24],
    cta: [111, 7, 109, 24],
    hero: [224, 0, 96, 36],
    legal: [7, 39, 306, 8],
    sequence: 'headline-offer-cta',
  },
  {
    size: [350, 100],
    durationsMs: [2000, 2000],
    logo: [9, 29, 76, 22],
    headline: [112, 12, 126, 36],
    subtitle: [97, 23, 151, 24],
    cta: [135, 56, 80, 18],
    hero: [249, 0, 101, 80],
    legal: [13, 86, 324, 11],
    sequence: 'headline-offer',
  },
  {
    size: [728, 90],
    durationsMs: [2000, 2000],
    logo: [26, 27, 127, 38],
    headline: [373, 12, 335, 28],
    subtitle: [373, 44, 335, 24],
    cta: [455, 24, 168, 34],
    hero: [155, 0, 192, 90],
    legal: [350, 75, 371, 12],
    sequence: 'headline-and-offer-cta',
    singleLine: true,
  },
];

export const BANNER3_LAYOUTS = measured.map((row) => {
  const [width, height] = row.size;
  return {
    id: `BANNER3-${width}x${height}`,
    width,
    height,
    durationsMs: row.durationsMs,
    repeat: 0,
    boxes: row,
  };
});

/** Soft straight fade on the photo edge that faces the copy. */
export function banner3ImageFade(boxes) {
  const { hero, headline } = boxes;
  const direction =
    hero[1] > headline[1] + headline[3] ? 'top' : hero[0] < headline[0] ? 'right' : 'left';
  return {
    fade: 0.24,
    fadeDirection: direction,
    fadeMesh: { ...createFadeMesh('straight', 16, 0.12), softness: 0.24 },
  };
}

export function createBanner3Blueprint(layout) {
  const { id, width, height, boxes: b } = layout;
  const layer = (id, type, source, rect, props = {}) => ({
    id,
    name: id === 'logo' ? 'Logo' : id,
    type,
    source,
    x: rect[0],
    y: rect[1],
    width: rect[2],
    height: rect[3],
    fontSize: 80,
    minFontSize: 4,
    maxLines: 2,
    lineHeight: 1,
    align: 'center',
    textFlow: 'manual',
    ...props,
  });
  const layers = [
    layer('hero', 'image', 'hero', b.hero, banner3ImageFade(b)),
    layer('logo', 'logo', 'logo', b.logo),
    layer('headline', 'text', 'headline', b.headline, {
      fill: '#ffc447',
      textFlow: b.singleLine ? 'single-line' : 'manual',
      maxLines: b.singleLine ? 1 : 2,
    }),
  ];
  if (b.singleLine)
    layers.push(
      layer('subtitle', 'text', 'subtitle', b.subtitle, {
        fill: '#9370e9',
        textFlow: 'single-line',
        maxLines: 1,
      }),
    );
  else {
    const [x, y, w, h] = b.subtitle;
    layers.push(
      layer('subtitle', 'text', 'subtitle', [x, y, w, h * 0.6], {
        fill: '#9370e9',
        sourcePart: 'first-line',
        maxLines: 1,
      }),
    );
    layers.push(
      layer('subtitle-support', 'text', 'subtitle', [x, y + h * 0.6, w, h * 0.4], {
        fill: '#9370e9',
        sourcePart: 'remaining-lines',
        maxLines: 1,
      }),
    );
  }
  if (b.cta)
    layers.push(
      layer('cta', 'button', 'cta', b.cta, {
        fill: '#f6c84e',
        textFill: '#080607',
        textPaddingX: b.cta[2] * 0.12,
        textPaddingY: b.cta[3] * 0.2,
        radius: 30,
        maxLines: 1,
      }),
    );
  layers.push(
    layer('legal', 'text', 'legal', b.legal, {
      fill: '#e2dfeb',
      fontWeight: 'normal',
      ...(b.sequence.endsWith('-legal')
        ? { fontSize: Math.floor(b.legal[3] / 7), minFontSize: Math.floor(b.legal[3] / 7) }
        : {}),
      align: b.sequence.endsWith('-legal') ? 'left' : 'center',
      textFlow: width >= 300 ? 'single-line' : 'auto',
      maxLines: b.sequence.endsWith('-legal') ? 8 : width >= 300 ? 1 : 2,
    }),
  );
  const base = ['hero', 'logo', ...(b.sequence.endsWith('-legal') ? [] : ['legal'])];
  const offer = layers.filter((l) => l.source === 'subtitle').map((l) => l.id);
  const persistentCta = b.cta && !b.sequence.endsWith('-cta') ? ['cta'] : [];
  const parts =
    b.sequence === 'static'
      ? [['Artwork', layers.map((l) => l.id)]]
      : b.sequence === 'headline-and-offer-cta'
        ? [
            ['Headline + offer', [...base, 'headline', ...offer]],
            ['Call to action', [...base, 'cta']],
          ]
        : [
            ['Headline', [...base, 'headline', ...persistentCta]],
            ['Offer', [...base, ...offer, ...persistentCta]],
            ...(b.sequence.endsWith('-legal')
              ? [['Legal', ['hero', 'legal']]]
              : b.sequence.endsWith('-cta')
                ? [['Call to action', [...base, 'cta']]]
                : []),
          ];
  if (b.sequence !== 'static' && parts.length !== layout.durationsMs.length)
    throw new Error(`Frame count mismatch: ${id}`);
  return validateBlueprint({
    schemaVersion: 1,
    id,
    marketId: BANNER3_MARKET.id,
    name: `${width}x${height}`,
    width,
    height,
    mode: parts.length > 1 ? 'animated' : 'static',
    repeat: layout.repeat,
    background: '#170e29',
    layers,
    scenes: parts.map(([name, visible], i) => ({
      id: `part-${i + 1}`,
      name,
      durationMs: layout.durationsMs[i] || 3000,
      transitionMs: 0,
      tracks: Object.fromEntries(layers.map((l) => [l.id, { visible: visible.includes(l.id) }])),
    })),
  });
}
