import { readFileSync } from 'node:fs';

/** A neutral synthetic test image from tests/fixtures as a data URL for page.evaluate. */
export const fixtureDataUrl = (name) =>
  `data:image/png;base64,${readFileSync(new URL(`../../fixtures/${name}`, import.meta.url)).toString('base64')}`;

/**
 * Campaigns start without a photo. Bind the synthetic photo fixture as the campaign image of
 * the given markets (without automatic subject search), then reload so Studio uses it.
 * Call after the workspace has loaded once.
 */
export async function bindFixtureHero(page, markets = ['BANNER1', 'BANNER2', 'BANNER3']) {
  await page.evaluate(
    async ({ src, markets }) => {
      const { loadProject, saveProject, storeAsset } = await import('/src/core/storage.js');
      const blob = await (await fetch(src)).blob();
      const asset = await storeAsset(new File([blob], 'hero.png', { type: 'image/png' }), 'hero');
      const p = await loadProject();
      if (!p.assets.some((a) => a.id === asset.id)) p.assets.push(asset);
      for (const id of markets)
        Object.assign(p.campaigns[id], { heroAssetId: asset.id, autoSubject: false });
      await saveProject(p);
    },
    { src: fixtureDataUrl('photo-300x600.png'), markets },
  );
  await page.reload();
  await page.getByText('Saved locally', { exact: true }).waitFor();
}
