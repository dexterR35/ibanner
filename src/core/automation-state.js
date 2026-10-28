import { arrangementSummary, layoutKey } from './auto-layout.js';
import { resolveBanner } from '../data/defaults.js';

export const AUTOMATION_HINTS = {
  design: 'The saved design holds this copy. Only the photo crop adapts to the subject.',
  reflow: 'Copy was reflowed so every line stays readable. The photo frame is unchanged.',
  photo: 'The photo frame was resized to make room for the copy.',
  fixed: 'Match blueprints is on: boxes stay fixed and text fits inside them.',
  manual: 'Saved editor changes. Automatic arrangement keeps this banner as edited.',
  pending: 'Arranging for the latest copy and image…',
  stale: 'Copy or image changed while automatic arrangement was off. Use Arrange now.',
};

/** What automatic arrangement did to one banner. Pure; used for Studio badges and counts. */
export function automationState(entry, banner, campaign) {
  if (!banner || !campaign) return null;
  const current = banner.layoutKey === layoutKey(campaign);
  if (!current)
    return campaign.autoArrange === false
      ? { kind: 'stale', label: 'Out of date' }
      : { kind: 'pending', label: 'Updating…' };
  if (!banner.arrangement) return banner.override ? { kind: 'manual', label: 'Edited' } : null;
  if (campaign.keepBlueprintBoxes) return { kind: 'fixed', label: 'Blueprint boxes' };
  return arrangementSummary(
    resolveBanner(entry, { ...banner, arrangement: null }),
    banner.arrangement,
  );
}

/** Per-market counts for the Studio automation status chip. */
export function automationCounts(entries, banners, campaign) {
  const counts = { total: entries.length, stale: 0, pending: 0, reflow: 0, photo: 0 };
  for (const entry of entries) {
    const state = automationState(entry, banners[entry.id], campaign);
    if (state && state.kind in counts) counts[state.kind] += 1;
  }
  return counts;
}
