import { test, expect } from '@playwright/test';
import { readBlueprint } from './helpers/editor.js';
const stored = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const saved = (page) => expect(page.getByText('Saved locally', { exact: true })).toBeVisible();

test('new size opens a structural editor; geometry, mesh, layers and GIF timing save into its Studio banner', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/blueprints?market=BANNER1');
  await saved(page);
  const before = await stored(page);
  await page.getByRole('button', { name: 'Add size', exact: true }).click();
  await page.getByLabel('Width (px)').fill('420');
  await page.getByLabel('Height (px)').fill('320');
  await page.getByRole('button', { name: 'Create blueprint', exact: true }).click();
  await expect(page).toHaveURL(/\/blueprints\/BANNER1-420x320\/edit\?market=BANNER1$/);
  await expect(
    page.getByRole('heading', { name: 'Edit blueprint BANNER1 / 420 × 320' }),
  ).toBeVisible();
  await expect(page.getByLabel('Text / rows for this format')).toHaveCount(0);
  await expect(page.locator('.timeline')).toHaveCount(0);
  const initial = await readBlueprint(page),
    headline = initial.layers.find((l) => l.id === 'headline');
  const frame = await page.locator('.editor-artwork').boundingBox(),
    scale = frame.width / 420;
  const x = frame.x + (headline.x + headline.width / 2) * scale;
  const y = frame.y + (headline.y + headline.height / 2) * scale;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12 * scale, y + 5 * scale, { steps: 8 });
  await page.mouse.up();
  const moved = (await readBlueprint(page)).layers.find((l) => l.id === 'headline');
  expect(moved.x).toBe(headline.x + 12);
  expect(moved.y).toBe(headline.y + 5);
  await page.getByLabel('WIDTH', { exact: true }).fill(String(headline.width - 24));
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reposition image', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Fade shape', exact: true }).selectOption('mesh');
  await expect(page.getByLabel('Fade points', { exact: true })).toHaveValue('16');
  const hero = (await readBlueprint(page)).layers.find((l) => l.id === 'hero');
  const point = hero.fadeMesh.points[7];
  const px = frame.x + (hero.x + point.x * hero.width) * scale;
  const py = frame.y + (hero.y + point.y * hero.height) * scale;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py + 15 * scale, { steps: 8 });
  await page.mouse.up();
  const changed = (await readBlueprint(page)).layers.find((l) => l.id === 'hero');
  expect(changed.fadeMesh.points[7].y).toBeCloseTo(point.y + 15 / hero.height, 2);
  await page.screenshot({ path: testInfo.outputPath('blueprint-editor-mesh.png') });
  await page.getByRole('button', { name: 'Add subtitle layer', exact: true }).click();
  await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Vertical alignment', { exact: true })).toHaveValue('middle');
  await expect(page.getByLabel('Layer name', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Content binding', { exact: true })).toHaveCount(0);
  await page.getByLabel('Create GIF', { exact: true }).check();
  await page.getByRole('button', { name: 'Add part', exact: true }).click();
  await page.getByLabel('Part name', { exact: true }).fill('Closing blueprint part');
  await page.getByLabel('Duration (ms)', { exact: true }).fill('2400');
  const draft = await readBlueprint(page);
  await page.getByRole('button', { name: 'Save blueprint', exact: true }).click();
  await saved(page);
  const next = await stored(page),
    entry = next.blueprints.find((e) => e.id === draft.id);
  expect(entry.versions.at(-1).blueprint).toEqual(draft);
  expect(next.banners[draft.id].blueprintVersionId).toBe(entry.activeVersionId);
  expect(next.campaigns).toEqual(before.campaigns);
  for (const id of Object.keys(before.banners))
    expect(next.banners[id]).toEqual(before.banners[id]);
  await page.getByRole('button', { name: 'Edit in Studio', exact: true }).click();
  expect(await readBlueprint(page)).toEqual(draft);
  await page.getByLabel('Create GIF', { exact: true }).uncheck();
  await page.screenshot({ path: testInfo.outputPath('studio-from-blueprint.png') });
  await page.getByRole('button', { name: 'Back to formats', exact: true }).click();
  await page.goto('/blueprints/BANNER1-420x320/edit');
  await page.reload();
  expect(await readBlueprint(page)).toEqual(draft);
  expect(errors).toEqual([]);
});

test('older saved blueprint meshes update existing Studio overrides on load, without changing their content or crops', async ({
  page,
}) => {
  await page.goto('/assets?market=BANNER1');
  await saved(page);
  const fixture = await page.evaluate(async () => {
    const { loadProject, saveProject } = await import('/src/core/storage.js');
    const { activeRevision, resolveBanner } = await import('/src/data/defaults.js');
    const { createFadeMesh } = await import('/src/core/fade-mesh.js');
    const p = await loadProject();
    for (const id of ['BANNER1-300x250', 'BANNER2-300x250']) {
      const e = p.blueprints.find((e) => e.id === id),
        old = activeRevision(e);
      const bp = structuredClone(old.blueprint);
      bp.layers.find((l) => l.id === 'hero').fadeMesh = createFadeMesh();
      const v = { ...old, id: `legacy-mesh-${id}`, number: old.number + 1, blueprint: bp };
      e.versions.push(v);
      e.activeVersionId = v.id;
    }
    const e = p.blueprints.find((e) => e.id === 'BANNER1-300x250');
    const override = structuredClone(resolveBanner(e, p.banners[e.id]));
    override.layers.find((l) => l.id === 'headline').textOverride = 'KEPT LOCAL WORDS';
    Object.assign(
      override.layers.find((l) => l.id === 'hero'),
      { focalX: 0.7, zoom: 2 },
    );
    p.banners[e.id].override = override;
    await saveProject(p);
    return p;
  });
  await page.reload();
  await saved(page);
  await expect
    .poll(async () => (await stored(page)).banners['BANNER1-300x250'].syncedBlueprintVersionId)
    .toBe('legacy-mesh-BANNER1-300x250');
  const after = await stored(page);
  expect(after.banners['BANNER2-300x250']).toEqual(fixture.banners['BANNER2-300x250']);
  await page.goto('/campaign/BANNER1-300x250/edit?market=BANNER1');
  const actual = await readBlueprint(page);
  expect(actual.layers.find((l) => l.id === 'headline').textOverride).toBe('KEPT LOCAL WORDS');
  expect(actual.layers.find((l) => l.id === 'hero').zoom).toBe(2);
  expect(actual.layers.find((l) => l.id === 'hero').fadeMesh.points).toHaveLength(16);
  await page.getByRole('button', { name: 'Campaign image', exact: true }).click();
  await page.getByRole('button', { name: 'Arch', exact: true }).click();
  const local = await readBlueprint(page);
  await page.getByRole('button', { name: 'Save banner', exact: true }).click();
  await saved(page);
  await page.reload();
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  expect((await readBlueprint(page)).layers[0].fadeMesh).toEqual(local.layers[0].fadeMesh);
});
