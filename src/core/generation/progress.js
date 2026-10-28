/** Completed workflow units, never an estimate of model inference completion. */
export function workflowProgress(groups, groupIndex, event, previous = 0) {
  const units = (group) => group.outputs.length + 4;
  const total = groups.reduce((sum, group) => sum + units(group), 0);
  const before = groups.slice(0, groupIndex).reduce((sum, group) => sum + units(group), 0);
  const step =
    {
      source: 0,
      analysis: 1,
      cutout: 2,
      planner: 3,
      layout: 4,
      complete: units(groups[groupIndex]),
    }[event?.stage] ?? 0;
  const completed = Math.max(
    previous,
    Math.min(total, before + step + (event?.stage === 'layout' ? event.index || 0 : 0)),
  );
  return { completed, total, percent: total ? Math.floor((100 * completed) / total) : 0 };
}
