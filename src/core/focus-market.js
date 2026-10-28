import { resolveBanner } from '../data/defaults.js';
import { layoutKey } from './auto-layout.js';
import { focusBlueprint } from './subject-position.js';

/** Apply an explicit subject placement to the current boxes, even with auto arrangement off. */
export function focusMarket(project, marketId, resources) {
  const campaign = project.campaigns[marketId];
  if (
    !resources?.hero ||
    !campaign?.heroAssetId ||
    campaign.subjectFocus?.assetId !== campaign.heroAssetId
  )
    return project;
  const banners = { ...project.banners };
  for (const entry of project.blueprints.filter((item) => item.marketId === marketId)) {
    const banner = banners[entry.id];
    banners[entry.id] = {
      ...banner,
      arrangement: focusBlueprint(resolveBanner(entry, banner), campaign, resources).blueprint,
      layoutKey: layoutKey(campaign),
    };
  }
  return { ...project, banners };
}
