export async function readBlueprint(page) {
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const blueprint = JSON.parse(await page.locator('.json-editor').inputValue());
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return blueprint;
}

// Native-pixel keyboard movement replaces the removed coordinate inspector fields.
export async function moveSelectedToX(page, id, x) {
  const current = (await readBlueprint(page)).layers.find((layer) => layer.id === id).x;
  const delta = x - current;
  const direction = delta < 0 ? 'ArrowLeft' : 'ArrowRight';
  const canvas = page.getByRole('region', { name: 'Banner editing canvas', exact: true });
  await canvas.focus();
  for (let i = 0; i < Math.floor(Math.abs(delta) / 10); i++)
    await canvas.press(`Shift+${direction}`);
  for (let i = 0; i < Math.abs(delta) % 10; i++) await canvas.press(direction);
}
