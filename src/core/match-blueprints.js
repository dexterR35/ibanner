import { activeRevision, uid } from '../data/defaults.js';
import { layoutKey } from './auto-layout.js';

const layoutProperties = ['x', 'y', 'width', 'height', 'rotation', 'align', 'verticalAlign'];

/** Reuse the standard's boxes while retaining local copy, styling, crop and animation. */
export function matchBlueprintLayout(banner, blueprint) {
  let changed = false;
  const layers = banner.layers.map((layer) => {
    const standard = blueprint.layers.find(
      (item) => item.id === layer.id && item.type === layer.type,
    );
    if (!standard || layoutProperties.every((key) => layer[key] === standard[key])) return layer;
    changed = true;
    return { ...layer, ...Object.fromEntries(layoutProperties.map((key) => [key, standard[key]])) };
  });
  return changed ? { ...banner, layers } : banner;
}

export function matchMarketBlueprints(project, marketId) {
  const campaign = { ...project.campaigns[marketId], keepBlueprintBoxes: true };
  const banners = { ...project.banners };
  for (const entry of project.blueprints.filter((item) => item.marketId === marketId)) {
    const previous = banners[entry.id];
    const standard = activeRevision(entry).blueprint;
    let override = previous.override;
    let history = previous.history;
    if (override) {
      const matched = matchBlueprintLayout(override, standard);
      if (matched !== override) {
        // Preserve even imported overrides whose history did not include the current snapshot.
        if (JSON.stringify(history.at(-1)?.blueprint) !== JSON.stringify(override))
          history = [
            ...history,
            {
              id: uid(),
              createdAt: new Date().toISOString(),
              blueprint: structuredClone(override),
            },
          ];
        override = matched;
        history = [
          ...history,
          { id: uid(), createdAt: new Date().toISOString(), blueprint: structuredClone(matched) },
        ];
      }
    }
    banners[entry.id] = {
      ...previous,
      blueprintVersionId: entry.activeVersionId,
      override,
      history,
      arrangement: null,
      aiLayout: null,
      layoutKey: layoutKey(campaign),
    };
  }
  return { ...project, campaigns: { ...project.campaigns, [marketId]: campaign }, banners };
}
