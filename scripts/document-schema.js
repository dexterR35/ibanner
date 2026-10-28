import { writeFile, mkdir, rm } from 'node:fs/promises';
import { z } from 'zod';
import { blueprintSchema } from '../src/core/schema.js';
import { createBlueprint, PRESETS } from '../src/data/defaults.js';
import { BANNER3_LAYOUTS, createBanner3Blueprint } from '../src/data/banner3.js';
await mkdir('blueprints', { recursive: true });
await writeFile(
  'blueprints/blueprint.schema.json',
  JSON.stringify(z.toJSONSchema(blueprintSchema), null, 2) + '\n',
);
for (const market of ['BANNER1', 'BANNER2']) {
  await mkdir(`blueprints/${market.toLowerCase()}`, { recursive: true });
  for (const [w, h] of PRESETS.slice(0, 8)) {
    const bp = createBlueprint(market, w, h);
    bp.scenes = bp.scenes.map((scene, index) => ({ ...scene, id: `part-${index + 1}` }));
    await writeFile(
      `blueprints/${market.toLowerCase()}/${w}x${h}.v1.json`,
      JSON.stringify(bp, null, 2) + '\n',
    );
  }
}
await rm('blueprints/banner3', { recursive: true, force: true });
await mkdir('blueprints/banner3', { recursive: true });
for (const layout of BANNER3_LAYOUTS) {
  await writeFile(
    `blueprints/banner3/${layout.width}x${layout.height}.v1.json`,
    JSON.stringify(createBanner3Blueprint(layout), null, 2) + '\n',
  );
}
console.log(
  `Documented JSON Schema and ${16 + BANNER3_LAYOUTS.length} current seed snapshots. Runtime validation also enforces timing and identity invariants.`,
);
