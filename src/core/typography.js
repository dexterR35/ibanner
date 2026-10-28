export const OUTFIT_FAMILY = 'Outfit Variable';

/** One type rule shared by measurement, preview, quality checks and export. */
export function canvasFont(layer, size, resources = {}) {
  if (typeof resources === 'string') resources = { fontFamily: resources };
  let weight = layer.fontWeight || 'bold';
  if (resources.typography === 'outfit') {
    weight =
      layer.source === 'legal'
        ? 400
        : layer.source === 'headline' || layer.source === 'cta' || layer.type === 'button'
          ? 800
          : 600;
  }
  return `${weight} ${size}px "${resources.fontFamily || 'Arial'}"`;
}
