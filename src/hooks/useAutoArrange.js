import { placeSubjectInFront } from '../core/subject-layer.js';
import { assessReadability, improveReadability, clearAutomaticHalos } from '../core/readability.js';
import { useEffect } from 'react';
import { arrangeBanner, layoutKey } from '../core/auto-layout.js';
import { currentAiLayout } from '../core/ai-arrange.js';
import { resolveBanner } from '../data/defaults.js';

export function arrangeMarket(project, marketId, resources, onlyPending = false, { context } = {}) {
  const campaign = project.campaigns[marketId],
    key = layoutKey(campaign);
  const banners = { ...project.banners };
  for (const entry of project.blueprints.filter((item) => item.marketId === marketId)) {
    const banner = banners[entry.id];
    if (onlyPending && banner.layoutKey === key) continue;
    // Always start from the saved design (or the geometry the AI arrangement chose for it),
    // so repeated reflows cannot drift or shrink the photo.
    const base =
      (!campaign.keepBlueprintBoxes && currentAiLayout(banner)) ||
      resolveBanner(entry, { ...banner, arrangement: null });
    let arranged = arrangeBanner(base, campaign, resources, {
      preserveFlow: !!banner.override,
      ...(context ? { context } : {}),
    });
    if (!arranged.layers.some((l) => l.fitPolicy === 'strict-v1')) {
      arranged = placeSubjectInFront(clearAutomaticHalos(arranged), campaign, resources);
      if (campaign.ctaColor)
        arranged = {
          ...arranged,
          layers: arranged.layers.map((l) =>
            l.type === 'button' ? { ...l, fill: campaign.ctaColor } : l,
          ),
        };
      if (campaign.autoReadability)
        arranged = improveReadability(arranged, assessReadability(arranged, campaign, resources));
    }
    banners[entry.id] = {
      ...banner,
      layoutKey: key,
      arrangement: arranged,
    };
  }
  return { ...project, banners };
}

export function useAutoArrange(project, setProject, marketId, resources) {
  const campaign = project.campaigns[marketId],
    key = layoutKey(campaign);
  const pending =
    campaign.autoArrange !== false &&
    project.blueprints.some(
      (entry) => entry.marketId === marketId && project.banners[entry.id].layoutKey !== key,
    );
  useEffect(() => {
    if (!pending || !resources) return;
    const timer = setTimeout(() => {
      setProject((current) => {
        if (
          !current.campaigns[marketId] ||
          current.campaigns[marketId].autoArrange === false ||
          layoutKey(current.campaigns[marketId]) !== key
        )
          return current;
        return arrangeMarket(current, marketId, resources, true);
      });
    }, 180);
    return () => clearTimeout(timer);
  }, [pending, key, resources, marketId, setProject]);
  return pending;
}
