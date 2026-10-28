import { readBlueprint } from './helpers/editor.js';
import { test, expect } from '@playwright/test';

test('legacy BANNER2 headline is centered in a new reference revision and Studio adopts it with Match blueprints', async ({
  page,
}, testInfo) => {
  await page.goto('/blueprints/BANNER2-300x600?market=BANNER2');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  // Isolated local-storage fixture reproduces the previously saved offset version.
  const before = await page.evaluate(async () => {
    const { loadProject, saveProject } = await import('/src/core/storage.js');
    const { activeRevision } = await import('/src/data/defaults.js');
    const p = await loadProject();
    const entry = p.blueprints.find((item) => item.id === 'BANNER2-300x600');
    const original = activeRevision(entry);
    const shifted = structuredClone(original);
    shifted.id = 'legacy-shifted-banner2-headline';
    shifted.number = 2;
    Object.assign(
      shifted.blueprint.layers.find((layer) => layer.id === 'headline'),
      { x: 56, align: 'left' },
    );
    entry.versions.push(shifted);
    entry.activeVersionId = shifted.id;
    p.banners[entry.id].blueprintVersionId = shifted.id;
    await saveProject(p);
    return p;
  });
  await page.reload();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const diagram = page.getByRole('img', { name: 'Layout diagram 300 by 600' });
  const position = await diagram
    .locator('g')
    .filter({ has: page.locator('text', { hasText: /^headline$/ }) })
    .getAttribute('transform');
  expect(position).toBe('translate(30 105) rotate(0)');
  const after = await page.evaluate(async () =>
    (await import('/src/core/storage.js')).loadProject(),
  );
  const entry = after.blueprints.find((item) => item.id === 'BANNER2-300x600');
  expect(entry.versions).toHaveLength(3);
  expect(entry.versions.slice(0, 2)).toEqual(
    before.blueprints.find((item) => item.id === entry.id).versions,
  );
  expect(after.banners).toEqual(before.banners);
  expect(after.campaigns).toEqual(before.campaigns);
  await page.screenshot({
    path: testInfo.outputPath('banner2-headline-centered.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
  expect((await readBlueprint(page)).layers.find((layer) => layer.id === 'headline').x).toBe(56);
  await page.getByRole('button', { name: 'Back to formats' }).click();
  await page.getByRole('button', { name: 'Match blueprints', exact: true }).click();
  await page.getByRole('button', { name: 'Edit banner 300x600', exact: true }).click();
  expect((await readBlueprint(page)).layers.find((layer) => layer.id === 'headline').x).toBe(30);
  await expect(page.getByLabel('Alignment', { exact: true })).toHaveValue('center');
  await page.getByRole('button', { name: 'Back to formats' }).click();
  await page.reload();
  const reloaded = await page.evaluate(async () =>
    (await import('/src/core/storage.js')).loadProject(),
  );
  expect(reloaded.blueprints.find((item) => item.id === 'BANNER2-300x600').versions).toHaveLength(
    3,
  );
});
