import { boundText } from './render.js';

/**
 * Blueprint <-> PosterO layout tree. A tree is an SVG string: the canvas, then one <rect> per
 * arrangeable element with id "<role>_<n>" and, for GIFs, the 1-based parts where it shows.
 * Only geometry travels through the tree; styling, bindings and timing stay in the blueprint.
 */

const roleOf = (layer) => {
  if (layer.type === 'image' && layer.source === 'hero') return 'photo';
  if (layer.type === 'logo') return 'logo';
  if (layer.type === 'button') return 'cta';
  if (layer.type !== 'text') return null;
  return ['headline', 'subtitle', 'legal'].includes(layer.source) ? layer.source : 'text';
};

const scenesOf = (bp, layer) =>
  bp.scenes
    .map((scene, i) => (layer.visible && scene.tracks[layer.id]?.visible !== false ? i + 1 : 0))
    .filter(Boolean);

/** Element ids for the layers a layout model may move, in paint order. */
export function treeElements(bp, campaign = null) {
  const counts = {},
    elements = [];
  for (const layer of bp.layers) {
    const role = roleOf(layer);
    // Rotated or moving layers keep their authored geometry.
    const moving = bp.scenes.some((s) => s.tracks[layer.id]?.dx || s.tracks[layer.id]?.dy);
    if (!role || !layer.visible || layer.rotation || moving) continue;
    const scenes = bp.mode === 'animated' ? scenesOf(bp, layer) : [1];
    if (!scenes.length) continue;
    const index = (counts[role] = (counts[role] ?? -1) + 1);
    const text =
      campaign && layer.type !== 'image' && layer.type !== 'logo' ? boundText(layer, campaign) : '';
    elements.push({
      id: `${role}_${index}`,
      layerId: layer.id,
      role,
      ...(text ? { chars: text.replace(/\s+/g, ' ').trim().length } : {}),
      ...(role === 'cta' && text ? { text } : {}),
      ...(bp.mode === 'animated' ? { scenes } : {}),
      ...(layer.sourcePart === 'remaining-lines' ? { note: 'supporting headline lines' } : {}),
    });
  }
  return elements;
}

const round = (v) => Math.round(v);

/** The blueprint as a layout tree (used for in-context examples). */
export function blueprintToTree(bp, campaign = null) {
  const byLayer = new Map(bp.layers.map((l) => [l.id, l]));
  const rects = treeElements(bp, campaign).map((element) => {
    const l = byLayer.get(element.layerId);
    const scene = element.scenes ? ` data-scene="${element.scenes.join(',')}"` : '';
    const fade =
      element.role === 'photo' && l.fade > 0 && l.fadeDirection
        ? ` data-fade="${l.fadeDirection}"`
        : '';
    return {
      role: element.role,
      svg: `<rect id="${element.id}" x="${round(l.x)}" y="${round(l.y)}" width="${round(l.width)}" height="${round(l.height)}"${fade}${scene}/>`,
    };
  });
  // Copy first, photo last: the photo is a frame placed around the copy, not a backdrop.
  const ordered = [
    ...rects.filter((r) => r.role !== 'photo'),
    ...rects.filter((r) => r.role === 'photo'),
  ];
  return `<svg width="${bp.width}" height="${bp.height}">${ordered.map((r) => r.svg).join('')}</svg>`;
}

/** Apply model boxes (keyed by element id) to a blueprint; missing ids keep their geometry. */
export function applyTree(bp, boxes, elements = treeElements(bp)) {
  const patch = new Map(elements.filter((e) => boxes[e.id]).map((e) => [e.layerId, boxes[e.id]]));
  if (!patch.size) return bp;
  return {
    ...bp,
    layers: bp.layers.map((l) => {
      const box = patch.get(l.id);
      if (!box) return l;
      const width = Math.max(4, Math.min(bp.width, Math.round(box.width))),
        height = Math.max(4, Math.min(bp.height, Math.round(box.height)));
      return {
        ...l,
        x: Math.max(0, Math.min(bp.width - width, Math.round(box.x))),
        y: Math.max(0, Math.min(bp.height - height, Math.round(box.y))),
        width,
        height,
      };
    }),
  };
}
