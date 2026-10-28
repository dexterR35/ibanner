import { analyzePhotoGrid } from './image-analysis.js';
import { imagePayload, requestVision, visionCapabilities } from './generation/planner.js';
import { toolsStatus } from './tools-service.js';
import { ocrResultSchema } from './reference-text-layout.js';
import { florenceReferenceSchema } from './florence-reference.js';
import { photoAnalysisKey, photoAnalysisSchema } from './photo-analysis.js';

/**
 * Browser-side AI steps for Studio. Each model is optional: OpenCV always runs; BiRefNet,
 * PaddleOCR, Florence-2 and Qwen3-VL run when the local service reports them ready. A missing
 * model is reported, never invented, and normal rendering never waits for one.
 */

async function blobOf(image, maxEdge = 1024) {
  const w = image.naturalWidth || image.width,
    h = image.naturalHeight || image.height,
    scale = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))),
      'image/png',
    ),
  );
}

const unitBox = (b) => ({
  x: Math.max(0, Math.min(1, b.x)),
  y: Math.max(0, Math.min(1, b.y)),
  width: Math.max(0, Math.min(1, b.width)),
  height: Math.max(0, Math.min(1, b.height)),
});

/**
 * Analyze the rendered campaign photo once: OpenCV grid, BiRefNet subject map, PaddleOCR text
 * printed in the photo and Florence-2 objects. Returns { analysis, notes } where notes list the
 * models that were unavailable.
 */
export async function analyzeCampaignPhoto(campaign, resources, { signal } = {}) {
  const image = resources?.hero;
  if (!image) throw new Error('Upload a campaign image first.');
  const grid = await analyzePhotoGrid(image);
  const analysis = {
    key: photoAnalysisKey(campaign),
    engine: 'OpenCV.js',
    ...grid,
    engines: ['opencv'],
  };
  const notes = [];
  const blob = await blobOf(image);
  let capabilities = null;
  try {
    capabilities = await visionCapabilities(signal);
  } catch {
    notes.push('local AI service offline');
  }
  try {
    const tools = await toolsStatus(signal);
    if (tools.tools.cutout.ready) {
      const response = await fetch('/api/subjects/tools/saliency?columns=32', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
        signal,
      });
      if (!response.ok) throw new Error('BiRefNet could not analyze the photo.');
      const map = await response.json();
      analysis.subject = {
        cols: map.cols,
        rows: map.rows,
        values: map.values,
        box: map.box ? unitBox(map.box) : null,
      };
      analysis.engines.push('birefnet');
    } else notes.push('BiRefNet not installed');
  } catch (error) {
    if (signal?.aborted) throw error;
    notes.push('BiRefNet unavailable');
  }
  if (capabilities?.ocr?.ready)
    try {
      const result = ocrResultSchema.parse(
        await requestVision(
          'ocr',
          { image: await imagePayload(blob, 1024), profileId: capabilities.ocr.profileId },
          { signal },
        ),
      );
      analysis.text = result.lines
        .filter((l) => l.confidence >= 0.5)
        .slice(0, 60)
        .map((l) => ({ text: l.text.slice(0, 200), box: unitBox(l.box) }));
      analysis.engines.push('paddleocr');
    } catch (error) {
      if (signal?.aborted) throw error;
      notes.push('PaddleOCR failed');
    }
  else if (capabilities) notes.push('PaddleOCR not installed');
  if (capabilities?.florence?.ready)
    try {
      const evidence = florenceReferenceSchema.parse(
        await requestVision(
          'reference',
          { image: await imagePayload(blob, 1024), profileId: capabilities.florence.profileId },
          { signal },
        ),
      );
      analysis.objects = evidence.objects
        .slice(0, 40)
        .map((o) => ({ label: o.label.slice(0, 100), box: unitBox(o.box) }));
      analysis.engines.push('florence2');
    } catch (error) {
      if (signal?.aborted) throw error;
      notes.push('Florence-2 failed');
    }
  else if (capabilities) notes.push('Florence-2 not installed');
  return { analysis: photoAnalysisSchema.parse(analysis), notes };
}
