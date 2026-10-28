import { digest } from './generation/fingerprint.js';
import { snapshotRecords, validateRecords, restoreRecords } from './generation/store.js';
import { fitText, buttonTextBox } from './text-fit.js';
import { boundText } from './render.js';
import { limitBytes } from '../data/output-limits.js';
import { encodeIndexedPng } from './png-palette.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { canvasOf, renderFrame } from './render.js';
import { reviewReport } from './review.js';
import { migrateLegacyProject } from './legacy-migration.js';
import { animationSamples } from './timeline.js';
import { resolveBanner, campaignFor } from '../data/defaults.js';
import { getAsset, putAsset, validateProject } from './storage.js';
import { validateBlueprint } from './schema.js';

export function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const safeName = (value) =>
  String(value)
    .replace(/[^a-z0-9_-]+/gi, '-')
    .slice(0, 90);
/**
 * Drop in-between animation frames, keeping holds and scene starts. Delays of dropped frames
 * are added to the frame before them, so the total running time never changes.
 */
export function thinSamples(samples, step = 1) {
  if (step <= 1) return samples;
  const kept = [];
  let run = 0;
  samples.forEach((sample, index) => {
    const hold = sample.delay >= 300 || (samples[index - 1]?.delay ?? 300) >= 300;
    if (!kept.length || hold || run % step === 0) {
      kept.push({ ...sample });
      run = hold ? 0 : run + 1;
    } else {
      kept.at(-1).delay += sample.delay;
      run++;
    }
  });
  return kept;
}

/** Size reductions tried in order when a GIF is over its file-size target. */
export const GIF_ATTEMPTS = [
  { colors: 256, step: 1, label: 'shared palette' },
  { colors: 128, step: 1, label: '128 colours' },
  { colors: 64, step: 1, label: '64 colours' },
  { colors: 64, step: 2, label: '64 colours · fewer in-between frames' },
  { colors: 32, step: 2, label: '32 colours · fewer in-between frames' },
  { colors: 32, step: 3, label: '32 colours · fewest in-between frames' },
];

/**
 * GIF encoder. The default writes a full 256-colour palette per frame. `shared` mode builds
 * one palette from sampled frames and writes unchanged pixels as transparent, which keeps
 * the picture identical where nothing moves and compresses far better.
 */
async function encodeGif(bp, campaign, resources, options = {}, progress = () => {}) {
  const { colors = 256, step = 1, shared = false } = options;
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const gif = GIFEncoder(),
    samples = thinSamples(animationSamples(bp), step),
    canvas = canvasOf(bp.width, bp.height),
    pixelsAt = (time) => {
      renderFrame(canvas, bp, campaign, resources, time);
      return canvas.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
    };
  if (samples.length * bp.width * bp.height > 120_000_000)
    throw new Error(
      'This animation exceeds the browser export budget. Reduce canvas size, duration or moving effects.',
    );
  let palette = null,
    shown = null;
  if (shared) {
    // One palette for the whole animation, built from up to eight evenly spaced frames.
    const picks = [
      ...new Set(
        Array.from({ length: Math.min(8, samples.length) }, (_, i) =>
          Math.floor((i * samples.length) / Math.min(8, samples.length)),
        ),
      ),
    ];
    const area = bp.width * bp.height * 4,
      pool = new Uint8Array(area * picks.length);
    picks.forEach((index, i) => pool.set(pixelsAt(samples[index].time), i * area));
    // One slot stays free for "unchanged since the previous frame".
    palette = quantize(pool, colors - 1);
  }
  for (let i = 0; i < samples.length; i++) {
    const { time, delay } = samples[i],
      data = pixelsAt(time),
      frameDelay = Math.max(10, Math.round(delay / 10) * 10);
    if (shared) {
      const index = applyPalette(data, palette),
        clear = palette.length;
      if (!shown) shown = index.slice();
      else
        for (let p = 0; p < index.length; p++)
          if (index[p] === shown[p]) index[p] = clear;
          else shown[p] = index[p];
      gif.writeFrame(index, bp.width, bp.height, {
        ...(i === 0 ? { palette: [...palette, [0, 0, 0]] } : {}),
        transparent: i > 0,
        transparentIndex: clear,
        dispose: 1,
        delay: frameDelay,
        repeat: bp.repeat,
      });
    } else {
      const own = quantize(data, colors);
      gif.writeFrame(applyPalette(data, own), bp.width, bp.height, {
        palette: own,
        delay: frameDelay,
        repeat: bp.repeat,
      });
    }
    progress((i + 1) / samples.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
export async function renderOutput(bp, campaign, resources, format = 'png', progress = () => {}) {
  validateBlueprint(bp);
  if (!['png', 'jpg', 'webp', 'gif'].includes(format))
    throw new Error('Unsupported export format.');
  const measurement = canvasOf(1, 1).getContext('2d');
  for (const layer of bp.layers.filter(
    (l) => l.fitPolicy === 'strict-v1' && l.visible && ['text', 'button'].includes(l.type),
  )) {
    const fit = fitText(
      measurement,
      boundText(layer, campaign),
      layer.type === 'button' ? buttonTextBox(layer) : layer,
      resources,
    );
    if (fit.overflow)
      throw new Error(
        `${layer.name}: strict text does not fit. Regenerate or adjust its box before export.`,
      );
  }
  if (format === 'gif') return encodeGif(bp, campaign, resources, {}, progress);
  const canvas = canvasOf(bp.width, bp.height);
  renderFrame(canvas, bp, campaign, resources, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed.'))),
      `image/${format === 'jpg' ? 'jpeg' : format}`,
      0.94,
    ),
  );
}
export async function exportSet(entries, project, campaign, resources, format, onProgress) {
  const files = {},
    manifest = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      market: entries[0]?.marketId,
      campaign: campaign.name,
      outputs: [],
      targets: [],
    };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i],
      banner = project.banners[entry.id],
      bp = resolveBanner(entry, banner),
      revision = entry.versions.find((v) => v.id === banner?.blueprintVersionId);
    const findings = reviewReport(bp, campaign, resources, entry);
    const draft = revision?.status !== 'published' || findings.length > 0;
    const ext = bp.mode === 'animated' ? 'gif' : format;
    const filename = `${safeName(entry.id)}-${draft ? 'DRAFT-' : ''}v${revision?.number || 1}.${ext}`;
    onProgress(`Rendering ${i + 1} of ${entries.length} · ${bp.width} × ${bp.height}`);
    const target = { id: entry.id, width: bp.width, height: bp.height, state: 'running' };
    manifest.targets.push(target);
    try {
      const { blob, limit } = await renderWithinLimit(
        bp,
        campaign,
        resources,
        ext,
        limitBytes(campaign.outputLimit),
      );
      if (!limit.within) {
        Object.assign(target, {
          state: 'blocked',
          reason: 'ENCODE_LIMIT_EXCEEDED',
          sizeLimit: limit,
        });
        continue;
      }
      files[filename] = await bytes(blob);
      Object.assign(target, { state: 'succeeded', filename });
      manifest.outputs.push({
        filename,
        sizeLimit: limit,
        sha256: await digest(await blob.arrayBuffer()),
        bytes: blob.size,
        width: bp.width,
        height: bp.height,
        blueprintVersionId: banner?.blueprintVersionId,
        overrideRevisionId: banner?.history?.at(-1)?.id || null,
        arranged: Boolean(banner?.arrangement),
        draft,
        findings,
      });
    } catch (error) {
      Object.assign(target, { state: 'failed', reason: error.message });
    }
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
export async function backupProject(project) {
  project = structuredClone(project);
  const records = await snapshotRecords(project.assets.map((a) => a.id));
  const files = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
    'intelligence.json': strToU8(JSON.stringify(records)),
  };
  for (const asset of project.assets) {
    const blob = await getAsset(asset.id);
    if (!blob) throw new Error(`Original missing: ${asset.name}`);
    const source = await bytes(blob);
    if ((await digest(source)) !== asset.id)
      throw new Error(`Original hash mismatch: ${asset.name}`);
    files[`assets/${asset.id}`] = source;
  }
  files['backup-manifest.json'] = strToU8(
    JSON.stringify({
      schemaVersion: 2,
      models: 'Excluded; stored results are portable without model weights.',
      checksums: Object.fromEntries(
        await Promise.all(
          Object.entries(files).map(async ([key, data]) => [key, await digest(data)]),
        ),
      ),
    }),
  );
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' });
}
export async function importProject(file) {
  if (file.size > 150 * 1024 * 1024) throw new Error('Project backup exceeds 150 MB.');
  let expanded = 0,
    count = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      expanded += entry.originalSize;
      count++;
      if (
        expanded > 300 * 1024 * 1024 ||
        count > 11000 ||
        entry.name.includes('..') ||
        entry.name.startsWith('/') ||
        entry.name.includes('\\')
      )
        throw new Error('Unsafe or oversized backup archive.');
      return true;
    },
  });
  if (files['backup-manifest.json']) {
    const manifest = JSON.parse(strFromU8(files['backup-manifest.json']));
    if (manifest.schemaVersion !== 2 || !manifest.checksums)
      throw new Error('Unsupported backup manifest.');
    for (const [name, hash] of Object.entries(manifest.checksums))
      if (!files[name] || (await digest(files[name])) !== hash)
        throw new Error(`Backup checksum mismatch: ${name}`);
    if (
      !manifest.checksums['project.json'] ||
      (files['intelligence.json'] && !manifest.checksums['intelligence.json'])
    )
      throw new Error('Backup manifest is incomplete.');
  }
  if (!files['project.json']) throw new Error('This ZIP does not contain project.json.');
  const project = validateProject(
    migrateLegacyProject(JSON.parse(strFromU8(files['project.json'])), campaignFor),
  );
  for (const asset of project.assets) {
    const data = files[`assets/${asset.id}`];
    if (!data) throw new Error(`Missing asset: ${asset.name}`);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== asset.id) throw new Error(`Asset hash mismatch: ${asset.name}`);
  }
  const records = files['intelligence.json']
    ? validateRecords(
        JSON.parse(strFromU8(files['intelligence.json'])),
        project.assets.map((a) => a.id),
      )
    : [];
  for (const asset of project.assets)
    await putAsset(asset.id, new Blob([files[`assets/${asset.id}`]], { type: asset.type }));
  await restoreRecords(records);
  return project;
}

/**
 * Finite encoding attempts; dimensions, copy and total running time never change. GIFs try a
 * shared palette, fewer colours and, last, fewer in-between frames (holds are always kept).
 */
export async function renderWithinLimit(bp, campaign, resources, format, maxBytes) {
  let blob = await renderOutput(bp, campaign, resources, format);
  const attempts = [{ setting: 'original', bytes: blob.size }];
  if (maxBytes && blob.size > maxBytes && format === 'gif') {
    for (const attempt of GIF_ATTEMPTS) {
      const candidate = await encodeGif(bp, campaign, resources, { ...attempt, shared: true });
      attempts.push({ setting: attempt.label, bytes: candidate.size });
      if (candidate.size < blob.size) blob = candidate;
      if (blob.size <= maxBytes) break;
    }
  } else if (maxBytes && blob.size > maxBytes) {
    const canvas = canvasOf(bp.width, bp.height);
    renderFrame(canvas, bp, campaign, resources, 0);
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      let candidate;
      if (format === 'png') {
        const { quantize, applyPalette } = await import('gifenc');
        const pixels = canvas.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
        const palette = quantize(pixels, Math.round(quality * 256));
        candidate = encodeIndexedPng(applyPalette(pixels, palette), palette, bp.width, bp.height);
      } else
        candidate = await new Promise((resolve) =>
          canvas.toBlob(resolve, `image/${format === 'jpg' ? 'jpeg' : format}`, quality),
        );
      if (!candidate) throw new Error('Image encoding failed.');
      attempts.push({ setting: quality, bytes: candidate.size });
      if (candidate.size < blob.size) blob = candidate;
      if (blob.size <= maxBytes) break;
    }
  }
  return { blob, limit: { maxBytes, within: !maxBytes || blob.size <= maxBytes, attempts } };
}
