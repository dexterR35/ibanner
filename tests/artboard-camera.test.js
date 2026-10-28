import test from 'node:test';
import assert from 'node:assert/strict';
import { constrainCamera } from '../src/core/artboard-camera.js';

test('camera cannot drift into empty space at either end of large or small collections', () => {
  for (const zoom of [0.1, 0.6, 1, 3]) {
    const layout = { width: 1300, height: 1900 },
      viewport = { width: 900, height: 700 };
    const start = constrainCamera({ x: 1e9, y: 1e9, zoom }, layout, viewport, 80);
    const end = constrainCamera({ x: -1e9, y: -1e9, zoom }, layout, viewport, 80);
    assert.equal(start.x, Math.max(32, viewport.width - layout.width * zoom - 32));
    assert.equal(start.y, Math.max(80, viewport.height - layout.height * zoom - 32));
    assert.equal(end.x, Math.min(32, viewport.width - layout.width * zoom - 32));
    assert.equal(end.y, Math.min(80, viewport.height - layout.height * zoom - 32));
    for (const c of [start, end]) {
      assert.ok(c.x < viewport.width && c.x + layout.width * zoom > 0);
      assert.ok(c.y < viewport.height && c.y + layout.height * zoom > 0);
      assert.deepEqual(constrainCamera(c, layout, viewport, 80), c);
    }
  }
});
