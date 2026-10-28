import { test, expect } from '@playwright/test';

test('BANNER1 tall headline renders as separate white and blue blocks at native size', async ({
  page,
}) => {
  await page.goto('/campaign?market=BANNER1');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const { createBlueprint, campaignFor, DEFAULT_MARKETS } = await import('/src/data/defaults.js');
    const { renderFrame, boundText } = await import('/src/core/render.js');
    const results = [];
    const wrapper = document.createElement('div');
    wrapper.id = 'reference-check';
    wrapper.style =
      'position:fixed;inset:0;z-index:99999;background:#222;display:flex;gap:24px;padding:20px';
    document.body.append(wrapper);
    for (const width of [300, 160]) {
      const bp = createBlueprint('BANNER1', width, 600);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = 600;
      canvas.style = `width:${width}px;height:600px`;
      wrapper.append(canvas);
      const campaign = campaignFor(DEFAULT_MARKETS.find((m) => m.id === 'BANNER1'));
      renderFrame(canvas, bp, campaign, {});
      const support = bp.layers.find((l) => l.id === 'headline-support');
      const pixels = canvas
        .getContext('2d')
        .getImageData(support.x, support.y, support.width, support.height).data;
      let bluePixels = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] === 197 && pixels[i + 1] === 230 && pixels[i + 2] === 255) bluePixels++;
      results.push({ text: boundText(support, campaign), bluePixels });
    }
    return results;
  });
  for (const item of result) {
    expect(item.text).toBe('GOES HERE');
    expect(item.bluePixels).toBeGreaterThan(100);
  }
});
