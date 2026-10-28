/**
 * Decide what the photo is "about" from detector boxes (Florence-2 objects, SAM 3 subjects).
 * Pure and deterministic: the same detections always give the same subjects and focus.
 */
const LIVING =
  /\b(person|people|man|men|woman|women|boy|girl|child|kid|player|athlete|human body|human|footballer|dog|cat|horse|bird|animal|lion|tiger)\b/i;
const FACE = /\bface\b/i;
// Labels that describe the setting rather than a subject.
const SETTING =
  /\b(sky|cloud|grass|field|pitch|stadium|arena|building|wall|floor|ground|road|tree|forest|crowd|audience|spectators|text|banner|sign|poster|light|lamp|background|scene|water|sea|mountain)\b/i;

const area = (b) => b.width * b.height;
const union = (boxes) => {
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};
const grow = (b, f) => ({
  x: b.x - b.width * f,
  y: b.y - b.height * f,
  width: b.width * (1 + 2 * f),
  height: b.height * (1 + 2 * f),
});
const touches = (a, b) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/**
 * @param detections [{label, box:{x,y,width,height}}] in normalized source coordinates
 * @returns {subjects:[{label, box, kind}], focus: box|null}
 */
export function pickSubjects(detections = []) {
  const usable = detections.filter(
    (d) =>
      d?.box &&
      typeof d.label === 'string' &&
      area(d.box) > 0.0004 &&
      area(d.box) < 0.85 &&
      !SETTING.test(d.label),
  );
  const living = usable.filter((d) => LIVING.test(d.label) && !FACE.test(d.label));
  const largest = Math.max(0, ...living.map((d) => area(d.box)));
  // Small far-away people (crowd, referee in the back) are not the subject.
  const main = living.filter((d) => area(d.box) >= largest * 0.2);
  let subjects = main.map((d) => ({ label: d.label, box: d.box, kind: 'living' }));
  if (!subjects.length) {
    const objects = usable
      .filter((d) => !FACE.test(d.label))
      .sort((a, b) => area(b.box) - area(a.box));
    if (objects[0]) subjects = [{ label: objects[0].label, box: objects[0].box, kind: 'object' }];
    else {
      const face = usable.find((d) => FACE.test(d.label));
      if (face) subjects = [{ label: face.label, box: face.box, kind: 'living' }];
    }
  }
  if (!subjects.length) return { subjects: [], focus: null };
  // The main subject anchors the layout; others may crop or fade (a designer's choice).
  subjects.sort((a, b) => area(b.box) - area(a.box));
  subjects[0].primary = true;
  // Props the subjects interact with (the ball above a header, a trophy in hand).
  const reach = grow(union(subjects.map((s) => s.box)), 0.25);
  const primaryReach = grow(subjects[0].box, 0.25);
  for (const d of usable)
    if (
      !LIVING.test(d.label) &&
      !FACE.test(d.label) &&
      !subjects.some((s) => s.box === d.box) &&
      area(d.box) < 0.25 &&
      touches(reach, d.box)
    )
      subjects.push({
        label: d.label,
        box: d.box,
        kind: 'prop',
        ...(touches(primaryReach, d.box) ? { primary: true } : {}),
      });
  const focus = union(subjects.filter((s) => s.primary).map((s) => s.box));
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const x = clamp(focus.x),
    y = clamp(focus.y);
  return {
    subjects,
    focus: {
      x,
      y,
      width: Math.min(1 - x, clamp(focus.x + focus.width) - x),
      height: Math.min(1 - y, clamp(focus.y + focus.height) - y),
    },
  };
}
