import { splitTallHeadline } from '../core/tall-headline.js';
import { validateBlueprint } from '../core/schema.js';
import { suggestTextLayout } from '../core/text-layout.js';
import { layoutKey } from '../core/auto-layout.js';
import { correctBlueprintLayout } from '../core/blueprint-corrections.js';
import { reserveLegalFooter } from '../core/legal-footer.js';
import { DEFAULT_TEXT_HIERARCHY } from './text-hierarchy.js';
import { BANNER3_MARKET, BANNER3_LAYOUTS, createBanner3Blueprint } from './banner3.js';

const COMMON_SIZES = ['728x90', '320x50', '300x50', '300x100', '300x250'];
export const PRESETS = [
  [300, 250],
  [300, 600],
  [160, 600],
  [320, 480],
  [728, 90],
  [320, 50],
  [300, 100],
  [300, 50],
  [970, 250],
  [150, 90],
  ...BANNER3_LAYOUTS.filter((l) => !COMMON_SIZES.includes(`${l.width}x${l.height}`)).map((l) => [
    l.width,
    l.height,
  ]),
];
export const sizeId = (w, h) => `${w}x${h}`;
// Sizes whose starting layout was measured from a finished design rather than produced by
// the proportional factory. Measured layouts keep their boxes and serve as Arrange examples.
const MEASURED_SIZES = {
  BANNER1: ['300x250', '300x600', '160x600', '320x480', '300x50', '320x50', '300x100', '728x90'],
  [BANNER3_MARKET.id]: BANNER3_LAYOUTS.map((l) => sizeId(l.width, l.height)),
};
export const isMeasuredLayout = (bp) =>
  !!MEASURED_SIZES[bp.marketId]?.includes(sizeId(bp.width, bp.height));
export const uid = () => crypto.randomUUID();
export const DEFAULT_MARKETS = [
  {
    id: 'BANNER1',
    name: 'Banner 1',
    locale: 'en',
    legal: '',
    legalStatus: 'missing',
    flag: 'B1',
  },
  {
    id: 'BANNER2',
    name: 'Banner 2',
    locale: 'en',
    legal: '',
    legalStatus: 'missing',
    flag: 'B2',
  },
  BANNER3_MARKET,
];
/** A blank starting campaign: neutral placeholder copy and no brand assets. */
export function campaignFor(market) {
  return {
    name: `${market.name} · New campaign`,
    headline: 'YOUR HEADLINE\nGOES HERE',
    subtitle: 'YOUR OFFER\nTEXT',
    cta: 'Call to action',
    legal: market.legal ?? '',
    accentWord: '',
    accentColor: '#ff2638',
    heroAssetId: null,
    logoAssetId: null,
    fontAssetId: null,
    subjectEngine: 'florence',
    autoArrange: true,
    imageFadeEnabled: true,
    textHierarchy: structuredClone(DEFAULT_TEXT_HIERARCHY[market.id] ?? null),
    ...(market.id === BANNER3_MARKET.id ? { typography: 'outfit', keepBlueprintBoxes: true } : {}),
  };
}

/** Common proportions seed editable JSON. They never mutate existing revisions. */
export function createBlueprint(marketId, width, height) {
  const layout = BANNER3_LAYOUTS.find((l) => l.width === width && l.height === height);
  if (marketId === BANNER3_MARKET.id && layout) return createBanner3Blueprint(layout);
  if (marketId === BANNER3_MARKET.id) {
    const closest = [...BANNER3_LAYOUTS].sort(
      (a, b) =>
        Math.abs(Math.log(a.width / a.height / (width / height))) -
        Math.abs(Math.log(b.width / b.height / (width / height))),
    )[0];
    return duplicateForSize(createBanner3Blueprint(closest), marketId, width, height);
  }
  const id = sizeId(width, height),
    strip = width / height > 2.4,
    narrow = width < 220;
  const imageBelow = marketId === 'BANNER1';
  const layer = (id, type, x, y, w, h, props = {}) => ({
    id,
    name:
      {
        hero: 'Campaign image',
        logo: 'Logo',
        headline: 'Headline',
        subtitle: 'Offer / subtitle',
        cta: 'Call to action',
        legal: 'Market legal',
      }[id] || id,
    type,
    source: id,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: Math.round(h),
    ...props,
  });
  let layers;
  if (strip) {
    const legalHeight = height >= 80 ? 15 : 17;
    layers = [
      layer('hero', 'image', width * 0.64, 0, width * 0.36, height, {
        fadeDirection: 'left',
        fade: 0.6,
      }),
      layer('logo', 'logo', 8, 6, width * 0.17, height - 12, { stacked: true }),
      layer('headline', 'text', width * 0.23, 4, width * 0.53, height * 0.45, {
        fontSize: height * 0.25,
        minFontSize: 9,
        maxLines: 2,
      }),
      layer('subtitle', 'text', width * 0.23, height * 0.43, width * 0.51, height * 0.32, {
        fontSize: height * 0.22,
        minFontSize: 9,
        maxLines: 2,
      }),
      layer('cta', 'button', width * 0.28, height * 0.2, width * 0.36, height * 0.47, {
        fontSize: height * 0.23,
        minFontSize: 10,
        radius: 30,
        fill: '#ef1929',
      }),
      layer('legal', 'text', width * 0.22, height - legalHeight - 2, width * 0.76, legalHeight, {
        fontSize: 9,
        minFontSize: 7,
        maxLines: 2,
        fontWeight: 'normal',
        fill: '#bfc3cc',
        visible: id !== '300x50',
      }),
    ];
  } else if (height / width > 1.35) {
    layers = [
      layer('hero', 'image', 0, height * 0.55, width, height * 0.38, { fade: 0.33 }),
      layer(
        'logo',
        'logo',
        width * 0.15,
        height * 0.045,
        width * 0.7,
        height * (narrow ? 0.16 : 0.085),
        { stacked: narrow },
      ),
      layer(
        'headline',
        'text',
        width * 0.06,
        height * (narrow ? 0.235 : 0.175),
        width * 0.88,
        height * 0.145,
        { fontSize: width * 0.102, minFontSize: 14, maxLines: 3 },
      ),
      layer('subtitle', 'text', width * 0.06, height * 0.35, width * 0.88, height * 0.135, {
        fontSize: width * 0.112,
        minFontSize: 15,
        maxLines: 2,
      }),
      layer('cta', 'button', width * 0.12, height * 0.515, width * 0.76, height * 0.07, {
        fontSize: width * 0.065,
        minFontSize: 12,
        radius: 30,
        fill: '#ef1929',
      }),
      layer('legal', 'text', 8, height * 0.94, width - 16, height * 0.05, {
        fontSize: 10,
        minFontSize: 8,
        maxLines: 3,
        fontWeight: 'normal',
        fill: '#bfc3cc',
      }),
    ];
  } else {
    layers = [
      layer('hero', 'image', 0, imageBelow ? height * 0.39 : 0, width, height * 0.55, {
        fadeDirection: imageBelow ? 'top' : 'bottom',
        fade: 0.45,
      }),
      layer('logo', 'logo', width * 0.24, 10, width * 0.52, height * 0.13),
      layer(
        'headline',
        'text',
        width * 0.07,
        imageBelow ? height * 0.2 : height * 0.48,
        width * 0.86,
        height * 0.19,
        { fontSize: width * 0.07, minFontSize: 12, maxLines: 2 },
      ),
      layer(
        'subtitle',
        'text',
        width * 0.09,
        imageBelow ? height * 0.39 : height * 0.66,
        width * 0.82,
        height * 0.1,
        { fontSize: width * 0.062, minFontSize: 10, maxLines: 2 },
      ),
      layer(
        'cta',
        'button',
        width * 0.27,
        imageBelow ? height * 0.52 : height * 0.77,
        width * 0.46,
        height * 0.13,
        { fontSize: width * 0.049, minFontSize: 10, radius: 30, fill: '#ef1929' },
      ),
      layer('legal', 'text', 8, height * 0.895, width - 16, height * 0.095, {
        fontSize: 8,
        minFontSize: 7,
        maxLines: 3,
        fontWeight: 'normal',
        fill: '#bfc3cc',
      }),
    ];
  }
  if (!imageBelow && height / width > 1.35) {
    layers = layers.map((l) =>
      ['headline', 'subtitle'].includes(l.id)
        ? { ...l, align: 'left', x: width * 0.1, width: width * 0.8 }
        : l,
    );
  }
  const track = (visible) => ({ visible, startMs: 0, fadeInMs: 0, fadeOutMs: 0, dx: 0, dy: 0 });
  const scene = (name, durationMs, visible) => ({
    id: uid(),
    name,
    durationMs,
    transitionMs: 0,
    tracks: Object.fromEntries(layers.map((l) => [l.id, track(visible.includes(l.id))])),
  });
  let scenes;
  if (id === '320x50') {
    layers = layers.map((l) =>
      l.id === 'cta'
        ? { ...l, x: width * 0.22, width: width * 0.31, y: height * 0.27, height: height * 0.46 }
        : l.id === 'legal'
          ? { ...l, x: width * 0.55, y: 4, width: width * 0.43, height: height - 8 }
          : l.id === 'subtitle'
            ? { ...l, y: 8, height: height - 16 }
            : l,
    );
    scenes = [
      scene('Introduction', 2000, ['hero', 'logo', 'headline']),
      scene('The offer', 2000, ['hero', 'logo', 'subtitle']),
      scene('Action + legal', 1800, ['logo', 'cta', 'legal']),
    ];
  } else if (id === '300x100') {
    layers = layers.map((l) =>
      l.id === 'cta'
        ? { ...l, x: width * 0.44, y: height * 0.49, width: width * 0.41, height: height * 0.24 }
        : l.id === 'headline' || l.id === 'subtitle'
          ? {
              ...l,
              x: width * 0.33,
              y: 7,
              width: width * 0.64,
              height: height * 0.36,
              fontSize: 16,
            }
          : l.id === 'hero'
            ? {
                ...l,
                x: 0,
                y: height * 0.3,
                width: width * 0.43,
                height: height * 0.7,
                fadeDirection: 'right',
              }
            : l,
    );
    scenes = [
      scene('Introduction', 2000, ['hero', 'logo', 'headline', 'cta', 'legal']),
      scene('The offer', 1800, ['hero', 'logo', 'subtitle', 'cta', 'legal']),
    ];
  } else if (id === '728x90')
    scenes = [
      scene('Introduction + offer', 3000, ['hero', 'logo', 'headline', 'subtitle', 'legal']),
      scene('Call to action', 1800, ['hero', 'logo', 'cta', 'legal']),
    ];
  else
    scenes = [
      scene(
        'Artwork',
        3000,
        layers.filter((l) => id !== '300x50' || l.id !== 'cta').map((l) => l.id),
      ),
    ];
  layers = layers.map((l) => ({ ...l, fontSize: Math.max(l.fontSize ?? 24, l.minFontSize ?? 10) }));
  const blueprint = validateBlueprint({
    schemaVersion: 1,
    id: `${marketId}-${id}`,
    marketId,
    name: id,
    width,
    height,
    mode: scenes.length > 1 ? 'animated' : 'static',
    repeat: 0,
    background: '#070d1d',
    layers,
    scenes,
  });
  // Fresh wide templates use the space available in each part, without forcing
  // portrait campaign line breaks onto a leaderboard. Saved revisions are untouched.
  if (id === '320x50' || id === '728x90' || id === '300x100') {
    for (const textId of ['headline', 'subtitle']) {
      const result = suggestTextLayout(blueprint, textId);
      if (result.patch)
        blueprint.layers = blueprint.layers.map((l) =>
          l.id === textId ? { ...l, ...result.patch } : l,
        );
    }
  }
  return validateBlueprint(splitTallHeadline(correctBlueprintLayout(blueprint)));
}
export function newEntry(bp) {
  const revision = {
    id: uid(),
    number: 1,
    status: 'draft',
    createdAt: new Date().toISOString(),
    blueprint: bp,
  };
  return {
    id: bp.id,
    marketId: bp.marketId,
    ...(isMeasuredLayout(bp) ? { measured: true } : {}),
    activeVersionId: revision.id,
    versions: [revision],
    draft: null,
  };
}
export const activeRevision = (entry) => entry.versions.find((v) => v.id === entry.activeVersionId);
export function duplicateForSize(source, marketId, width, height) {
  const x = width / source.width,
    y = height / source.height,
    f = Math.min(x, y),
    bp = structuredClone(source);
  bp.id = `${marketId}-${sizeId(width, height)}`;
  bp.name = sizeId(width, height);
  bp.marketId = marketId;
  bp.width = width;
  bp.height = height;
  bp.layers = bp.layers.map((l) => ({
    ...l,
    x: l.x * x,
    y: l.y * y,
    width: Math.max(1, l.width * x),
    height: Math.max(1, l.height * y),
    fontSize: Math.max(1, Math.min(500, l.fontSize * f)),
    minFontSize: Math.max(1, Math.min(500, l.minFontSize * f)),
    radius: Math.min(500, l.radius * f),
    textPaddingX: Math.min(500, (l.textPaddingX ?? 6) * x),
    textPaddingY: Math.min(500, (l.textPaddingY ?? 2) * y),
    ...(l.glow ? { glow: { ...l.glow, blur: Math.min(40, l.glow.blur * f) } } : {}),
    ...(l.shadow
      ? {
          shadow: {
            ...l.shadow,
            blur: Math.min(40, l.shadow.blur * f),
            offsetX: Math.max(-100, Math.min(100, l.shadow.offsetX * x)),
            offsetY: Math.max(-100, Math.min(100, l.shadow.offsetY * y)),
          },
        }
      : {}),
  }));
  bp.scenes = bp.scenes.map((s) => ({
    ...s,
    id: uid(),
    tracks: Object.fromEntries(
      Object.entries(s.tracks).map(([id, t]) => [
        id,
        { ...t, dx: (t.dx || 0) * x, dy: (t.dy || 0) * y },
      ]),
    ),
  }));
  return validateBlueprint(bp);
}
export function resolveBanner(entry, banner) {
  return reserveLegalFooter(
    banner?.arrangement ||
      banner?.override ||
      (entry.versions.find((v) => v.id === banner?.blueprintVersionId) || activeRevision(entry))
        .blueprint,
  );
}
export function initialProject() {
  const blueprints = DEFAULT_MARKETS.flatMap((m) =>
      m.id === BANNER3_MARKET.id
        ? BANNER3_LAYOUTS.map((l) => newEntry(createBanner3Blueprint(l)))
        : PRESETS.slice(0, 8).map(([w, h]) => newEntry(createBlueprint(m.id, w, h))),
    ),
    campaigns = Object.fromEntries(DEFAULT_MARKETS.map((m) => [m.id, campaignFor(m)]));
  return {
    schemaVersion: 1,
    markets: DEFAULT_MARKETS,
    campaigns,
    blueprints,
    assets: [],
    banners: Object.fromEntries(
      blueprints.map((b) => [
        b.id,
        {
          blueprintVersionId: b.activeVersionId,
          override: null,
          history: [],
          layoutKey: layoutKey(campaigns[b.marketId]),
        },
      ]),
    ),
  };
}

/** Add the bundled markets and Banner 3 sizes a saved workspace lacks; never overwrite saved work. */
export function addMissingMarketSizes(project) {
  const missing = BANNER3_LAYOUTS.filter(
    (l) =>
      !project.blueprints.some((e) => {
        const bp = activeRevision(e).blueprint;
        return e.marketId === BANNER3_MARKET.id && bp.width === l.width && bp.height === l.height;
      }),
  );
  const hasMarket = project.markets.some((m) => m.id === BANNER3_MARKET.id);
  if (hasMarket && !missing.length) return project;
  const campaign = project.campaigns[BANNER3_MARKET.id] || campaignFor(BANNER3_MARKET);
  const entries = missing.map((l) => newEntry(createBanner3Blueprint(l)));
  return {
    ...project,
    markets: hasMarket ? project.markets : [...project.markets, BANNER3_MARKET],
    campaigns: { ...project.campaigns, [BANNER3_MARKET.id]: campaign },
    blueprints: [...project.blueprints, ...entries],
    banners: {
      ...project.banners,
      ...Object.fromEntries(
        entries.map((entry) => [
          entry.id,
          {
            blueprintVersionId: entry.activeVersionId,
            override: null,
            history: [],
            layoutKey: layoutKey(campaign),
          },
        ]),
      ),
    },
  };
}
