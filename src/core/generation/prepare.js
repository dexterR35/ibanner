import { analyzeAsset } from './intelligence.js';
import { pickSubjects } from './subjects.js';

const wholeImage = { x: 0, y: 0, width: 1, height: 1 };
function union(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}
const round = (value, step) => Math.round(value * step) / step;
/** Image text for Qwen: PaddleOCR lines when they were read, otherwise Florence-2 regions. */
export function planOcr(observations = {}) {
  const paddle = observations.ocr?.ocr;
  const lines = paddle || observations.florence?.ocr;
  if (!lines?.length) return {};
  return {
    ocrEngine: paddle ? 'paddleocr' : 'florence2',
    ocr: lines.slice(0, 20).map(({ text, box, confidence }) => ({
      text: text.slice(0, 200),
      confidence: round(confidence, 100),
      box: Object.fromEntries(Object.entries(box).map(([key, value]) => [key, round(value, 1000)])),
    })),
  };
}
/** Evidence is frozen in the batch; automatic analysis never edits the campaign or original. */
export async function prepareGeneration(
  campaign,
  correction,
  { signal, onProgress = () => {}, automatic = true, capabilities } = {},
) {
  const asset = { id: campaign.heroAssetId, kind: 'hero' };
  const selected = campaign.subjectFocus?.assetId === asset.id ? campaign.subjectFocus : null;
  const evidence = {
    focus: correction?.value?.focal || selected?.box || null,
    focusSource: correction?.value?.focal ? 'asset-correction' : selected ? selected.source : null,
    observations: {},
    notices: [],
  };
  if (automatic && !asset.id)
    evidence.notices.push('No campaign image uploaded for this market; image analysis skipped.');
  if (automatic && asset.id) {
    // Every model is optional: a missing one is reported and generation continues with less
    // evidence (no subject box means the photo keeps its centred crop).
    if (capabilities?.florence?.ready)
      try {
        onProgress('Analyzing image with Florence-2…', { stage: 'analysis' });
        const { result } = await analyzeAsset(asset, 'florence', { signal });
        evidence.observations.florence = result;
      } catch (error) {
        signal?.throwIfAborted();
        evidence.notices.push(`Florence-2: ${error.message}`);
      }
    else
      evidence.notices.push(
        `Florence-2 unavailable (${capabilities?.florence?.message || 'local AI service offline'}); no subject detection.`,
      );
    // PaddleOCR reads text more faithfully than Florence; Florence keeps the object boxes.
    if (capabilities?.ocr?.ready)
      try {
        onProgress('Reading image text with PaddleOCR…', { stage: 'analysis' });
        const { result: text } = await analyzeAsset(asset, 'ocr', { signal });
        if (text.provenance?.engine === 'rapidocr') evidence.observations.ocr = text;
      } catch (error) {
        signal?.throwIfAborted();
        evidence.notices.push(`PaddleOCR: ${error.message} Using Florence-2 text.`);
      }
    // Pixel palette is a separate measurement, never a replacement for Florence regions.
    try {
      const { result: visual } = await analyzeAsset(asset, 'visual', { signal });
      evidence.observations.visual = visual;
    } catch (error) {
      signal?.throwIfAborted();
      evidence.notices.push(`visual: ${error.message}`);
    }
    // What the photo shows (people, animals, objects), from every detector that ran.
    const picked = pickSubjects([
      ...(evidence.observations.subjects?.subjects || []),
      ...(evidence.observations.florence?.provenance?.objects || []),
    ]);
    evidence.subjects = picked.subjects;
    if (!evidence.focus && picked.focus) {
      evidence.focus = picked.focus;
      evidence.focusSource = 'florence';
    }
  }
  if (!evidence.focus) {
    evidence.focus = wholeImage;
    evidence.focusSource = 'whole-image-fallback';
  }
  const protectedRegions = correction?.value?.protectedRegions || [];
  if (protectedRegions.length) evidence.focus = union([evidence.focus, ...protectedRegions]);
  return evidence;
}
