# Banner Blueprint Studio

Read `docs/README.md`, `docs/SYSTEM.md`, `docs/BLUEPRINT-SPEC.md`, `docs/ASSET-AUDIT.md` and `docs/STATUS.md` before changing the system. Preserve `PROJECT-HANDOFF.md`. The project ships blueprints only: no example banners, brand logos or brand copy. Do not add brand names or bundled example artwork; campaigns start from scratch. Test images are neutral synthetic fixtures in `tests/fixtures/`.

The user's current stack is Vite, React and JavaScript (.js/.jsx), superseding TypeScript in the old handoff. Keep components and rendering modules reusable. Market IDs, dimensions and layouts are configurable data. Do not hardcode a legal string in the renderer or claim the BANNER2 layout is reference-matched without evidence.

Canvas preview and export must share the rendering/timeline pipeline. Saved master revisions are immutable; edits create new revisions. Campaign exceptions belong to local override snapshots. Uploaded original assets remain content-hashed and unchanged. Do not bake final pixels into blueprint JSON.

Run core tests, relevant browser workflow tests, and a production build for renderer/state/export changes. Visually inspect modified layouts. Do not substitute functional checks for visual reference approval. Keep the status document honest about missing brand assets and product capabilities.

OpenCV.js is part of V1 image analysis. AI segmentation remains optional V2 and must not block normal local rendering. No deployment is implied by local implementation work.
