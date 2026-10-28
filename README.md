# Bannerflow · Blueprint Studio

A local Vite + React + JavaScript foundation for multi-market banner production: choose a market, enter content once, automatically update all configured sizes, refine exceptions, and export a set.

```sh
npm ci
npm run dev
```

Open **http://localhost:5178**. Requires Node 22.12+. Use `npm run build` for the production bundle, `npm test` for core tests and `npm run test:e2e` for workflow checks.

Optional local AI (Qwen3-VL 8B planner, Florence-2 subject boxes/analysis, BiRefNet cut-outs), on any machine with or without an NVIDIA GPU:

```sh
npm run ai:setup
npm run florence:download
npm run qwen:download     # Qwen3-VL 8B Instruct
npm run ai:doctor
```

`ai:setup` picks the PyTorch build that matches the GPU and driver (or CPU) and verifies it. See [local AI service setup](services/README.md).

## Start here

- [Documentation index](docs/README.md)
- [System architecture](docs/SYSTEM.md)
- [Blueprint and timeline contract](docs/BLUEPRINT-SPEC.md)
- [Assets and fixtures](docs/ASSET-AUDIT.md)
- [Development guide](docs/DEVELOPMENT.md)
- [Reusable JSX components and source structure](docs/UI-COMPONENTS.md)
- [Implementation status](docs/STATUS.md)
- [Original project handoff](PROJECT-HANDOFF.md)

## Working foundation

- Three starter markets: BANNER1 and BANNER2 (eight sizes each) and Banner 3 (11 sizes); add markets and arbitrary dimensions.
- Shared composition standard with independent market blueprints.
- Layer editor, text auto-fit, word accent color and optional text glow.
- Automatic text/photo arrangement when copy or assets change, with per-market Match blueprints and Arrange now controls beside Auto place subject on the canvas; Match blueprints toggles the saved layout constraint with an active highlight, while Arrange now toggles automatic arrangement and applies it immediately when enabled.
- Drag each banner's photo inside a fixed frame/fade; adjust image zoom or switch to Edit frame for layout changes.
- Structural blueprint editor for new and existing sizes: move/resize/rotate boxes, edit fades and GIF parts, then save to update the matching Studio banner.
- Immutable blueprint revisions and independent per-banner override snapshots; local text, crops and unrelated edits survive standard updates.
- Timeline parts with individual durations, layer visibility, in/out and fade timing; add more parts.
- Local Florence-2 person/object search, automatic per-size subject crop and manual focus selection; BiRefNet produces transparent subject derivatives.
- SAM 3 is reserved for explicitly requested precision through the local API. Normal search, Create and cut-outs do not probe or load it. Missing Florence setup produces a visible error; manual focus, rendering and export remain available. See [local model setup](services/README.md). Browser AI and its model downloads are removed.
- PNG/JPEG/WebP, GIF and ZIP campaign export with an output manifest; timeline controls appear only with Create GIF enabled.
- Original uploads, local IndexedDB persistence, ZIP workspace backup/import.
- Locally bundled OpenCV.js image analysis, loaded on demand.

**Starting point:** the app ships blueprints only, with no example banners and no brand logo, photo or legal copy. Every campaign starts from scratch with placeholder copy, an empty legal line, a neutral "LOGO" placeholder and no image until you upload your own. Arial is the fallback font. Supply original imagery, a logo, production fonts and reviewed market legal copy before approving output. The blueprints are starting layouts, not an approved production template library.

Blueprints are **JSON layout instructions**, not image files. Original photo/logo/font files stay separate. The renderer combines a blueprint with campaign content and optional per-banner overrides to generate the final PNG, JPEG, WebP or GIF.
