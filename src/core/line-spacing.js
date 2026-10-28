import { activeRevision, resolveBanner, uid } from '../data/defaults.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function singleSpacing(blueprint) {
  if (!blueprint || blueprint.layers.every((layer) => layer.lineHeight === 1)) return blueprint;
  return {
    ...blueprint,
    layers: blueprint.layers.map((layer) =>
      layer.lineHeight === 1 ? layer : { ...layer, lineHeight: 1 },
    ),
  };
}

/** Apply the requested workspace-wide spacing change once, preserving immutable history. */
export function migrateLineSpacing(project) {
  if (project.lineSpacingVersion === 1) return project;
  let banners = project.banners;
  const blueprints = project.blueprints.map((entry) => {
    const active = activeRevision(entry);
    const standard = singleSpacing(active.blueprint);
    const draft = singleSpacing(entry.draft);
    let updatedEntry = entry;
    if (standard !== active.blueprint) {
      const revision = {
        ...active,
        id: uid(),
        number: Math.max(...entry.versions.map((version) => version.number)) + 1,
        status: 'draft',
        createdAt: new Date().toISOString(),
        blueprint: standard,
      };
      updatedEntry = {
        ...entry,
        activeVersionId: revision.id,
        versions: [...entry.versions, revision],
      };
    }
    if (draft !== entry.draft) updatedEntry = { ...updatedEntry, draft };

    const old = project.banners[entry.id];
    const current = resolveBanner(entry, old);
    const updated = singleSpacing(current);
    const base = resolveBanner(entry, { ...old, arrangement: null });
    const nextBase = singleSpacing(base);
    const override = old.override
      ? singleSpacing(old.override)
      : nextBase !== base
        ? nextBase
        : null;
    const arrangement = singleSpacing(old.arrangement);
    // A typography-only standard revision must not replay an already adopted mesh.
    const syncedBlueprintVersionId =
      old.syncedBlueprintVersionId === active.id
        ? updatedEntry.activeVersionId
        : old.syncedBlueprintVersionId;
    if (
      override !== old.override ||
      arrangement !== old.arrangement ||
      syncedBlueprintVersionId !== old.syncedBlueprintVersionId
    ) {
      let history = old.history;
      if (!same(current, updated)) {
        if (!same(history.at(-1)?.blueprint, current))
          history = [
            ...history,
            { id: uid(), createdAt: new Date().toISOString(), blueprint: structuredClone(current) },
          ];
        history = [
          ...history,
          { id: uid(), createdAt: new Date().toISOString(), blueprint: structuredClone(updated) },
        ];
      }
      banners = {
        ...banners,
        [entry.id]: {
          ...old,
          override,
          arrangement,
          history,
          ...(syncedBlueprintVersionId ? { syncedBlueprintVersionId } : {}),
        },
      };
    }
    return updatedEntry;
  });
  return { ...project, blueprints, banners, lineSpacingVersion: 1 };
}
