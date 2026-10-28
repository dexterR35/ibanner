import { test, expect } from '@playwright/test';

async function blueprint(page) {
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const value = JSON.parse(await page.locator('.json-editor').inputValue());
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return value;
}

async function measuredHeadline(page, bp) {
  return page.evaluate(async (bp) => {
    const { loadProject, loadResources } = await import('/src/core/storage.js');
    const { fitText } = await import('/src/core/text-fit.js');
    const { boundText } = await import('/src/core/render.js');
    const campaign = (await loadProject()).campaigns[bp.marketId];
    const layer = bp.layers.find((layer) => layer.id === 'headline');
    return fitText(
      document.createElement('canvas').getContext('2d'),
      boundText(layer, campaign),
      layer,
      await loadResources(campaign),
    );
  }, bp);
}

test('text fills its existing box automatically and simple controls preserve geometry, undo and persistence', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const sharedCopy = await page.getByLabel('Headline', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Edit banner 320x50', exact: true }).click();
  const old = await blueprint(page);
  Object.assign(
    old.layers.find((l) => l.id === 'headline'),
    {
      x: 74,
      y: 4,
      width: 170,
      height: 23,
      fontSize: 12.5,
      textFlow: 'manual',
      lineHeight: 1,
    },
  );
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  await page.locator('.json-editor').fill(JSON.stringify(old));
  await page.getByRole('button', { name: 'Validate and apply' }).click();
  for (const name of ['Layer name', 'Content binding', 'Preferred size'])
    await expect(page.getByLabel(name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fill available space' })).toHaveCount(0);
  await expect(page.getByLabel('Line spacing', { exact: true })).toHaveValue('1');
  await expect(page.getByLabel('Vertical alignment', { exact: true })).toHaveValue('middle');
  expect(
    await page.locator('.text-layout-controls').evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.borderTopWidth, style.borderLeftWidth];
    }),
  ).toEqual(['rgba(0, 0, 0, 0)', '0px', '0px']);
  await page.getByLabel('Text / rows for this format', { exact: true }).fill('TEAM');
  const short = await blueprint(page),
    shortFit = await measuredHeadline(page, short);
  expect(shortFit.size).toBeGreaterThan(12.5);
  expect(shortFit.overflow).toBe(false);
  const longCopy =
    'MATCH DAY YOUR WAY WITH MORE GAMES MORE CHANCES AND MORE MOMENTS TO ENJOY EVERY WEEKEND '
      .repeat(3)
      .trim();
  await page.getByLabel('Text / rows for this format', { exact: true }).fill(longCopy);
  const arranged = await blueprint(page),
    afterFit = await measuredHeadline(page, arranged);
  expect(afterFit.size).toBeLessThan(shortFit.size);
  expect(afterFit.overflow).toBe(false);
  expect(afterFit.belowMinimum).toBe(true);
  expect(afterFit.lines.join(' ')).toBe(longCopy);
  expect(arranged.layers.filter((l) => l.id !== 'headline')).toEqual(
    old.layers.filter((l) => l.id !== 'headline'),
  );
  const actual = arranged.layers.find((l) => l.id === 'headline');
  expect({ ...actual, textOverride: null }).toEqual(old.layers.find((l) => l.id === 'headline'));
  expect(arranged.scenes).toEqual(old.scenes);
  await page.screenshot({ path: testInfo.outputPath('text-layout-editor.png') });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect(await blueprint(page)).toEqual(short);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Save banner' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue(sharedCopy);
  await page.getByRole('button', { name: 'Edit banner 320x50', exact: true }).click();
  expect(await blueprint(page)).toEqual(arranged);
});

test('single-line, manual rows and vertical alignment are local and match PNG and GIF rendering', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const sharedCopy = await page.getByLabel('Headline', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Edit banner 728x90', exact: true }).click();
  await page.getByLabel('Text flow', { exact: true }).selectOption('single-line');
  const single = await measuredHeadline(page, await blueprint(page));
  expect(single.lines).toHaveLength(1);
  expect(single.overflow).toBe(false);
  await page.getByLabel('Vertical alignment', { exact: true }).selectOption('bottom');
  await page.getByLabel('Text flow', { exact: true }).selectOption('manual');
  await page.getByLabel('Text / rows for this format').fill('MATCH DAY\nYOUR WAY');
  const bp = await blueprint(page);
  expect((await measuredHeadline(page, bp)).lines).toHaveLength(2);
  await page
    .locator('.konvajs-content')
    .screenshot({ path: testInfo.outputPath('728-manual-rows.png') });
  const result = await page.evaluate(async (bp) => {
    const { campaignFor, DEFAULT_MARKETS } = await import('/src/data/defaults.js');
    const { canvasOf, renderFrame } = await import('/src/core/render.js');
    const { renderOutput } = await import('/src/core/export.js');
    const { loadResources } = await import('/src/core/storage.js');
    const campaign = campaignFor(DEFAULT_MARKETS[0]),
      resources = await loadResources(campaign);
    const canvas = canvasOf(bp.width, bp.height);
    renderFrame(canvas, bp, campaign, resources, 0);
    const pixels = canvas.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
    const errors = {};
    for (const type of ['png', 'gif']) {
      const blob = await renderOutput(bp, campaign, resources, type),
        url = URL.createObjectURL(blob),
        image = new Image();
      image.src = url;
      await image.decode();
      const output = canvasOf(bp.width, bp.height);
      output.getContext('2d').drawImage(image, 0, 0);
      URL.revokeObjectURL(url);
      const actual = output.getContext('2d').getImageData(0, 0, bp.width, bp.height).data;
      let error = 0;
      for (let i = 0; i < pixels.length; i++) error += Math.abs(pixels[i] - actual[i]);
      errors[type] = error / pixels.length;
    }
    return errors;
  }, bp);
  expect(result.png).toBe(0);
  expect(result.gif).toBeLessThan(5);
  await page.getByRole('button', { name: 'Save banner' }).click();
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Headline', { exact: true })).toHaveValue(sharedCopy);
  await page.getByRole('button', { name: 'Edit banner 300x250', exact: true }).click();
  await expect(page.getByLabel('Text / rows for this format')).toHaveValue(sharedCopy);
  await page.getByRole('button', { name: 'Back to formats' }).click();
  await page.getByRole('button', { name: 'Edit banner 728x90', exact: true }).click();
  await expect(page.getByLabel('Text / rows for this format')).toHaveValue('MATCH DAY\nYOUR WAY');
  await expect(page.getByLabel('Vertical alignment', { exact: true })).toHaveValue('bottom');
  await page.getByRole('button', { name: 'Use campaign copy' }).click();
  await expect(page.getByLabel('Text / rows for this format')).toHaveValue(sharedCopy);
});
