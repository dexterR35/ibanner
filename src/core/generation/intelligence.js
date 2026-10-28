import { getAsset, imageFrom } from '../storage.js';
import { analyzeImage } from '../image-analysis.js';
import { extractPalette } from '../palette.js';
import { detectSubjects } from '../subject-detection.js';
import { imagePayload, requestVision, visionCapabilities } from './planner.js';
import { fingerprint } from './fingerprint.js';
import { getRecord, saveAnalysis } from './store.js';
import { florenceReferenceSchema } from '../florence-reference.js';
import { ocrResultSchema } from '../reference-text-layout.js';

/** Florence `<OCR_WITH_REGION>` / `<OD>` evidence for one asset. */
async function florenceEvidence(blob, profileId, signal) {
  const result = florenceReferenceSchema.parse(
    await requestVision(
      'reference',
      { image: await imagePayload(blob, 1024), profileId },
      { signal },
    ),
  );
  signal?.throwIfAborted();
  if (result.profileId !== profileId || result.engine !== 'florence2')
    throw new Error('PROFILE_MISMATCH: Florence changed during analysis.');
  return result;
}
// Florence reports no OCR confidence; 1 marks "model-read" for the shared OCR schema.
const textRegions = (result) =>
  result.textRegions.map((region) => ({ text: region.text, box: region.box, confidence: 1 }));

export async function analyzeAsset(asset, component, { signal, query = 'person' } = {}) {
  if (asset.kind === 'font') throw new Error('Image analysis is not available for fonts.');
  const blob = await getAsset(asset.id);
  if (!blob) throw new Error('Original asset is missing.');
  const caps = ['ocr', 'florence', 'subjects'].includes(component)
    ? await visionCapabilities(signal)
    : null;
  // Read image text prefers PaddleOCR; Florence-2 is the fallback.
  const paddle = component === 'ocr' && caps.ocr?.ready;
  const profileId =
    component === 'florence'
      ? caps.florence?.profileId
      : component === 'ocr'
        ? paddle
          ? `${caps.ocr.profileId}:paddleocr-lines-v1`
          : `${caps.florence?.profileId}:ocr-with-region-v1`
        : component === 'subjects'
          ? `${caps.florence?.profileId}:phrase-grounding-v1`
          : 'opencv-palette-v1';
  if (['florence', 'ocr'].includes(component) && !paddle && !caps.florence?.ready)
    throw new Error(
      component === 'ocr'
        ? `${caps.ocr?.message || caps.florence?.message || 'PaddleOCR or Florence-2 is required to read image text.'} Filename and tags remain searchable.`
        : caps.florence?.message || 'Florence-2 is required for image analysis.',
    );
  const id = await fingerprint({
    input: asset.id,
    component,
    profileId,
    ...(component === 'subjects' ? { query } : {}),
    version: 1,
  });
  const cached = await getRecord(`analysis:${id}`);
  if (cached) return { cached: true, result: cached };
  const base = {
    schemaVersion: 1,
    id,
    assetId: asset.id,
    inputHash: asset.id,
    component,
    profileId,
    createdAt: new Date().toISOString(),
    provenance: { coordinateSpace: 'normalized-oriented-source' },
    status: 'ready',
  };
  if (component === 'florence') {
    const result = await florenceEvidence(blob, caps.florence.profileId, signal);
    await saveAnalysis({
      ...base,
      ocr: textRegions(result),
      provenance: { ...result.provenance, objects: result.objects },
      status: result.textRegions.length || result.objects.length ? 'ready' : 'no_match',
    });
  } else if (paddle) {
    const result = ocrResultSchema.parse(
      await requestVision(
        'ocr',
        { image: await imagePayload(blob, 2048), profileId: caps.ocr.profileId },
        { signal },
      ),
    );
    signal?.throwIfAborted();
    if (result.profileId !== caps.ocr.profileId)
      throw new Error('PROFILE_MISMATCH: PaddleOCR changed during analysis.');
    await saveAnalysis({
      ...base,
      ocr: result.lines.slice(0, 500).map((l) => ({
        text: l.text.slice(0, 2000),
        box: l.box,
        confidence: l.confidence,
      })),
      provenance: {
        coordinateSpace: 'normalized-oriented-preview',
        engine: 'rapidocr',
        models: 'PP-OCRv6',
      },
      status: result.lines.length ? 'ready' : 'no_match',
    });
  } else if (component === 'ocr') {
    const result = await florenceEvidence(blob, caps.florence.profileId, signal);
    await saveAnalysis({
      ...base,
      ocr: textRegions(result),
      provenance: { ...result.provenance, task: '<OCR_WITH_REGION>' },
      status: result.textRegions.length ? 'ready' : 'no_match',
    });
  } else if (component === 'subjects') {
    const result = await detectSubjects(blob, query, { signal });
    signal?.throwIfAborted();
    await saveAnalysis({
      ...base,
      provenance: { ...base.provenance, engine: 'florence', task: '<CAPTION_TO_PHRASE_GROUNDING>' },
      subjects: result.map((r) => ({ id: r.id, label: r.label, box: r.box, score: r.score })),
      status: result.length ? 'ready' : 'no_match',
    });
  } else {
    const url = URL.createObjectURL(blob);
    try {
      const image = await imageFrom(url),
        info = await analyzeImage(image),
        canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, 64, 64);
      signal?.throwIfAborted();
      await saveAnalysis({
        ...base,
        visual: {
          palette: extractPalette(ctx.getImageData(0, 0, 64, 64).data).map((c) => c.color),
          luminance: info.luminance,
          edgeVariance: info.edgeVariance,
        },
        provenance: { ...base.provenance, engine: info.engine, palette: 'rgb-64x64-v1' },
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { cached: false, result: await getRecord(`analysis:${id}`) };
}
