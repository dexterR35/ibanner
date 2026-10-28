export async function visionCapabilities(signal, { modelVariant, modelPrecision } = {}) {
  const params = new URLSearchParams();
  if (modelVariant) params.set('model', modelVariant);
  if (modelPrecision && modelPrecision !== 'auto') params.set('precision', modelPrecision);
  const r = await fetch(`/api/subjects/vision/capabilities${params.size ? `?${params}` : ''}`, {
    signal: AbortSignal.any([AbortSignal.timeout(4000), ...(signal ? [signal] : [])]),
  });
  if (!r.ok) throw new Error('Optional local intelligence service is unavailable.');
  return r.json();
}
export async function requestVision(operation, payload, { signal } = {}) {
  const r = await fetch(`/api/subjects/vision/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.any([AbortSignal.timeout(600000), ...(signal ? [signal] : [])]),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Local inference failed.');
  return data;
}
/** The supplied copy's leading whole words within a character budget, or null. */
export function leadingWords(text, maxChars) {
  const words = String(text || '')
    .trim()
    .split(/\s+/);
  let lead = '';
  for (const word of words) {
    const next = lead ? `${lead} ${word}` : word;
    if (next.length > maxChars) break;
    lead = next;
  }
  return lead && lead !== String(text).trim() ? lead : null;
}
/** Shorter versions of one copy role from local Qwen; the user approves one per size. */
export async function suggestShorterCopy({ role, text, maxChars, locale }, { signal } = {}) {
  const result = await requestVision('shorten', { role, text, maxChars, locale }, { signal });
  const suggestions = Array.isArray(result.suggestions)
    ? result.suggestions.filter(
        (value) => typeof value === 'string' && value.length >= 1 && value.length <= maxChars,
      )
    : [];
  if (!suggestions.length) throw new Error('No suggestion fits this size. Edit the copy manually.');
  return suggestions.slice(0, 3);
}
export async function imagePayload(blob, maxEdge = 1024) {
  const image = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const c = canvas.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    image.close();
  }
}
