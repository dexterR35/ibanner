import { digest } from './generation/fingerprint.js';
import { ResourceCache } from './resource-cache.js';
import { inspectImageHeader } from './generation/media-contract.js';
import {
  activeVariants,
  heroUpscaleSchema,
  heroExtendSchema,
  heroCutoutSchema,
} from './hero-variants.js';
import { outputLimitSchema } from '../data/output-limits.js';
import { ENGINE_VERSION, ITEM_STATES } from './generation/engine.js';
import { validateFlow } from './generation/flow.js';
import { get, set } from 'idb-keyval';
import { validateBlueprint } from './schema.js';
import { layoutKey } from './auto-layout.js';
import { subjectSearchSchema, subjectFocusSchema } from './subject-data.js';
import { photoAnalysisSchema } from './photo-analysis.js';
import { DEFAULT_TEXT_HIERARCHY, textHierarchySchema } from '../data/text-hierarchy.js';
import { loadOutfit } from './outfit-font.js';
const KEY = 'bannerflow-project-v1';
export const loadProject = () => get(KEY);
export const saveProject = (project) => set(KEY, project);
export const getAsset = (id) => get(`asset:${id}`);
export async function putAsset(id, blob) {
  if ((await digest(await blob.arrayBuffer())) !== id)
    throw new Error('Asset hash does not match its original bytes.');
  const existing = await getAsset(id);
  if (existing && (await digest(await existing.arrayBuffer())) === id) return;
  // A verified backup can repair corrupt local bytes without changing source identity.
  await set(`asset:${id}`, blob);
}
export async function storeAsset(file, kind) {
  if (file.size > 30 * 1024 * 1024) throw new Error('Use a file smaller than 30 MB.');
  if (kind === 'font' && !/\.(woff2?|ttf|otf)$/i.test(file.name))
    throw new Error('Choose a WOFF, WOFF2, TTF or OTF font.');
  if (
    kind !== 'font' &&
    !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(file.type)
  )
    throw new Error('Choose PNG, JPEG, WebP or SVG.');
  const bytes = await file.arrayBuffer(),
    hash = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  // Decode before persistence so broken assets never become campaign bindings.
  let width, height, sourceMedia;
  if (kind !== 'font') {
    sourceMedia = inspectImageHeader(bytes, file.type);
    const url = URL.createObjectURL(file);
    try {
      const im = await imageFrom(url);
      width = im.width;
      height = im.height;
      if (width * height > 40_000_000) throw new Error('Image exceeds the 40 megapixel limit.');
    } finally {
      URL.revokeObjectURL(url);
    }
  } else {
    const font = new FontFace(`Brand-${id.slice(0, 10)}`, bytes);
    await font.load();
  }
  await putAsset(id, file);
  return {
    id,
    name: file.name,
    kind,
    type: file.type,
    bytes: file.size,
    width,
    height,
    sourceMedia,
    coordinateSpace: 'normalized-oriented-source',
    provenance: kind === 'derived' ? 'generated-derivative' : 'campaign-original',
    createdAt: new Date().toISOString(),
  };
}
export async function storeDerivedAsset(blob, metadata) {
  if (!/^[a-f0-9]{64}$/.test(metadata.derivedFrom) || !(await getAsset(metadata.derivedFrom)))
    throw new Error('Derived image source is missing.');
  if (!['cutout', 'extend', 'upscale', 'frame'].includes(metadata.operation))
    throw new Error('Unsupported derivative recipe.');
  const asset = await storeAsset(new File([blob], metadata.name, { type: blob.type }), 'derived');
  return { ...asset, ...metadata };
}
export function imageFrom(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Image could not be decoded.'));
    im.src = url;
  });
}
const images = new ResourceCache(),
  fonts = new Map();
async function assetImage(id) {
  return images.get(id, async () => {
    const blob = await getAsset(id);
    if (!blob) throw new Error('An original asset is missing from local storage.');
    const url = URL.createObjectURL(blob);
    try {
      return await imageFrom(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}
export async function loadResources(campaign) {
  const variants = activeVariants(campaign);
  // Banners start from scratch: no photo or logo until the campaign uploads its own.
  const heroSource = campaign.heroAssetId ? await assetImage(campaign.heroAssetId) : null;
  const hero =
    heroSource && variants.upscale ? await assetImage(variants.upscale.assetId) : heroSource;
  const heroWide = variants.wide
    ? { image: await assetImage(variants.wide.assetId), frame: variants.wide.frame }
    : null;
  const heroTall = variants.tall
    ? { image: await assetImage(variants.tall.assetId), frame: variants.tall.frame }
    : null;
  const cutout = variants.cutout
    ? { image: await assetImage(variants.cutout.assetId), box: variants.cutout.box }
    : null;
  const logo = campaign.logoAssetId ? await assetImage(campaign.logoAssetId) : null;
  let fontFamily = null;
  if (campaign.typography === 'outfit') {
    fontFamily = await loadOutfit();
  } else if (campaign.fontAssetId) {
    fontFamily = `Brand-${campaign.fontAssetId.slice(0, 10)}`;
    if (!fonts.has(fontFamily)) {
      const blob = await getAsset(campaign.fontAssetId);
      if (!blob) throw new Error('Font asset is missing.');
      const font = new FontFace(fontFamily, await blob.arrayBuffer());
      await font.load();
      document.fonts.add(font);
      fonts.set(fontFamily, font);
    }
  }
  return {
    hero,
    heroSource,
    heroWide,
    heroTall,
    cutout,
    heroCrop: null,
    logo,
    fontFamily,
    typography: campaign.typography || 'original',
  };
}
export function validateProject(value) {
  if (
    value?.schemaVersion !== 1 ||
    !Array.isArray(value.markets) ||
    !Array.isArray(value.blueprints) ||
    !Array.isArray(value.assets) ||
    !value.campaigns ||
    !value.banners
  )
    throw new Error('Unsupported project file.');
  if (value.lineSpacingVersion != null && value.lineSpacingVersion !== 1)
    throw new Error('Unsupported line spacing migration.');
  const unique = (values, label) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} identities.`);
  };
  if (
    !value.markets.length ||
    value.markets.length > 100 ||
    value.blueprints.length > 2000 ||
    value.assets.length > 500
  )
    throw new Error('Project size is outside the supported limits.');
  unique(
    value.markets.map((m) => m.id),
    'market',
  );
  unique(
    value.blueprints.map((e) => e.id),
    'blueprint',
  );
  unique(
    value.assets.map((a) => a.id),
    'asset',
  );
  for (const market of value.markets)
    if (
      !/^[A-Z0-9-]{2,8}$/.test(market.id) ||
      typeof market.name !== 'string' ||
      typeof market.locale !== 'string'
    )
      throw new Error('Invalid market metadata.');
  for (const asset of value.assets)
    if (
      !/^[a-f0-9]{64}$/.test(asset.id) ||
      !['hero', 'logo', 'font', 'derived', 'media'].includes(asset.kind) ||
      (asset.kind === 'derived' &&
        (!value.assets.some((a) => a.id === asset.derivedFrom) ||
          !['cutout', 'extend', 'upscale', 'frame'].includes(asset.operation))) ||
      typeof asset.name !== 'string' ||
      typeof asset.type !== 'string'
    )
      throw new Error('Invalid asset metadata.');
  for (const entry of value.blueprints) {
    if (!entry.versions?.length || !entry.versions.some((v) => v.id === entry.activeVersionId))
      throw new Error('Blueprint revision history is incomplete.');
    if (!value.markets.some((m) => m.id === entry.marketId))
      throw new Error('Blueprint points to an unknown market.');
    unique(
      entry.versions.map((v) => v.id),
      'revision',
    );
    entry.versions.forEach((v) => {
      v.blueprint = validateBlueprint(v.blueprint);
      if (
        v.blueprint.id !== entry.id ||
        v.blueprint.marketId !== entry.marketId ||
        !['draft', 'published', 'archived'].includes(v.status) ||
        !Number.isInteger(v.number) ||
        v.number < 1
      )
        throw new Error('Invalid revision identity or status.');
    });
    if (entry.draft) entry.draft = validateBlueprint(entry.draft);
    const banner = value.banners[entry.id];
    if (
      !banner ||
      !entry.versions.some((v) => v.id === banner.blueprintVersionId) ||
      !Array.isArray(banner.history)
    )
      throw new Error('Generated banner revision is missing.');
    if (banner.override) {
      banner.override = validateBlueprint(banner.override);
      const original = entry.versions.find((v) => v.id === banner.blueprintVersionId).blueprint;
      if (
        banner.override.id !== entry.id ||
        banner.override.width !== original.width ||
        banner.override.height !== original.height
      )
        throw new Error('Override identity does not match its blueprint.');
    }
    if (banner.arrangement) {
      banner.arrangement = validateBlueprint(banner.arrangement);
      const original = entry.versions.find((v) => v.id === banner.blueprintVersionId).blueprint;
      if (
        banner.arrangement.id !== entry.id ||
        banner.arrangement.marketId !== entry.marketId ||
        banner.arrangement.width !== original.width ||
        banner.arrangement.height !== original.height
      )
        throw new Error('Arranged layout identity does not match its blueprint.');
    }
    if (banner.layoutKey != null && typeof banner.layoutKey !== 'string')
      throw new Error('Invalid arranged layout content key.');
    // The geometry the AI arrangement chose; later automatic passes start from it.
    if (banner.aiLayout != null) {
      const ai = banner.aiLayout;
      const original = entry.versions.find((v) => v.id === banner.blueprintVersionId).blueprint;
      if (
        typeof ai !== 'object' ||
        !['design', 'reference', 'qwen', 'qwen+reference-photo'].includes(ai.source) ||
        typeof ai.createdAt !== 'string' ||
        ai.createdAt.length > 40 ||
        !entry.versions.some((v) => v.id === ai.versionId)
      )
        throw new Error('Invalid AI layout.');
      ai.blueprint = validateBlueprint(ai.blueprint);
      if (
        ai.blueprint.id !== entry.id ||
        ai.blueprint.width !== original.width ||
        ai.blueprint.height !== original.height
      )
        throw new Error('AI layout identity does not match its blueprint.');
    }
    if (
      banner.syncedBlueprintVersionId != null &&
      !entry.versions.some((v) => v.id === banner.syncedBlueprintVersionId)
    )
      throw new Error('Synchronized blueprint revision is missing.');
    for (const revision of banner.history) {
      revision.blueprint = validateBlueprint(revision.blueprint);
      if (revision.blueprint.id !== entry.id)
        throw new Error('Override history contains an unrelated blueprint.');
    }
  }
  for (const market of value.markets) {
    const c = value.campaigns[market.id];
    if (
      !c ||
      !['name', 'headline', 'subtitle', 'cta', 'legal', 'accentWord', 'accentColor'].every(
        (k) => typeof c[k] === 'string',
      ) ||
      !/^#[0-9a-f]{6}$/i.test(c.accentColor)
    )
      throw new Error('Campaign fields are incomplete.');
    for (const kind of ['hero', 'logo', 'font'])
      if (c[`${kind}AssetId`] && !value.assets.some((a) => a.id === c[`${kind}AssetId`]))
        throw new Error(`Missing ${kind} asset binding.`);
    if (c.autoArrange != null && typeof c.autoArrange !== 'boolean')
      throw new Error('Invalid automatic layout setting.');
    if (c.imageFadeEnabled != null && typeof c.imageFadeEnabled !== 'boolean')
      throw new Error('Invalid image fade setting.');
    if (c.typography != null && !['original', 'outfit'].includes(c.typography))
      throw new Error('Invalid campaign typography.');
    for (const [key, schema] of Object.entries({
      heroUpscale: heroUpscaleSchema,
      heroExtendWide: heroExtendSchema,
      heroExtendTall: heroExtendSchema,
      heroCutout: heroCutoutSchema,
    })) {
      if (!c[key]) continue;
      c[key] = schema.parse(c[key]);
      if (
        ![c[key].assetId, c[key].sourceAssetId].every((id) => value.assets.some((a) => a.id === id))
      )
        throw new Error('Missing generated image binding.');
    }
    for (const key of ['subjectInFront', 'autoReadability', 'autoImageTools'])
      if (c[key] != null && typeof c[key] !== 'boolean')
        throw new Error('Invalid automatic image setting.');
    if (c.ctaColor != null && !/^#[a-f0-9]{6}$/i.test(c.ctaColor))
      throw new Error('Invalid CTA color.');
    if (c.copyFits != null) {
      // Shorter copy approved per size (e.g. "728x90"); legal copy is never shortened.
      if (typeof c.copyFits !== 'object' || Array.isArray(c.copyFits))
        throw new Error('Invalid approved copy.');
      for (const [size, fits] of Object.entries(c.copyFits))
        if (
          !/^\d{2,4}x\d{2,4}$/.test(size) ||
          !fits ||
          typeof fits !== 'object' ||
          Object.entries(fits).some(
            ([role, text]) =>
              !['headline', 'subtitle', 'cta'].includes(role) ||
              typeof text !== 'string' ||
              text.length > 2000,
          )
        )
          throw new Error('Invalid approved copy.');
    }
    if (c.outputLimit) c.outputLimit = outputLimitSchema.parse(c.outputLimit);
    // Projects saved before hierarchy rules existed receive the market default once.
    if (c.textHierarchy === undefined)
      c.textHierarchy = structuredClone(DEFAULT_TEXT_HIERARCHY[market.id] ?? null);
    if (c.textHierarchy) c.textHierarchy = textHierarchySchema.parse(c.textHierarchy);
    c.autoArrange ??= true;
    if (c.keepBlueprintBoxes != null && typeof c.keepBlueprintBoxes !== 'boolean')
      throw new Error('Invalid blueprint box setting.');
    if (c.autoSubject != null && typeof c.autoSubject !== 'boolean')
      throw new Error('Invalid automatic subject setting.');
    if (
      c.subjectEngine != null &&
      !['auto', 'browser', 'sam3', 'florence'].includes(c.subjectEngine)
    )
      throw new Error('Invalid subject finder engine.');
    // Migrate provider preferences without relabelling historical detection evidence.
    c.subjectEngine = 'florence';
    if (
      c.subjectQuery != null &&
      (typeof c.subjectQuery !== 'string' || c.subjectQuery.length > 160)
    )
      throw new Error('Invalid subject search.');
    if (c.photoAnalysis) c.photoAnalysis = photoAnalysisSchema.parse(c.photoAnalysis);
    if (c.subjectSearch) c.subjectSearch = subjectSearchSchema.parse(c.subjectSearch);
    if (c.subjectFocus) c.subjectFocus = subjectFocusSchema.parse(c.subjectFocus);
    if ([c.subjectSearch, c.subjectFocus].some((item) => item && item.assetId !== c.heroAssetId))
      throw new Error('Subject focus does not match the campaign image.');
  }
  if (value.generationFlows != null) {
    if (
      typeof value.generationFlows !== 'object' ||
      Array.isArray(value.generationFlows) ||
      Object.keys(value.generationFlows).length > 100
    )
      throw new Error('Invalid saved generation flows.');
    for (const [marketId, flow] of Object.entries(value.generationFlows)) {
      if (!value.markets.some((market) => market.id === marketId))
        throw new Error('Invalid generation flow market.');
      value.generationFlows[marketId] = validateFlow(flow);
    }
  }
  if (value.generationBatches != null) {
    if (!Array.isArray(value.generationBatches) || value.generationBatches.length > 20)
      throw new Error('Invalid generation history.');
    // Batches from the removed strict compose/validator engine are regenerable history.
    const kept = value.generationBatches.filter((b) => b?.snapshot?.engine === ENGINE_VERSION);
    if (kept.length !== value.generationBatches.length) {
      const ids = new Set(kept.map((b) => b.id));
      value.generationBatches = kept;
      if (Array.isArray(value.generationRuns))
        value.generationRuns = value.generationRuns.filter((r) =>
          (r?.batchIds || []).every((id) => ids.has(id)),
        );
    }
    for (const batch of value.generationBatches) {
      if (
        !/^[a-f0-9]{64}$/.test(batch.id) ||
        !value.markets.some((m) => m.id === batch.snapshot?.market?.id) ||
        !Array.isArray(batch.items) ||
        batch.items.length > 100
      )
        throw new Error('Invalid generation batch.');
      if (
        !Array.isArray(batch.snapshot.targets) ||
        batch.snapshot.targets.length !== batch.items.length
      )
        throw new Error('Incomplete target matrix.');
      if (batch.workflow != null) {
        batch.workflow = validateFlow(batch.workflow);
        if (
          !Array.isArray(batch.outputNodeIds) ||
          batch.outputNodeIds.length !== batch.items.length ||
          batch.outputNodeIds.some(
            (id) => !batch.workflow.nodes.some((node) => node.id === id && node.kind === 'output'),
          )
        )
          throw new Error('Invalid generation graph snapshot.');
      }
      for (const kind of ['hero', 'logo', 'font'])
        if (
          batch.snapshot.campaign[`${kind}AssetId`] &&
          !value.assets.some((a) => a.id === batch.snapshot.campaign[`${kind}AssetId`])
        )
          throw new Error('Missing frozen campaign asset.');
      if (
        !Array.isArray(batch.snapshot.bases) ||
        batch.snapshot.bases.length !== batch.items.length ||
        !Array.isArray(batch.snapshot.references) ||
        batch.snapshot.references.length !== batch.items.length
      )
        throw new Error('Incomplete generation snapshot.');
      batch.snapshot.bases = batch.snapshot.bases.map((bp) => validateBlueprint(bp));
      batch.snapshot.references = batch.snapshot.references.map((list) => {
        if (!Array.isArray(list) || list.length > 10)
          throw new Error('Invalid reference examples.');
        return list.map((bp) => validateBlueprint(bp));
      });
      for (const item of batch.items) {
        if (!ITEM_STATES.includes(item.state)) throw new Error('Invalid target status.');
        if (item.state === 'succeeded' && !item.scene)
          throw new Error('Missing successful layout.');
        if (item.scene) {
          item.scene = validateBlueprint(item.scene);
          if (
            item.scene.width !== item.target.width ||
            item.scene.height !== item.target.height ||
            item.scene.marketId !== batch.snapshot.market.id
          )
            throw new Error('Generated target identity mismatch.');
        }
      }
    }
  }
  if (
    value.generationRuns != null &&
    (!Array.isArray(value.generationRuns) ||
      value.generationRuns.length > 20 ||
      value.generationRuns.some(
        (r) =>
          !value.markets.some((m) => m.id === r.ownerMarketId) ||
          !Array.isArray(r.batchIds) ||
          r.batchIds.length > 100 ||
          r.batchIds.some((id) => !/^[a-f0-9]{64}$/.test(id)),
      ))
  )
    throw new Error('Invalid market generation matrix.');
  if (value.generationUndo) {
    if (!Array.isArray(value.generationUndo.accepted) || value.generationUndo.accepted.length > 100)
      throw new Error('Invalid generation undo.');
    for (const item of value.generationUndo.accepted)
      for (const banner of [item.before, item.after].filter(Boolean)) {
        if (banner.override) validateBlueprint(banner.override);
        if (banner.arrangement) validateBlueprint(banner.arrangement);
        for (const revision of banner.history || []) validateBlueprint(revision.blueprint);
      }
  }
  // Older workspaces retain their saved appearance until the next content edit or manual arrange.
  if (value.consolidatedReferences != null) {
    if (!Array.isArray(value.consolidatedReferences) || value.consolidatedReferences.length > 2000)
      throw new Error('Invalid consolidated reference archive.');
    for (const archived of value.consolidatedReferences) {
      if (!archived?.entry || !archived.banner || typeof archived.retainedEntryId !== 'string')
        throw new Error('Invalid consolidated reference snapshot.');
      validateProject({
        ...value,
        consolidatedReferences: undefined,
        blueprints: [archived.entry],
        banners: { [archived.entry.id]: archived.banner },
      });
    }
  }
  // Reference reads were a short-lived experiment; they are not part of the contract.
  delete value.referenceReads;
  for (const entry of value.blueprints)
    if (!('layoutKey' in value.banners[entry.id]))
      value.banners[entry.id].layoutKey = layoutKey(value.campaigns[entry.marketId]);
  return value;
}
