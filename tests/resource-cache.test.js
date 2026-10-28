import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCache } from '../src/core/resource-cache.js';

test('decoded images share pending loads, evict by bytes/LRU and retry failed decodes', async () => {
  const cache = new ResourceCache({ maxEntries: 2, maxBytes: 800 });
  let loads = 0;
  const load = () => {
    loads++;
    return { width: 10, height: 10 };
  };
  const first = cache.get('a', load);
  assert.equal(first, cache.get('a', load));
  const live = await first;
  await cache.get('b', load);
  await cache.get('a', load); // b becomes least recently used.
  await cache.get('c', load);
  assert.deepEqual([...cache.entries.keys()], ['a', 'c']);
  await cache.get('b', load);
  assert.equal(loads, 4);
  // Eviction removes cache ownership, not resources still used by preview/export.
  assert.equal(live.width, 10);
  await cache.get('huge', () => ({ width: 100, height: 100 }));
  assert.equal(cache.entries.size, 0);
  await assert.rejects(
    cache.get('bad', () => {
      throw new Error('decode');
    }),
  );
  assert.equal((await cache.get('bad', load)).height, 10);
});
