import { activeRevision, resolveBanner, uid } from '../data/defaults.js';
import { validateBlueprint } from './schema.js';
import { reserveLegalFooter } from './legal-footer.js';
import { layoutKey } from './auto-layout.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fadeKeys = ['fade', 'fadeDirection', 'fadeMesh'];

/** Apply properties edited in the standard, retaining unrelated banner exceptions. */
export function applyBlueprintChanges(current, previous, next, fadeOnly = false) {
  const oldById = new Map(previous.layers.map((l) => [l.id, l]));
  const newById = new Map(next.layers.map((l) => [l.id, l]));
  let layers = current.layers.flatMap((layer) => {
    const old = oldById.get(layer.id),
      standard = newById.get(layer.id);
    if (!fadeOnly && old && !standard) return [];
    if (!old || !standard || (fadeOnly && standard.type !== 'image')) return [layer];
    const result = { ...layer };
    for (const key of fadeOnly
      ? fadeKeys
      : new Set([...Object.keys(old), ...Object.keys(standard)])) {
      if (!fadeOnly && equal(old[key], standard[key])) continue;
      if (standard[key] === undefined) delete result[key];
      else result[key] = structuredClone(standard[key]);
    }
    // Font bounds are one constraint: a changed standard bound must not conflict
    // with an unrelated local bound and make the merged banner invalid.
    if (result.minFontSize > result.fontSize) {
      if (!equal(old.fontSize, standard.fontSize)) result.minFontSize = result.fontSize;
      else result.fontSize = result.minFontSize;
    }
    return [result];
  });
  if (!fadeOnly) {
    for (const layer of next.layers)
      if (!oldById.has(layer.id) && !layers.some((l) => l.id === layer.id))
        layers.push(structuredClone(layer));
    if (
      !equal(
        previous.layers.map((l) => l.id),
        next.layers.map((l) => l.id),
      )
    ) {
      const byId = new Map(layers.map((l) => [l.id, l]));
      layers = [
        ...next.layers.map((l) => byId.get(l.id)).filter(Boolean),
        ...layers.filter((l) => !newById.has(l.id)),
      ];
    }
  }
  const result = { ...current, layers };
  if (!fadeOnly)
    for (const key of ['name', 'background', 'mode', 'repeat', 'scenes']) {
      if (!equal(previous[key], next[key])) result[key] = structuredClone(next[key]);
    }
  const ids = new Set(layers.map((l) => l.id));
  result.scenes = result.scenes.map((scene) => ({
    ...scene,
    tracks: Object.fromEntries(Object.entries(scene.tracks).filter(([id]) => ids.has(id))),
  }));
  return validateBlueprint(reserveLegalFooter(result));
}

function syncBanner(project, entry, previous, next, versionId, fadeOnly = false) {
  const old = project.banners[entry.id],
    current = resolveBanner(entry, old);
  const updated = applyBlueprintChanges(current, previous, next, fadeOnly);
  let history = old.history || [];
  if (!equal(current, updated)) {
    if (!equal(history.at(-1)?.blueprint, current))
      history = [
        ...history,
        { id: uid(), createdAt: new Date().toISOString(), blueprint: structuredClone(current) },
      ];
    history = [
      ...history,
      { id: uid(), createdAt: new Date().toISOString(), blueprint: structuredClone(updated) },
    ];
  }
  return {
    ...old,
    blueprintVersionId: versionId,
    syncedBlueprintVersionId: versionId,
    override: equal(updated, next) ? null : updated,
    arrangement: null,
    history,
    layoutKey: layoutKey(project.campaigns[entry.marketId]),
  };
}

/** Save an immutable standard revision and update just its corresponding Studio banner. */
export function saveBlueprintStandard(project, entryId, source, origin = 'blueprint-editor') {
  const entry = project.blueprints.find((e) => e.id === entryId);
  if (!entry) throw new Error('Blueprint not found.');
  const active = activeRevision(entry),
    blueprint = validateBlueprint(reserveLegalFooter(source));
  if (['id', 'marketId', 'width', 'height'].some((key) => blueprint[key] !== active.blueprint[key]))
    throw new Error('Keep this blueprint’s market and dimensions. Add a new size instead.');
  const changed = !equal(blueprint, active.blueprint);
  const revision = changed
    ? {
        id: uid(),
        number: Math.max(...entry.versions.map((v) => v.number)) + 1,
        status: 'draft',
        origin: active.origin === 'blueprint-editor' ? active.origin : origin,
        createdAt: new Date().toISOString(),
        blueprint,
      }
    : active;
  const pinned =
    entry.versions.find((v) => v.id === project.banners[entry.id].blueprintVersionId) || active;
  const banner = syncBanner(project, entry, pinned.blueprint, blueprint, revision.id);
  if (!changed && equal(banner, project.banners[entryId])) return project;
  return {
    ...project,
    blueprints: changed
      ? project.blueprints.map((e) =>
          e.id === entryId
            ? { ...e, activeVersionId: revision.id, versions: [...e.versions, revision] }
            : e,
        )
      : project.blueprints,
    banners: { ...project.banners, [entryId]: banner },
  };
}

/** Adopt previously saved mesh-only standards once, without resetting copy, crop or layout. */
export function syncSavedBlueprintFades(project, marketId) {
  let banners = project.banners;
  for (const entry of project.blueprints.filter((e) => e.marketId === marketId)) {
    const active = activeRevision(entry),
      old = banners[entry.id];
    if (old.syncedBlueprintVersionId === active.id || active.number === 1) continue;
    if (!active.blueprint.layers.some((l) => l.type === 'image' && l.fadeMesh)) continue;
    const previous = [...entry.versions]
      .reverse()
      .find(
        (v) =>
          v.number < active.number &&
          active.blueprint.layers.some(
            (l) =>
              l.type === 'image' &&
              l.fadeMesh &&
              !equal(l.fadeMesh, v.blueprint.layers.find((p) => p.id === l.id)?.fadeMesh),
          ),
      );
    if (!previous) continue;
    banners = {
      ...banners,
      [entry.id]: syncBanner(project, entry, previous.blueprint, active.blueprint, active.id, true),
    };
  }
  return banners === project.banners ? project : { ...project, banners };
}
