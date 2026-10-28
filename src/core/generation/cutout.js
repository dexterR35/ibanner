import { getAsset, storeDerivedAsset } from '../storage.js';
import { activeVariants } from '../hero-variants.js';
import { cutoutTarget } from '../subject-data.js';
import { cutoutImage, toolsStatus } from '../tools-service.js';
import { analyzeAsset } from './intelligence.js';
import { pickSubjects } from './subjects.js';

/**
 * Cut the campaign photo's main subject out once, before a Create run, exactly like the
 * Studio cut-out tool: a new derived PNG asset; the original stays unchanged.
 * Returns { asset, patch } to bind to the campaign, { existing: true }, or { notice }.
 */
export async function ensureSubjectCutout(campaign, { signal, onProgress = () => {} } = {}) {
  const assetId = campaign.heroAssetId;
  if (!assetId) return {};
  if (activeVariants(campaign).cutout) return { existing: true };
  let tools;
  try {
    tools = await toolsStatus(signal);
  } catch (error) {
    signal?.throwIfAborted();
    return { notice: `Cut-out skipped: ${error.message}` };
  }
  if (!tools.tools.cutout.ready)
    return {
      notice: `Cut-out skipped: ${tools.tools.cutout.issues.map((i) => i.message).join(' ') || 'tool unavailable.'}`,
    };
  // Subject: a focus chosen in Studio wins; otherwise what Florence-2 detected.
  let box = null,
    label = 'person';
  const focus = campaign.subjectFocus?.assetId === assetId ? campaign.subjectFocus : null;
  if (focus) {
    const results =
      campaign.subjectSearch?.assetId === assetId ? campaign.subjectSearch.results : [];
    const target = cutoutTarget(focus, results);
    box = target?.box || null;
    label = target?.label || label;
  } else {
    onProgress('Finding the subject to cut out…', { stage: 'analysis' });
    const { result } = await analyzeAsset({ id: assetId, kind: 'hero' }, 'florence', { signal });
    const picked = pickSubjects(result.provenance?.objects || []);
    if (!picked.focus) return { notice: 'Cut-out skipped: no person, animal or object found.' };
    box = picked.focus;
    label = picked.subjects[0].label;
  }
  onProgress('Cutting out the subject with BiRefNet…', { stage: 'cutout' });
  const source = await getAsset(assetId);
  if (!source) throw new Error('Original asset is missing.');
  const result = await cutoutImage(source, { box, label, signal, onProgress });
  const asset = await storeDerivedAsset(result.blob, {
    name: 'campaign-image-cutout.png',
    derivedFrom: assetId,
    operation: 'cutout',
    engine: result.engine,
  });
  signal?.throwIfAborted();
  return {
    asset,
    patch: {
      heroCutout: {
        assetId: asset.id,
        sourceAssetId: assetId,
        box: result.box,
        label,
        engine: result.engine,
      },
    },
  };
}
