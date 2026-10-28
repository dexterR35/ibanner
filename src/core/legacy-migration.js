// Workspaces saved before 29 October 2026 used older market IDs and names, linked bundled
// example images and shipped brand starter copy and offers. This rewrites them once, before
// validation, to the neutral markets BANNER1, BANNER2 and BANNER3. Copy the user wrote is kept,
// apart from the old operator licence number.

// Old names are stored only as FNV-1a hashes (see `fnv` below), never as text.
// ids: old market id token -> new token. logos: "<word> logo" layer names -> "Logo".
// keys: words that mark a stale cached layout key (matched on a word or its first 6 letters).
// markets: old market IDs (exact values, or the prefix of "<ID>-<W>x<H>" / "<ID>:<W>x<H>"
// banner keys) -> new IDs. names: old market names -> new names.
export const OLD_TERMS = {
  ids: { '8fcf3aab': 'BANNER3', '1e0782eb': 'Banner 3', '30ac45cb': 'banner3' },
  logos: ['afd75f9f', '1e0782eb'],
  keys: ['30ac45cb', 'cc4e7d1f'],
  markets: { '7bd35f50': 'BANNER1', '7df3b621': 'BANNER2', '7d7a9d67': 'BANNER3' },
  names: { '4fd0e643': 'Banner 1', '710317c3': 'Banner 2', '74b7cca7': 'Banner 3' },
};
const OLD_LOCALES = ['dfc3322e', '9933e50c'];
const FLAGS = { BANNER1: 'B1', BANNER2: 'B2', BANNER3: 'B3' };

// FNV-1a hashes of the old shipped starter values, so the old copy is not kept in source.
// A field is reset only while it still equals one of them exactly.
const SHIPPED = {
  name: ['bd5646bd', 'b2114c54', '20138132', '342ab2b2', '4260c796'],
  headline: ['86fb225c', 'bf623b3a', 'e924b24d'],
  subtitle: ['723de43e', 'ecdf6321', 'ce2661dc'],
  cta: ['e8824e86', '57ca8353'],
  legal: ['39f879bf', 'fb19e7b1'],
};
// The old operator's licence number, removed from any legal line as one "|" segment.
const OLD_LICENCE = ['532d969f'];
// Old Banner 3 GIF part names named a casino offer; parts are now Headline and Offer.
const PART_NAMES = { 'Free spins': 'Offer', 'Offer + free spins': 'Headline + offer' };
const COPY = ['headline', 'subtitle', 'cta'];

/** FNV-1a, 32-bit, as 8 hex digits. */
export const fnv = (text) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
};
const ID_TOKEN = /[A-Za-z]+\d+/g;
const LOGO_NAME = /\b([A-Za-z]+\d*) logo\b/g;
const WORD = /[A-Za-z]+\d*/g;
const renamed = (text, terms) =>
  text
    .replace(LOGO_NAME, (all, word) => (terms.logos.includes(fnv(word)) ? 'Logo' : all))
    .replace(ID_TOKEN, (token) => terms.ids[fnv(token)] ?? token);
const staleKey = (key, terms) =>
  typeof key === 'string' &&
  (key.match(WORD) || []).some((w) => {
    const lower = w.toLowerCase();
    return terms.keys.includes(fnv(lower)) || terms.keys.includes(fnv(lower.slice(0, 6)));
  });
const SIZED_KEY = /^([A-Z0-9]+)([-:]\d+x\d+.*)$/s;
const renameId = (value, markets) => {
  if (typeof value !== 'string') return value;
  const exact = markets[fnv(value)];
  if (exact) return exact;
  const sized = SIZED_KEY.exec(value);
  const prefix = sized && markets[fnv(sized[1])];
  return prefix ? prefix + sized[2] : value;
};
/** Renames old market IDs in values and keys anywhere in the project; returns true if any. */
function renameMarkets(value, markets) {
  let changed = false;
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      if (typeof item === 'string') {
        const next = renameId(item, markets);
        if (next !== item) ((value[i] = next), (changed = true));
      } else if (renameMarkets(item, markets)) changed = true;
    });
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (typeof item === 'string') {
        const next = renameId(item, markets);
        if (next !== item) ((value[key] = next), (changed = true));
      } else if (renameMarkets(item, markets)) changed = true;
      const newKey = renameId(key, markets);
      if (newKey !== key) {
        value[newKey] = value[key];
        delete value[key];
        changed = true;
      }
    }
  }
  return changed;
}
const shipped = (field, value) => typeof value === 'string' && SHIPPED[field].includes(fnv(value));
const licenced = (legal) =>
  typeof legal === 'string' && legal.split('|').some((s) => OLD_LICENCE.includes(fnv(s.trim())));
const withoutLicence = (legal) =>
  legal
    .split('|')
    .filter((s) => !OLD_LICENCE.includes(fnv(s.trim())))
    .join('|')
    .replace(/\s*\|\s*$/, '')
    .trimEnd();
const oldParts = (scenes) => Array.isArray(scenes) && scenes.some((s) => s?.name in PART_NAMES);
const starterFor = (project, marketId, starterCampaign) => {
  const market = (project.markets || []).find((m) => m.id === marketId);
  return starterCampaign?.(market || { id: marketId, name: marketId, legal: '' });
};
// Approved shorter copy is stale once its field holds the untouched starter placeholder.
const staleFits = (campaign, starter) =>
  COPY.filter(
    (field) =>
      starter &&
      campaign[field] === starter[field] &&
      Object.values(campaign.copyFits || {}).some((fits) => fits && field in fits),
  );

/** No uploads, approved copy fits, edits, drafts or later revisions in this market. */
const untouchedMarket = (project, id) => {
  const c = project.campaigns?.[id] || {};
  if (c.heroAssetId || c.logoAssetId || c.fontAssetId) return false;
  if (c.copyFits && Object.keys(c.copyFits).length) return false;
  return (project.blueprints || [])
    .filter((e) => e.marketId === id)
    .every((e) => {
      const banner = project.banners?.[e.id];
      return (
        e.versions.length === 1 &&
        !e.draft &&
        (!banner || (!banner.override && !(banner.history || []).length))
      );
    });
};
const dropMarket = (project, id) => {
  const entries = new Set(
    (project.blueprints || []).filter((e) => e.marketId === id).map((e) => e.id),
  );
  project.markets = project.markets.filter((m) => m.id !== id);
  delete project.campaigns?.[id];
  project.blueprints = (project.blueprints || []).filter((e) => e.marketId !== id);
  for (const entryId of entries) delete project.banners?.[entryId];
};

/** Every object with a `scenes` array (revisions, drafts, overrides, history, snapshots). */
function eachTimeline(value, visit) {
  if (Array.isArray(value)) for (const item of value) eachTimeline(item, visit);
  else if (value && typeof value === 'object') {
    if (Array.isArray(value.scenes)) visit(value);
    for (const item of Object.values(value)) eachTimeline(item, visit);
  }
}

/**
 * Returns the project unchanged when it has nothing to migrate. `terms` defaults to the hashed
 * old names; tests pass their own table so they never need the old names either.
 */
export function migrateLegacyProject(project, starterCampaign, terms = OLD_TERMS) {
  if (!project || typeof project !== 'object') return project;
  let text = JSON.stringify(project);
  let timelines = false;
  eachTimeline(project, (bp) => (timelines ||= oldParts(bp.scenes)));
  const legacy =
    timelines ||
    renameMarkets(structuredClone(project), terms.markets) ||
    renamed(text, terms) !== text ||
    /"referencePack":|"resourcePreset":/.test(text) ||
    (project.blueprints || []).some((e) => 'reference' in e || 'references' in e) ||
    (project.markets || []).some((m) => shipped('legal', m.legal) || licenced(m.legal)) ||
    Object.entries(project.campaigns || {}).some(
      ([id, c]) =>
        Object.keys(SHIPPED).some((field) => shipped(field, c[field])) ||
        licenced(c.legal) ||
        staleFits(c, starterFor(project, id, starterCampaign)).length > 0,
    ) ||
    Object.values(project.banners || {}).some((b) => staleKey(b?.layoutKey, terms));
  if (!legacy) return project;
  text = renamed(text, terms);
  // Bundled example crops are gone; layouts never depended on them.
  text = text
    .replace(/"resourcePreset":"[^"]*",/g, '')
    .replace(/,"resourcePreset":"[^"]*"(?=})/g, '');
  const next = JSON.parse(text);
  // A newer build may already have added an untouched market under the new ID next to the
  // old one. Drop that copy so the user's market takes the ID; otherwise keep the old ID.
  const markets = { ...terms.markets };
  for (const market of [...(next.markets || [])]) {
    const target = markets[fnv(String(market.id))];
    if (!target || !next.markets.some((m) => m.id === target)) continue;
    if (untouchedMarket(next, target)) dropMarket(next, target);
    else delete markets[fnv(String(market.id))];
  }
  renameMarkets(next, markets);
  for (const market of next.markets || []) {
    market.name = terms.names[fnv(String(market.name))] ?? market.name;
    if (OLD_LOCALES.includes(fnv(String(market.locale)))) market.locale = 'en';
    if (FLAGS[market.id]) market.flag = FLAGS[market.id];
  }
  // A linked example image meant the layout was measured from a finished design.
  const unlink = (entry) => {
    if (!entry) return;
    if (entry.reference || entry.references?.length) entry.measured = true;
    delete entry.reference;
    delete entry.references;
  };
  for (const entry of next.blueprints || []) unlink(entry);
  for (const archived of next.consolidatedReferences || []) unlink(archived.entry);
  // Part 1 of an old offer sequence showed the headline; the old "free spins" part is the offer.
  eachTimeline(next, (bp) => {
    if (!oldParts(bp.scenes)) return;
    for (const scene of bp.scenes)
      scene.name = PART_NAMES[scene.name] ?? (scene.name === 'Offer' ? 'Headline' : scene.name);
  });
  // Layout keys cache the old campaign values; a fresh key re-arranges each banner once.
  for (const banner of Object.values(next.banners || {}))
    if (banner && typeof banner.layoutKey === 'string') banner.layoutKey = 'migrated';
  for (const market of next.markets || []) {
    if (shipped('legal', market.legal)) {
      market.legal = '';
      market.legalStatus = 'missing';
    } else if (licenced(market.legal)) market.legal = withoutLicence(market.legal);
  }
  for (const [marketId, campaign] of Object.entries(next.campaigns || {})) {
    delete campaign.referencePack;
    const starter = starterFor(next, marketId, starterCampaign);
    const reset = Object.keys(SHIPPED).filter((field) => shipped(field, campaign[field]));
    for (const field of reset) campaign[field] = starter?.[field] ?? '';
    if (licenced(campaign.legal)) campaign.legal = withoutLicence(campaign.legal);
    // Approved shorter copy per size was derived from the replaced copy.
    const stale = [...new Set([...reset, ...staleFits(campaign, starter)])];
    if (campaign.copyFits && typeof campaign.copyFits === 'object') {
      for (const [size, fits] of Object.entries(campaign.copyFits)) {
        for (const field of stale) delete fits?.[field];
        if (!fits || !Object.keys(fits).length) delete campaign.copyFits[size];
      }
      if (!Object.keys(campaign.copyFits).length) delete campaign.copyFits;
    }
  }
  return next;
}
