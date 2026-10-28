import { test, expect } from '@playwright/test';
import { readBlueprint } from './helpers/editor.js';

test('legacy spacing becomes 1 in every market and editor, persists, and exports the same frame', async ({
  page,
}, testInfo) => {
  await page.goto('/campaign?market=BANNER1');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { loadProject, saveProject } = await import('/src/core/storage.js');
    const p = await loadProject();
    delete p.lineSpacingVersion;
    for (const e of p.blueprints) {
      const active = e.versions.find((v) => v.id === e.activeVersionId);
      active.blueprint.layers.forEach((l) => {
        l.lineHeight = 1.05;
      });
      const b = p.banners[e.id];
      b.override = structuredClone(active.blueprint);
      b.override.layers.find((l) => l.id === 'headline').textOverride = 'LOCAL\nWORDS';
      b.arrangement = structuredClone(b.override);
    }
    await saveProject(p);
  });
  await page.reload();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { resolveBanner, activeRevision } = await import('/src/data/defaults.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const p = await loadProject();
    const values = p.blueprints.flatMap((entry) =>
      [
        activeRevision(entry).blueprint,
        resolveBanner(entry, p.banners[entry.id]),
        p.banners[entry.id].override,
        p.banners[entry.id].arrangement,
      ]
        .filter(Boolean)
        .flatMap((bp) => bp.layers.map((l) => l.lineHeight)),
    );
    const entry = p.blueprints.find((e) => e.id === 'BANNER1-300x250'),
      bp = resolveBanner(entry, p.banners[entry.id]);
    const campaign = p.campaigns.BANNER1,
      resources = await loadResources(campaign);
    const preview = canvasOf(bp.width, bp.height);
    renderFrame(preview, bp, campaign, resources);
    const blob = await renderOutput(bp, campaign, resources, 'png');
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return {
      allOne: values.every((v) => v === 1),
      marker: p.lineSpacingVersion,
      samePixels: dataUrl === preview.toDataURL(),
    };
  });
  expect(result).toEqual({ allOne: true, marker: 1, samePixels: true });
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Text / rows for this format', { exact: true })).toHaveValue(
    'LOCAL\nWORDS',
  );
  for (const name of ['Offer / subtitle', 'Call to action', 'Market legal']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue('1');
  }
  await page.screenshot({ path: testInfo.outputPath('line-spacing-one.png') });
  await page.goto('/blueprints/BANNER2-300x600/edit');
  await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue('1');
  expect((await readBlueprint(page)).layers.every((l) => l.lineHeight === 1)).toBe(true);
  await page.reload();
  await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue('1');
});
