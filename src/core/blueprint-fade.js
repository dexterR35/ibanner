import { validateBlueprint } from './schema.js';
import { activeRevision } from '../data/defaults.js';
import { saveBlueprintStandard } from './blueprint-edit.js';

/** Only fade settings change; reuse the standard save and Studio synchronization path. */
export function saveBlueprintFade(project, entryId, source) {
  const entry = project.blueprints.find((e) => e.id === entryId);
  if (!entry) throw new Error('Blueprint not found.');
  const active = activeRevision(entry);
  const blueprint = validateBlueprint({
    ...active.blueprint,
    layers: active.blueprint.layers.map((layer) => {
      const incoming = source.layers.find((l) => l.id === layer.id && l.type === 'image');
      return layer.type === 'image' && incoming
        ? {
            ...layer,
            fade: incoming.fade,
            fadeDirection: incoming.fadeDirection,
            ...(incoming.fadeMesh ? { fadeMesh: structuredClone(incoming.fadeMesh) } : {}),
          }
        : layer;
    }),
  });
  return saveBlueprintStandard(project, entryId, blueprint, 'fade-editor');
}
