import { z } from 'zod';
import { normalizeDetections, subjectQuery } from './subject-data.js';

const healthSchema = z.object({
  service: z.literal('bannerflow-sam3'),
  schemaVersion: z.literal(1),
  ready: z.boolean(),
  state: z.string(),
  loaded: z.boolean(),
  engine: z.enum(['sam3', 'florence']).optional(),
  device: z.string(),
  backend: z.enum(['native', 'transformers']).optional(),
  note: z.string().max(300).optional(),
  issues: z.array(z.object({ code: z.string(), message: z.string() })).max(20),
});
const detectionSchema = z.object({
  service: z.literal('bannerflow-sam3'),
  schemaVersion: z.literal(1),
  engine: z.enum(['sam3', 'florence']),
  detections: z
    .array(
      z.object({
        label: z.string().max(160),
        score: z.number().min(0).max(1).optional(),
        box: z.object({ xmin: z.number(), ymin: z.number(), xmax: z.number(), ymax: z.number() }),
      }),
    )
    .max(30),
});
export async function subjectServiceStatus(signal, engine = 'florence') {
  const response = await fetch(
    `/api/subjects/health${engine === 'sam3' ? '?precision=true' : ''}`,
    {
      signal: AbortSignal.any([AbortSignal.timeout(4000), ...(signal ? [signal] : [])]),
      cache: 'no-store',
    },
  );
  if (!response.ok) throw new Error('Local image analysis service is offline.');
  const status = healthSchema.parse(await response.json());
  if (engine === 'florence' && status.ready && status.engine !== 'florence')
    throw new Error('Restart the local service to enable Florence-2 subject detection.');
  return status;
}
function pause(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function detectWithSam3(blob, query, signal, onProgress = () => {}) {
  return detectWithService(blob, query, signal, onProgress, 'sam3');
}
export async function detectWithFlorence(blob, query, signal, onProgress = () => {}) {
  return detectWithService(blob, query, signal, onProgress, 'florence');
}
async function detectWithService(blob, query, signal, onProgress, engine) {
  const name = engine === 'sam3' ? 'SAM 3' : 'Florence-2';
  const requestSignal = AbortSignal.any([
    AbortSignal.timeout(180_000),
    ...(signal ? [signal] : []),
  ]);
  let response;
  while (true) {
    response = await fetch(
      `/api/subjects/detect?query=${encodeURIComponent(subjectQuery(query))}${engine === 'sam3' ? '&precision=true' : ''}`,
      {
        method: 'POST',
        headers: { 'Content-Type': blob.type },
        body: blob,
        signal: requestSignal,
      },
    );
    if (response.status !== 429) break;
    await response.body?.cancel();
    onProgress(`${name} is finishing another search. Waiting for your turn…`);
    let status;
    do {
      await pause(requestSignal);
      status = await subjectServiceStatus(requestSignal, engine);
      if (!status.ready) throw new Error(`${name} needs setup before searching.`);
    } while (['busy', 'loading'].includes(status.state));
    onProgress(`Finding subjects with ${name}…`);
  }
  if (!response.ok) throw new Error(`${name} could not complete this search.`);
  const result = detectionSchema.parse(await response.json());
  if (result.engine !== engine)
    throw new Error('Subject detector returned a different model. Restart the local service.');
  if (engine === 'sam3' && result.detections.some((d) => d.score == null))
    throw new Error('SAM 3 returned no matching scores.');
  return normalizeDetections(result.detections);
}
