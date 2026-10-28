/** Tall BANNER1 layouts separate the white title from its pale-blue supporting copy. */
export function splitTallHeadline(bp) {
  if (bp.marketId !== 'BANNER1' || bp.height !== 600 || ![160, 300].includes(bp.width)) return bp;
  const existing = bp.layers.find((l) => l.id === 'headline-support');
  if (existing) {
    // Upgrade the initial estimated blue to the color sampled from the reference.
    return existing.fill === '#a8c5ee'
      ? { ...bp, layers: bp.layers.map((l) => (l === existing ? { ...l, fill: '#c5e6ff' } : l)) }
      : bp;
  }
  const headline = bp.layers.find((l) => l.id === 'headline');
  if (!headline || headline.source !== 'headline' || headline.sourcePart !== 'all') return bp;
  const narrow = bp.width === 160;
  const titleBox = narrow
    ? { x: 15, y: 144, width: 130, height: 22 }
    : { x: 40, y: 90, width: 230, height: 34 };
  const supportBox = narrow
    ? { x: 15, y: 168, width: 130, height: 40 }
    : { x: 65, y: 146, width: 170, height: 52 };
  const common = {
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1,
    textFlow: 'manual',
    rotation: 0,
  };
  const support = {
    ...headline,
    ...supportBox,
    ...common,
    id: 'headline-support',
    name: 'Supporting headline',
    sourcePart: 'remaining-lines',
    fill: '#c5e6ff',
    maxLines: 2,
    textOverride:
      headline.textOverride == null ? null : headline.textOverride.split('\n').slice(1).join('\n'),
    glow: { ...headline.glow, enabled: false },
  };
  return {
    ...bp,
    layers: bp.layers.flatMap((l) =>
      l.id !== headline.id
        ? [l]
        : [
            {
              ...l,
              ...titleBox,
              ...common,
              sourcePart: 'first-line',
              maxLines: 1,
              textOverride: l.textOverride == null ? null : l.textOverride.split('\n')[0],
            },
            support,
          ],
    ),
    scenes: bp.scenes.map((scene) => ({
      ...scene,
      tracks: { ...scene.tracks, [support.id]: { ...scene.tracks[headline.id] } },
    })),
  };
}
