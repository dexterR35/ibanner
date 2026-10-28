import { z } from 'zod';

/** Client for the optional loopback image tools (cut-out, background extension, upscale). */
const toolSchema = z.object({
  ready: z.boolean(),
  issues: z.array(z.object({ code: z.string(), message: z.string() })).max(10),
});
const healthSchema = z.object({
  service: z.literal('bannerflow-tools'),
  schemaVersion: z.literal(1),
  state: z.string(),
  device: z.string(),
  tools: z.object({
    cutout: toolSchema.extend({ selection: z.enum(['sam3', 'box']) }),
    extend: toolSchema,
    upscale: toolSchema,
  }),
});
// CPU runs of the larger models can take minutes; waits share this deadline.
const DEADLINE = 600_000;

export async function toolsStatus(signal) {
  const response = await fetch('/api/subjects/tools/health', {
    signal: AbortSignal.any([AbortSignal.timeout(4000), ...(signal ? [signal] : [])]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('The local image tools are offline.');
  return healthSchema.parse(await response.json());
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

async function run(tool, path, blob, { signal, onProgress = () => {} } = {}) {
  const requestSignal = AbortSignal.any([
    AbortSignal.timeout(DEADLINE),
    ...(signal ? [signal] : []),
  ]);
  for (;;) {
    const status = await toolsStatus(requestSignal);
    const state = status.tools[tool];
    if (!state.ready)
      throw new Error(state.issues.map((i) => i.message).join(' ') || 'Tool unavailable.');
    const response = await fetch(`/api/subjects/tools/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      body: blob,
      signal: requestSignal,
    });
    if (response.status === 429) {
      await response.body?.cancel();
      onProgress('Waiting for another image tool to finish…');
      await wait(1500, requestSignal);
      continue;
    }
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.json()).detail;
      } catch {
        /* Non-JSON error body. */
      }
      throw new Error(typeof detail === 'string' && detail ? detail : 'The image tool failed.');
    }
    const result = await response.blob();
    if (result.type !== 'image/png') throw new Error('The image tool returned an invalid image.');
    return {
      blob: result,
      engine: response.headers.get('X-Bannerflow-Engine') || tool,
      headers: response.headers,
    };
  }
}

/** Box in normalized source coordinates, or null for whole-image background removal. */
export async function cutoutImage(
  blob,
  { box = null, label = 'person', precision = false, ...options } = {},
) {
  const params = new URLSearchParams({ label });
  if (precision) params.set('precision', 'true');
  if (box)
    Object.entries({
      xmin: box.x,
      ymin: box.y,
      xmax: box.x + box.width,
      ymax: box.y + box.height,
    }).forEach(([key, value]) => params.set(key, Math.max(0, Math.min(1, value)).toFixed(6)));
  const result = await run('cutout', `cutout?${params}`, blob, options);
  const values = (result.headers.get('X-Bannerflow-Box') || '').split(',').map(Number);
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v) || v < 0 || v > 1))
    throw new Error('The cut-out response has no valid bounds.');
  const [x0, y0, x1, y1] = values;
  return { ...result, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } };
}

export function extendImage(blob, pads, options = {}) {
  const params = new URLSearchParams(
    Object.fromEntries(Object.entries(pads).map(([key, value]) => [key, value.toFixed(4)])),
  );
  return run('extend', `extend?${params}`, blob, options);
}

export function upscaleImage(blob, scale, options = {}) {
  return run('upscale', `upscale?scale=${scale}`, blob, options);
}
