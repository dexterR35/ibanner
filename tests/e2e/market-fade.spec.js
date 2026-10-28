import { test, expect } from '@playwright/test';
import { bindFixtureHero } from './helpers/fixtures.js';
import { readFile } from 'node:fs/promises';

const project = (page) =>
  page.evaluate(async () => (await import('/src/core/storage.js')).loadProject());
const settled = async (page) => {
  await expect(page.getByRole('button', { name: 'Image fade', exact: true })).toBeEnabled();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
};

for (const market of ['BANNER1', 'BANNER2', 'BANNER3']) {
  test(`${market} fade toggle preserves designs, persists independently and restores preview pixels`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/campaign?market=${market}`);
    await settled(page);
    await bindFixtureHero(page, [market]);
    await settled(page);
    const toggle = page.getByRole('button', { name: 'Image fade', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const before = await project(page);
    const size = '300x250';
    const card = page
      .locator('.banner-card')
      .filter({ has: page.getByRole('button', { name: `Edit banner ${size}`, exact: true }) });
    const pixels = () => card.locator('canvas').evaluate((canvas) => canvas.toDataURL());
    const on = await pixels();
    await toggle.click();
    await settled(page);
    await expect(toggle).toHaveText('Fade: Off');
    expect(await pixels()).not.toBe(on);
    const off = await project(page);
    expect(off.campaigns[market].imageFadeEnabled).toBe(false);
    expect(off.blueprints).toEqual(before.blueprints);
    expect(off.banners).toEqual(before.banners);
    for (const id of Object.keys(before.campaigns))
      if (id !== market) expect(off.campaigns[id]).toEqual(before.campaigns[id]);
    const wait = page.waitForEvent('download');
    await card.getByRole('button', { name: `Export ${size}`, exact: true }).click();
    expect(
      `data:image/png;base64,${(await readFile(await (await wait).path())).toString('base64')}`,
    ).toBe(await pixels());
    await page.reload();
    await settled(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({ path: testInfo.outputPath(`${market}-fade-off.png`) });
    await toggle.click();
    await settled(page);
    expect(await pixels()).toBe(on);
    await expect(toggle).toHaveText('Fade: On');
    await page.screenshot({ path: testInfo.outputPath(`${market}-fade-on.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(toggle).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('market switch bypasses linear and mesh fades in preview, PNG and GIF without removing shadows', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER3');
  await settled(page);
  const result = await page.evaluate(async () => {
    const { createBlueprint, campaignFor, DEFAULT_MARKETS } = await import('/src/data/defaults.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const { createFadeMesh } = await import('/src/core/fade-mesh.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { validateProject, loadProject } = await import('/src/core/storage.js');
    const p = await loadProject();
    p.campaigns.BANNER3.imageFadeEnabled = 'off';
    let invalidRejected = false;
    try {
      validateProject(p);
    } catch (e) {
      invalidRejected = /image fade/.test(e.message);
    }
    const bp = createBlueprint('BANNER1', 300, 250);
    bp.background = '#000000';
    bp.layers = [
      {
        ...bp.layers[0],
        x: 20,
        y: 20,
        width: 200,
        height: 180,
        fade: 0.4,
        fadeDirection: 'left',
        shadow: { enabled: true, color: '#ff0000', opacity: 1, blur: 8, offsetX: 10, offsetY: 0 },
      },
    ];
    bp.scenes[0].tracks = {};
    const campaign = campaignFor(DEFAULT_MARKETS[0]);
    const hero = canvasOf(200, 180);
    hero.getContext('2d').fillStyle = '#ffffff';
    hero.getContext('2d').fillRect(0, 0, 200, 180);
    const resources = { hero },
      canvas = canvasOf(300, 250);
    const pixels = (c) => Array.from(c.getContext('2d').getImageData(0, 0, 300, 250).data);
    const results = [];
    for (const mesh of [false, true]) {
      bp.layers[0].fadeMesh = mesh ? createFadeMesh() : undefined;
      delete campaign.imageFadeEnabled;
      renderFrame(canvas, bp, campaign, resources);
      const legacy = canvas.toDataURL();
      campaign.imageFadeEnabled = true;
      renderFrame(canvas, bp, campaign, resources);
      const defaultUnchanged = canvas.toDataURL() === legacy;
      campaign.imageFadeEnabled = false;
      renderFrame(canvas, bp, campaign, resources);
      const off = pixels(canvas),
        offUrl = canvas.toDataURL();
      const errors = [];
      for (const format of ['png', 'gif']) {
        const blob = await renderOutput(bp, campaign, resources, format);
        const bitmap = await createImageBitmap(blob),
          output = canvasOf(300, 250);
        output.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
        const data = pixels(output);
        errors.push(
          data.reduce((sum, value, i) => sum + Math.abs(value - off[i]), 0) / data.length,
        );
      }
      const shadowVisible = canvas.getContext('2d').getImageData(226, 100, 1, 1).data[0] > 20;
      campaign.imageFadeEnabled = true;
      renderFrame(canvas, bp, campaign, resources);
      results.push({
        defaultUnchanged,
        changed: offUrl !== legacy,
        restored: canvas.toDataURL() === legacy,
        shadowVisible,
        errors,
      });
    }
    return { invalidRejected, results };
  });
  expect(result.invalidRejected).toBe(true);
  for (const r of result.results) {
    expect(r.defaultUnchanged && r.changed && r.restored && r.shadowVisible).toBe(true);
    expect(r.errors[0]).toBe(0);
    expect(r.errors[1]).toBeLessThan(6);
  }
});
