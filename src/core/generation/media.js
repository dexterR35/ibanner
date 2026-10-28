import { digest } from './fingerprint.js';
import { putAsset, storeDerivedAsset } from '../storage.js';
export async function importMediaFrames(file, { signal } = {}) {
  if (file.size > 30 * 1024 * 1024) throw new Error('Use media below 30 MB.');
  const response = await fetch('/api/subjects/vision/media', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
    signal: AbortSignal.any([AbortSignal.timeout(300000), ...(signal ? [signal] : [])]),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || 'Media sampling failed.');
  if (
    result.schemaVersion !== 1 ||
    !Array.isArray(result.frames) ||
    result.frames.length > 12 ||
    result.durationMs > 120000
  )
    throw new Error('Invalid media frame response.');
  const id = await digest(await file.arrayBuffer());
  signal?.throwIfAborted();
  await putAsset(id, file);
  const original = {
    id,
    name: file.name,
    kind: 'media',
    type: file.type,
    bytes: file.size,
    width: result.width,
    height: result.height,
    durationMs: result.durationMs,
    codec: result.codec,
    hasAudio: result.hasAudio || false,
    timeBase: result.timeBase || 'milliseconds',
    createdAt: new Date().toISOString(),
    provenance: 'campaign-original',
  };
  const assets = [original];
  for (const frame of result.frames) {
    signal?.throwIfAborted();
    if (
      !Number.isFinite(frame.timestampMs) ||
      frame.timestampMs < 0 ||
      typeof frame.image !== 'string'
    )
      throw new Error('Invalid frame timestamp.');
    const bytes = Uint8Array.from(atob(frame.image), (c) => c.charCodeAt(0));
    if ((await digest(bytes)) !== frame.sha256) throw new Error('Frame checksum mismatch.');
    const asset = await storeDerivedAsset(new Blob([bytes], { type: 'image/png' }), {
      name: `${file.name}-frame-${frame.frameIndex}-${frame.timestampMs}ms.png`,
      derivedFrom: id,
      operation: 'frame',
      engine: result.method,
    });
    assets.push({
      ...asset,
      timestampMs: frame.timestampMs,
      durationMs: frame.durationMs,
      frameIndex: frame.frameIndex,
    });
  }
  return assets;
}
