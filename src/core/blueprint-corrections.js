import { layoutCorrections } from '../data/layout-corrections.js';
import { validateBlueprint } from './schema.js';
import { reserveLegalFooter } from './legal-footer.js';

/** Apply declared geometry corrections without changing text, assets or other layers. */
export function correctBlueprintLayout(blueprint) {
  let result = blueprint;
  for (const rule of layoutCorrections) {
    if (
      rule.marketId !== result.marketId ||
      rule.width !== result.width ||
      rule.height !== result.height
    )
      continue;
    const layer = result.layers.find((item) => item.id === rule.layerId);
    // Rotated or moving layouts need an individual review rather than this static correction.
    if (
      !layer ||
      layer.type !== 'text' ||
      layer.rotation ||
      result.scenes.some((scene) => scene.tracks[layer.id]?.dx || scene.tracks[layer.id]?.dy)
    )
      continue;
    const x = rule.centerX ? (result.width - layer.width) / 2 : layer.x;
    if (layer.x === x && layer.align === rule.align) continue;
    result = {
      ...result,
      layers: result.layers.map((item) =>
        item.id === layer.id ? { ...item, x, align: rule.align } : item,
      ),
    };
  }
  return reserveLegalFooter(result);
}

/** Append a corrected active revision; pinned banners, overrides and old versions stay intact. */
export function applyBlueprintCorrections(project) {
  let changed = false;
  const blueprints = project.blueprints.map((entry) => {
    const active = entry.versions.find((version) => version.id === entry.activeVersionId);
    if (active.status !== 'draft' || active.origin === 'blueprint-editor') return entry;
    // Footer separation also applies to measured drafts; previous revisions remain intact
    // and unrelated centering rules do not apply to them.
    const corrected = entry.measured
      ? reserveLegalFooter(active.blueprint)
      : correctBlueprintLayout(active.blueprint);
    if (corrected === active.blueprint) return entry;
    const revision = {
      id: crypto.randomUUID(),
      number: Math.max(...entry.versions.map((version) => version.number)) + 1,
      status: 'draft',
      createdAt: new Date().toISOString(),
      blueprint: validateBlueprint(corrected),
    };
    changed = true;
    return { ...entry, activeVersionId: revision.id, versions: [...entry.versions, revision] };
  });
  return changed ? { ...project, blueprints } : project;
}
