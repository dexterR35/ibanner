import test from 'node:test';
import assert from 'node:assert/strict';
import { pickSubjects } from '../src/core/generation/subjects.js';
import { validateProject } from '../src/core/storage.js';
import { initialProject } from '../src/data/defaults.js';

test('subjects come from people and nearby props, never the setting', () => {
  const { subjects, focus } = pickSubjects([
    { label: 'football', box: { x: 0.88, y: 0.23, width: 0.04, height: 0.06 } },
    { label: 'human face', box: { x: 0.32, y: 0.2, width: 0.04, height: 0.08 } },
    { label: 'man', box: { x: 0.02, y: 0.14, width: 0.48, height: 0.68 } },
    { label: 'man', box: { x: 0.57, y: 0.3, width: 0.31, height: 0.34 } },
    { label: 'poster', box: { x: 0, y: 0, width: 1, height: 1 } },
    { label: 'stadium', box: { x: 0, y: 0.5, width: 1, height: 0.5 } },
  ]);
  assert.deepEqual(
    subjects.map((s) => [s.label, s.kind]),
    [
      ['man', 'living'],
      ['man', 'living'],
      ['football', 'prop'],
    ],
  );
  // Focus is the main player; the second player and the ball stay listed for the planner.
  assert.deepEqual(focus, { x: 0.02, y: 0.14, width: 0.48, height: 0.68 });
  assert.equal(subjects.filter((s) => s.primary).length, 1);
  // Without people, the largest real object is the subject (a product, a car, a chip stack).
  const objects = pickSubjects([
    { label: 'car', box: { x: 0.3, y: 0.3, width: 0.5, height: 0.4 } },
    { label: 'sky', box: { x: 0, y: 0, width: 1, height: 0.4 } },
  ]);
  assert.equal(objects.subjects[0].label, 'car');
  assert.deepEqual(
    pickSubjects([{ label: 'sky', box: { x: 0, y: 0, width: 1, height: 0.5 } }]).focus,
    null,
  );
});

test('approved copy is validated on load and legal copy cannot be shortened', () => {
  const project = initialProject();
  project.campaigns.BANNER1.copyFits = { '728x90': { headline: 'Lyhyt' } };
  assert.doesNotThrow(() => validateProject(structuredClone(project)));
  project.campaigns.BANNER1.copyFits = { '728x90': { legal: '18+' } };
  assert.throws(() => validateProject(structuredClone(project)), /approved copy/);
});

test('the leading-words option keeps whole words of the supplied copy only', async () => {
  const { leadingWords } = await import('../src/core/generation/planner.js');
  assert.equal(leadingWords('OTTELUILTA ALKAA TÄNÄÄN', 10), 'OTTELUILTA');
  assert.equal(leadingWords('OTTELUILTA ALKAA TÄNÄÄN', 17), 'OTTELUILTA ALKAA');
  assert.equal(leadingWords('OTTELUILTA', 5), null);
  assert.equal(leadingWords('Short', 40), null);
});
