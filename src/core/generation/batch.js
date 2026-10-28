import { fingerprint, canonical, digest } from './fingerprint.js';
import { loadResources } from '../storage.js';
import { newEntry, resolveBanner, uid } from '../../data/defaults.js';
import { layoutKey } from '../auto-layout.js';
import { renderOutput, safeName } from '../export.js';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { getRecord, enqueueJob, leaseJob, commitJob, cancelJob, failJob } from './store.js';
import { requestVision, visionCapabilities } from './planner.js';
import { prepareGeneration } from './prepare.js';
import {
  analysisFacts,
  candidateLayouts,
  chooseLayout,
  hashSeed,
  layoutTarget,
  nearestReferences,
  seedBlueprint,
} from '../ai-arrange.js';
import { copyFitIssues } from '../copy-fit.js';

/**
 * Create generation: analyze the photo, let Qwen3-VL place PosterO-style layouts with the
 * nearest references as examples, then finish every size with the same hybrid arrangement as
 * Studio's Arrange now (saved design, nearest reference and Qwen candidates; text fits and the
 * subject crop adapts). Every target produces a draft; copy that is too long for a size is
 * reported with its capacity instead of blocking the draft.
 */
export { STARTER_TARGETS } from '../../data/generation-targets.js';
export { ENGINE_VERSION } from './engine.js';
import { ENGINE_VERSION } from './engine.js';

export function generationSnapshot(project, marketId, targets) {
  if (!project.campaigns[marketId]) throw new Error('Unknown market.');
  if (
    !Array.isArray(targets) ||
    !targets.length ||
    targets.length > 100 ||
    targets.some(
      (t) => ![t.width, t.height].every((n) => Number.isInteger(n) && n >= 32 && n <= 4096),
    ) ||
    new Set(targets.map((t) => `${t.width}x${t.height}`)).size !== targets.length
  )
    throw new Error('Select 1–100 unique sizes between 32 and 4096 pixels.');
  const campaign = structuredClone(project.campaigns[marketId]);
  // Studio-only state never changes a Create layout, so it must not make drafts stale.
  delete campaign.photoAnalysis;
  delete campaign.autoArrange;
  if (
    ['headline', 'subtitle', 'cta', 'legal'].some((k) => String(campaign[k] || '').length > 20000)
  )
    throw new Error('Copy exceeds the 20,000-character generation budget.');
  const plans = targets.map((t) => {
    const entry = project.blueprints.find((e) => {
      const bp = e.versions.find((v) => v.id === e.activeVersionId).blueprint;
      return e.marketId === marketId && bp.width === t.width && bp.height === t.height;
    });
    // The pinned saved design (never the Studio arrangement or local edit), else a new size
    // seeded from the nearest reference shape.
    const base = entry
      ? resolveBanner(entry, { blueprintVersionId: project.banners[entry.id].blueprintVersionId })
      : seedBlueprint(project, marketId, t.width, t.height);
    const references = nearestReferences(project, marketId, t.width, t.height).map((r) => r.bp);
    return { entry, base, references };
  });
  return {
    schemaVersion: 2,
    market: structuredClone(project.markets.find((m) => m.id === marketId)),
    campaign,
    targets: targets.map((t, i) => ({
      id: plans[i].entry?.id || `${marketId}-${t.width}x${t.height}`,
      marketId,
      ...t,
    })),
    bases: plans.map((p) => structuredClone(p.base)),
    references: plans.map((p) => structuredClone(p.references)),
    blueprintRevisionIds: plans.map((p) =>
      p.entry ? project.banners[p.entry.id].blueprintVersionId : null,
    ),
    engine: ENGINE_VERSION,
    renderer: 'canvas-1',
  };
}
export function snapshotIsCurrent(snapshot, project) {
  try {
    return (
      canonical(snapshot) ===
      canonical(
        generationSnapshot(
          project,
          snapshot.market.id,
          snapshot.targets.map(({ width, height }) => ({ width, height })),
        ),
      )
    );
  } catch {
    return false;
  }
}

/** The campaign as arrangement sees it: the analysed subject drives the photo crop. */
function layoutCampaign(campaign, analysis) {
  const focus = analysis?.focus;
  if (!campaign.heroAssetId || !focus || analysis.focusSource === 'whole-image-fallback')
    return campaign;
  return {
    ...campaign,
    subjectFocus: { assetId: campaign.heroAssetId, box: focus, source: analysis.focusSource },
  };
}

export async function generateBatch(
  snapshot,
  {
    signal,
    onProgress = () => {},
    brief = '',
    usePlanner = true,
    automaticAnalysis = true,
    modelVariant,
    modelPrecision,
  } = {},
) {
  const correction = snapshot.campaign.heroAssetId
    ? await getRecord(`correction:${snapshot.campaign.heroAssetId}`)
    : null;
  let capabilities = null;
  try {
    capabilities = await visionCapabilities(signal, { modelVariant, modelPrecision });
  } catch (error) {
    signal?.throwIfAborted();
    capabilities = { qwen: { ready: false, message: error.message } };
  }
  const inputHash = await fingerprint({
    snapshot,
    brief,
    usePlanner,
    automaticAnalysis,
    modelVariant: modelVariant || null,
    modelPrecision: modelPrecision || 'auto',
    correction,
    qwenProfile: capabilities?.qwen?.ready ? capabilities.qwen.profileId || 'ready' : 'unavailable',
    florenceProfile: capabilities?.florence?.ready ? capabilities.florence.profileId : null,
    ocrProfile: capabilities?.ocr?.ready ? capabilities.ocr.profileId : null,
  });
  const key = `layout:${inputHash}`;
  await enqueueJob(key, { snapshot, brief, usePlanner, automaticAnalysis }, Date.now(), {
    retryFallback: usePlanner,
  });
  const cached = await getRecord('ledger');
  if (cached?.jobs[key]?.state === 'succeeded') return { ...cached.jobs[key].result, cached: true };
  const owner = crypto.randomUUID(),
    lease = await leaseJob(key, owner, Date.now(), 1800000);
  if (!lease)
    throw new Error('This generation is already running in another tab. Retry after it finishes.');
  const cancel = () => cancelJob(key);
  signal?.addEventListener('abort', cancel, { once: true });
  const batch = {
    schemaVersion: 2,
    id: await fingerprint({ inputHash, revision: lease.token }),
    inputHash,
    snapshot,
    createdAt: new Date().toISOString(),
    status: 'running',
    items: [],
    layout: null,
  };
  try {
    signal?.throwIfAborted();
    onProgress('Loading source assets…', { stage: 'source' });
    const resources = await loadResources(snapshot.campaign),
      context = document.createElement('canvas').getContext('2d');
    // Corrections are captured and fingerprinted separately from immutable original bytes.
    batch.correction = correction ? structuredClone(correction) : null;
    batch.analysis = await prepareGeneration(snapshot.campaign, correction, {
      signal,
      onProgress,
      automatic: automaticAnalysis,
      capabilities,
    });
    const campaign = layoutCampaign(snapshot.campaign, batch.analysis);
    const facts = analysisFacts(batch.analysis);
    const targets = snapshot.targets
      .map((t, i) =>
        layoutTarget({
          id: t.id,
          base: snapshot.bases[i],
          references: snapshot.references[i],
          campaign,
          facts,
        }),
      )
      .filter(Boolean);
    let proposals = new Map();
    if (usePlanner && targets.length) {
      onProgress('Qwen3-VL is placing layouts…', { stage: 'planner' });
      try {
        if (!capabilities?.qwen?.ready)
          throw new Error(capabilities?.qwen?.message || 'Qwen3-VL is unavailable.');
        const response = await requestVision(
          'layout',
          {
            targets,
            samples: 3,
            seed: hashSeed(inputHash),
            temperature: 0.7,
            ...(modelVariant ? { modelVariant } : {}),
            ...(modelPrecision && modelPrecision !== 'auto' ? { modelPrecision } : {}),
          },
          { signal },
        );
        proposals = new Map((response.targets || []).map((t) => [t.id, t.candidates]));
        batch.layout = { elapsedMs: response.elapsedMs, provenance: response.provenance };
      } catch (error) {
        signal?.throwIfAborted();
        // Without Qwen every size still gets the saved design or the nearest reference.
        batch.layout = { fallback: true, reason: error.message };
      }
    } else batch.layout = { fallback: true, reason: 'Qwen layout is turned off.' };
    for (let i = 0; i < snapshot.targets.length; i++) {
      signal?.throwIfAborted();
      const target = snapshot.targets[i];
      onProgress(`Arranging ${i + 1} of ${snapshot.targets.length}…`, {
        stage: 'layout',
        index: i,
        total: snapshot.targets.length,
        targetId: target.id,
      });
      try {
        const { list, referenceBoxes } = candidateLayouts(
          snapshot.bases[i],
          snapshot.references[i][0],
          proposals.get(target.id),
        );
        const best = chooseLayout(list, campaign, resources, { context, referenceBoxes });
        batch.items.push({
          target,
          state: 'succeeded',
          scene: best.arranged,
          source: best.source,
          score: Math.round(best.score),
          candidates: list.length,
          copyIssues: copyFitIssues(best.arranged, campaign, resources, context),
          layoutInputHash: await fingerprint({ inputHash, target, layout: batch.layout }),
        });
      } catch (error) {
        batch.items.push({ target, state: 'failed', message: error.message });
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    batch.status = batch.items.every((i) => i.state === 'succeeded')
      ? 'completed'
      : batch.items.some((i) => i.state === 'succeeded')
        ? 'partially_completed'
        : 'failed';
    if (!(await commitJob(key, owner, lease.token, batch)))
      throw new Error('Generation was cancelled or its lease expired.');
    onProgress('Layouts ready.', { stage: 'complete' });
    return batch;
  } catch (error) {
    if (signal?.aborted) {
      for (const target of snapshot.targets.slice(batch.items.length))
        batch.items.push({ target, state: 'cancelled' });
      batch.status = 'cancelled';
      return batch;
    }
    await failJob(key, owner, lease.token, error.message);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}
export async function assertBatchCorrectionsCurrent(batch) {
  const current = batch.snapshot.campaign.heroAssetId
    ? await getRecord(`correction:${batch.snapshot.campaign.heroAssetId}`)
    : null;
  if (canonical(current || null) !== canonical(batch.correction || null))
    throw new Error('Asset corrections changed. Generate again before accepting these drafts.');
}
export function acceptBatch(project, batch) {
  if (!snapshotIsCurrent(batch.snapshot, project))
    throw new Error('Inputs changed. Generate again before accepting this batch.');
  const next = structuredClone(project),
    accepted = [];
  batch.items.forEach((item, index) => {
    if (item.state !== 'succeeded') return;
    const bp = structuredClone(item.scene),
      old = next.banners[bp.id];
    let entry = next.blueprints.find((e) => e.id === bp.id);
    if (!entry) {
      // A new size keeps its seeded design as the saved blueprint; the draft is its edit.
      entry = newEntry(structuredClone(batch.snapshot.bases[index] || bp));
      next.blueprints.push(entry);
      next.banners[bp.id] = {
        blueprintVersionId: entry.activeVersionId,
        override: null,
        history: [],
      };
    }
    const current = next.banners[bp.id];
    const before = resolveBanner(entry, current);
    next.banners[bp.id] = {
      ...current,
      override: bp,
      arrangement: null,
      aiLayout: null,
      layoutKey: layoutKey(next.campaigns[bp.marketId]),
      history: [
        ...current.history,
        { id: uid(), createdAt: new Date().toISOString(), blueprint: before },
        { id: uid(), createdAt: new Date().toISOString(), blueprint: bp },
      ],
      generation: {
        batchId: batch.id,
        layoutInputHash: item.layoutInputHash,
        variant: item.source,
      },
    };
    accepted.push({
      id: bp.id,
      before: old || null,
      after: structuredClone(next.banners[bp.id]),
      newEntry: !old,
    });
  });
  next.generationUndo = { batchId: batch.id, marketId: batch.snapshot.market.id, accepted };
  return next;
}
export function undoBatch(project) {
  const undo = project.generationUndo;
  if (!undo) return project;
  if (undo.accepted.some((item) => canonical(project.banners[item.id]) !== canonical(item.after)))
    throw new Error('A generated banner was edited. Use its editor undo to preserve newer work.');
  const next = structuredClone(project);
  for (const item of undo.accepted) {
    if (item.before) next.banners[item.id] = item.before;
    else {
      delete next.banners[item.id];
      next.blueprints = next.blueprints.filter((e) => e.id !== item.id);
    }
  }
  delete next.generationUndo;
  return next;
}
export async function exportBatch(batch, { signal, onProgress = () => {}, maxBytes = null } = {}) {
  const files = {},
    manifest = {
      schemaVersion: 3,
      batchId: batch.id,
      inputHash: batch.inputHash,
      market: batch.snapshot.market.id,
      locale: batch.snapshot.market.locale,
      createdAt: new Date().toISOString(),
      reviewStatus: 'draft',
      engine: ENGINE_VERSION,
      renderer: 'canvas-1',
      encoder: 'browser-png',
      assets: Object.fromEntries(
        ['hero', 'logo', 'font'].map((k) => [k, batch.snapshot.campaign[`${k}AssetId`] || null]),
      ),
      targets: [],
    };
  const resources = await loadResources(batch.snapshot.campaign);
  for (const item of batch.items) {
    const record = {
      target: item.target,
      state: item.state,
      source: item.source || null,
      layoutInputHash: item.layoutInputHash || null,
      copyIssues: item.copyIssues || [],
      findings: item.message ? [{ code: 'GENERATION_FAILED', message: item.message }] : [],
      reviewStatus: 'draft',
    };
    manifest.targets.push(record);
    if (signal?.aborted) {
      record.state = 'cancelled';
      continue;
    }
    if (item.state !== 'succeeded') continue;
    try {
      onProgress(`Exporting ${item.target.width} × ${item.target.height}…`);
      const blob = await renderOutput(item.scene, batch.snapshot.campaign, resources, 'png');
      // A platform file-size cap is an export limit, reported per file.
      if (maxBytes && blob.size > maxBytes) {
        record.state = 'over_size_limit';
        record.findings = [
          { code: 'ENCODE_LIMIT_EXCEEDED', message: `${blob.size} bytes exceeds ${maxBytes}.` },
        ];
        continue;
      }
      const decoded = await createImageBitmap(blob);
      const matches = decoded.width === item.target.width && decoded.height === item.target.height;
      decoded.close();
      if (!matches) throw new Error('Encoded dimensions differ from the requested target.');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      record.filename = `${safeName(batch.snapshot.market.id)}-${item.target.width}x${item.target.height}-${safeName(item.source || 'layout')}-DRAFT-${batch.id.slice(0, 8)}.png`;
      Object.assign(record, {
        state: 'succeeded',
        bytes: bytes.length,
        sha256: await digest(bytes),
        dimensionsVerified: true,
      });
      files[record.filename] = bytes;
    } catch (error) {
      record.state = 'failed';
      record.findings = [{ code: 'EXPORT_FAILED', message: error.message }];
    }
  }
  manifest.counts = countStates(manifest.targets);
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
const countStates = (targets) =>
  Object.fromEntries(
    ['succeeded', 'over_size_limit', 'failed', 'cancelled'].map((s) => [
      s,
      targets.filter((t) => t.state === s).length,
    ]),
  );

/** Combine frozen market batches without silently omitting any target. */
export async function exportMatrix(batches, options = {}) {
  const files = {},
    manifest = { schemaVersion: 3, reviewStatus: 'draft', batches: [], targets: [] };
  for (const batch of batches) {
    const archive = unzipSync(
      new Uint8Array(await (await exportBatch(batch, options)).arrayBuffer()),
    );
    const report = JSON.parse(strFromU8(archive['manifest.json']));
    manifest.batches.push({
      id: batch.id,
      inputHash: batch.inputHash,
      market: report.market,
      locale: report.locale,
    });
    manifest.targets.push(
      ...report.targets.map((t) => ({ ...t, market: report.market, batchId: batch.id })),
    );
    for (const [name, data] of Object.entries(archive))
      if (name !== 'manifest.json') files[name] = data;
  }
  manifest.counts = countStates(manifest.targets);
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
