/** Florence boxes by default; SAM 3 is an explicit precision request only. */
import { subjectServiceStatus, detectWithSam3, detectWithFlorence } from './subject-service.js';

export async function detectSubjects(blob, query, options = {}) {
  const { signal, onProgress = () => {}, onEngine = () => {} } = options;
  signal?.throwIfAborted();
  const engine = options.engine === 'sam3' ? 'sam3' : 'florence';
  const name = engine === 'sam3' ? 'SAM 3' : 'Florence-2';
  onEngine(engine);
  try {
    onProgress(`Checking local ${name}…`);
    const status = await subjectServiceStatus(signal, engine);
    if (!status.ready)
      throw new Error(status.issues.map((item) => item.message).join(' ') || 'Model needs setup.');
    onProgress(`Finding subjects with ${name}…`);
    return await (engine === 'sam3' ? detectWithSam3 : detectWithFlorence)(
      blob,
      query,
      signal,
      onProgress,
    );
  } catch (error) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    throw new Error(`${name} unavailable. ${error.message}`);
  }
}
