import { activeRevision, resolveBanner } from '../data/defaults.js';
import { saveBlueprintStandard } from './blueprint-edit.js';
import { splitTallHeadline } from './tall-headline.js';

/** Update supplied draft standards once; retain authored standards and revision history. */
export function migrateTallHeadlines(project) {
  for (const entry of project.blueprints) {
    const active = activeRevision(entry);
    if (active.status !== 'draft' || active.origin === 'blueprint-editor') continue;
    const corrected = splitTallHeadline(active.blueprint);
    if (corrected === active.blueprint) continue;
    const current = resolveBanner(entry, project.banners[entry.id]);
    const localTitle = current.layers.find((l) => l.id === 'headline');
    project = saveBlueprintStandard(project, entry.id, corrected, 'tall-headline');
    if (localTitle?.textOverride != null && localTitle.sourcePart === 'all') {
      const banner = project.banners[entry.id];
      const nextEntry = project.blueprints.find((e) => e.id === entry.id);
      const bp = resolveBanner(nextEntry, banner);
      const lines = localTitle.textOverride.split('\n');
      project = {
        ...project,
        banners: {
          ...project.banners,
          [entry.id]: {
            ...banner,
            override: {
              ...bp,
              layers: bp.layers.map((l) =>
                l.id === 'headline'
                  ? { ...l, textOverride: lines[0] }
                  : l.id === 'headline-support'
                    ? { ...l, textOverride: lines.slice(1).join('\n') }
                    : l,
              ),
            },
          },
        },
      };
    }
  }
  return project;
}
