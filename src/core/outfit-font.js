import { OUTFIT_FAMILY } from './typography.js';

let ready;
export function loadOutfit() {
  if (!ready)
    ready = (async () => {
      await import('@fontsource-variable/outfit');
      // Canvas cannot trigger a React repaint after a fallback font was measured.
      // Load both Latin subsets before exposing resources to any canvas consumer.
      const faces = [...document.fonts].filter(
        (face) => face.family.replaceAll('"', '').replaceAll("'", '') === OUTFIT_FAMILY,
      );
      if (!faces.length) throw new Error('Outfit font could not be registered.');
      await Promise.all(faces.map((face) => face.load()));
      return OUTFIT_FAMILY;
    })().catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}
