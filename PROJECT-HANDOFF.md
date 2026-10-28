# Banner Blueprint Studio — Project Handoff for Codex

**Status:** Product definition / pre-MVP  
**Purpose:** Replace the repetitive Photoshop/artboard banner-production workflow with an automated, blueprint-driven generator that still allows manual correction when needed.

---

## 1. Product vision

The daily production workflow should be:

1. Choose a **market** (banner1, banner2, banner3 or any future market).
2. Upload the campaign/source image **once**.
3. Enter headline, CTA, legal copy and other campaign content **once**.
4. Click **Generate All**.
5. The system generates every configured banner size for that market using that market's blueprints.
6. Show all generated banners together in a review dashboard.
7. If one banner needs correction, open only that banner and edit image crop/position, text, mask, gradient, logo, CTA, etc.
8. Click **Export All** to export the complete campaign set.

The goal is **not to recreate Photoshop as the normal workflow**. The editor is an escape hatch for exceptions. Normal production should be input once → generate all → review → optionally correct → export all.

---

## 2. Core concepts

### Market
A market owns its own set of banner blueprints. Markets may use identical dimensions but different layouts.

Examples:
- banner1
- banner2
- banner3
- Future markets added through configuration

### Blueprint
A reusable master template for one `market + banner size`.

A blueprint describes **instructions**, not final pixels:
- canvas width/height
- layers and z-order
- image placeholder
- image crop / focal point
- masks
- gradients
- opacity / blend rules
- logo
- headline
- CTA
- legal copy
- text boxes
- font constraints
- safe zones
- optional animation frames

The blueprint is stored as versioned JSON and rendered by the application.

### Generated banner
A campaign-specific render created from:
- a blueprint version
- uploaded campaign assets
- campaign copy
- optional per-banner overrides

### Override
A local correction that changes one generated banner without changing the master blueprint.

### Blueprint version
Permanent template changes create a new version, for example:

`RO / 300x250 / v1 → v2`

Previously generated work should remain tied to the blueprint revision used to create it.

---

## 3. Initial banner sizes

Expected set is approximately 10 sizes per market. Examples discussed:

- 300×250
- 728×90
- 970×250
- 160×600
- 300×600
- 320×50
- very small formats such as 150×90

The actual list must be configurable per market rather than hardcoded.

---

## 4. Dashboard / UX

### Generate screen
Inputs:
- Market selector
- Campaign/source image
- Headline
- CTA
- Legal text
- Additional market-specific fields if required
- Generate All button

### Review dashboard artboard
After generation:
- display every banner simultaneously as cards/previews
- identify size and blueprint version
- status: generated / edited / warning / export-ready
- click any banner to edit
- regenerate individual banner
- export individual banner
- Export All

### Banner Editor
For one generated banner:
- move / scale image
- adjust crop and focal point
- move/resize text boxes
- font size and line breaks
- alignment
- logo positioning
- CTA positioning
- mask / gradient / shadow parameters
- frame/timeline editing for animated banners
- Save Override
- Reset to Blueprint

### Blueprint Editor
This is the master-template editor, not the normal campaign workflow.

Navigation concept:

`Blueprints → Market → Size → Version → Edit`

Layer examples:
- Background
- Image
- Image Mask
- Overlay / Shadow
- Logo
- Headline
- CTA
- Legal

Properties panel:
- x/y
- width/height
- rotation
- opacity
- blend mode
- font
- font size constraints
- alignment
- crop/focal settings
- gradient/mask settings
- safe areas
- animation/frame settings

Actions:
- Save Draft
- Save New Version
- Duplicate Blueprint
- Publish Version
- Roll back / select previous version

---

## 5. Rendering model

Conceptual flow:

`Blueprint JSON + campaign content + assets + overrides → renderer → Canvas → final output`

Do **not** store final pixels in blueprint JSON.

The JSON stores the non-destructive instructions/layers. The renderer creates pixels.

Preserve original uploaded media. Preview assets may be optimized, but final export should render from original source assets.

Suggested outputs:
- PNG
- JPEG
- WebP where appropriate
- GIF / animated WebP where required

---

## 6. Masks and image treatment

There are two different concepts and they must not be confused.

### Design masks — V1
No AI required.

Examples:
- linear fade into background
- opacity mask
- gradient mask
- blur
- shadow
- overlay
- clipping region

These are deterministic blueprint properties and can be rendered using Canvas/WebGL/OpenCV.js as appropriate.

### Subject segmentation — V2
AI is useful when the application needs to understand image content, for example:
- keep the person/product but remove background
- isolate subject from a complex scene
- automatically generate a subject mask
- intelligently reposition a subject

AI segmentation should return a mask/artifact which the normal renderer can then use.

---

## 7. OpenCV — required architecture direction

**OpenCV is part of V1**, preferably through OpenCV.js where browser-side processing makes sense.

Potential V1 responsibilities:
- resize / resampling
- crop helpers
- blur
- mask operations
- image compositing helpers
- pixel analysis
- bounds/edge checks
- preprocessing
- quality checks

OpenCV should **not** become the entire editor. The visual editor remains a Canvas/WebGL/layer system.

Concept:

`Editor (Canvas) ↔ OpenCV.js image operations → Renderer`

---

## 8. V1 — MVP scope

V1 should deliberately work without AI.

### Required
- configurable markets
- configurable banner sizes
- versioned JSON blueprints
- Blueprint Editor
- campaign Generate screen
- Generate All
- multi-banner Review Dashboard
- per-banner editor
- per-banner overrides
- text auto-fit , title and subtitle, can chose color or edit color of text or word
- image crop / focal controls
- design masks / gradients / shadows
- logo and legal layers
- OpenCV.js integration
- static rendering
- animated blueprint support for small formats
- Export All
- image-quality warnings
- blueprint version history

### Text auto-fit
Each text layer should define:
- bounding box
- maximum font size
- minimum font size
- maximum lines
- line-height rules
- wrapping rules
- overflow behavior

Algorithm concept:
1. begin at preferred/max font size
2. measure text
3. wrap according to box width
4. reduce font size until constraints fit
5. if minimum size is reached and content still fails, trigger fallback/warning
6. legal copy has independent constraints

Do not silently make legally required copy illegible.

---

## 9. Animated blueprints

Some small formats may not fit all content in one static frame.

Support two blueprint modes:

### Static Blueprint
Everything appears in one frame.

### Animated Blueprint
2–4 or more states/frames, with:
- duration
- transition
- layer visibility
- layer properties per frame
- loop behavior

Example:

- Frame 1: image + logo
- Frame 2: headline
- Frame 3: CTA + legal

The editor should eventually expose a simple timeline/frame strip.

---

## 10. V2 — AI layer (NOT required to ship V1)

V2 adds AI behind a stable API/adapter boundary.

Possible capabilities:
- Select Subject
- Remove Background
- subject segmentation
- smart crop
- subject/face/object detection
- composition analysis
- safe-zone placement suggestions
- automatic focal-point proposal
- reference-banner analysis
- AI-assisted blueprint extraction/proposal

Candidate technologies can include SAM-family segmentation and Grounding-DINO-style detection, but the **product contract must be capability-based**, not tied permanently to model names.

Example conceptual API capabilities:

- `segment_subject`
- `detect_objects`
- `suggest_focal_point`
- `suggest_crop`
- `analyze_reference`
- `propose_blueprint`

The renderer must continue to work if AI is disabled or replaced.

Possible future flow:

`Reference banner/image → AI analysis API → proposed blueprint JSON → human review/edit → publish blueprint`

This is explicitly a **V2 goal**, not an MVP dependency.

---

## 11. Recommended technical direction

Initial web application direction:

- React + TypeScript
- Canvas abstraction such as Konva or Fabric.js (evaluate before committing)
- OpenCV.js for deterministic image processing
- versioned JSON blueprint schema
- original-asset preservation
- preview/proxy assets for fast editing
- final render from original assets
- local-first where practical, without making “local” more important than output quality

If heavier AI is added later, place it behind a backend/model-adapter API rather than importing model runtimes into the editor.

---

## 12. Non-destructive data model

Minimum entities:

### Market
- id
- name
- locale
- active
- configured sizes

### Blueprint
- id
- marketId
- size
- type: static | animated
- activeVersionId

### BlueprintVersion
- id
- blueprintId
- version
- status: draft | published | archived
- schema
- createdAt

### Campaign
- id
- marketId
- copy/content
- sourceAssetRefs
- createdAt

### BannerRender
- id
- campaignId
- blueprintVersionId
- overrideRevisionId
- outputArtifactRefs
- qualityStatus

### OverrideRevision
- immutable edit delta or full normalized layer state
- parent revision
- createdAt

### Artifact
- immutable source/render/mask/preview reference
- hash
- media metadata
- lineage

Original media should remain immutable. Generated previews, masks and exports should have traceable lineage.

---

## 13. Example blueprint JSON

```json
{
  "schemaVersion": 1,
  "market": "RO",
  "size": { "width": 300, "height": 250 },
  "type": "static",
  "layers": [
    {
      "id": "background",
      "type": "background",
      "fill": "#000000"
    },
    {
      "id": "hero",
      "type": "image",
      "source": "$campaign.heroImage",
      "box": { "x": 120, "y": 0, "width": 180, "height": 250 },
      "fit": "cover",
      "focalPoint": { "x": 0.5, "y": 0.5 },
      "mask": {
        "type": "linear-gradient",
        "angle": 180,
        "stops": [
          { "offset": 0, "alpha": 1 },
          { "offset": 1, "alpha": 0 }
        ]
      }
    },
    {
      "id": "headline",
      "type": "text",
      "source": "$campaign.headline",
      "box": { "x": 20, "y": 70, "width": 130, "height": 80 },
      "font": "BrandSans",
      "preferredFontSize": 28,
      "minFontSize": 18,
      "maxLines": 3,
      "overflow": "warn"
    }
  ]
}
```

This is illustrative; define and validate a formal schema before implementation.

---

## 14. Quality strategy

Quality must not depend on the editor preview resolution.

- retain original source image
- create lightweight preview/proxy if necessary
- edit using transforms against source coordinates
- final export rerenders from original asset
- avoid repeated lossy re-encoding
- PNG for lossless use cases
- configurable JPEG/WebP quality
- explicit animated-output optimization
- detect excessive upscaling
- warn about insufficient source resolution
- test text rendering against production fonts
- compare final renders with approved reference banners

Add automated pre-export checks:
- source resolution
- crop coverage
- text overflow
- legal copy legibility
- missing font/logo/assets
- objects outside safe zones
- animation duration/loop constraints
- output dimensions
- output file size where ad platforms impose limits

---

## 15. Suggested repository structure

```text
banner-blueprint-studio/
├── README.md
├── CODEX.md
├── package.json
├── apps/
│   └── web/
├── packages/
│   ├── blueprint-schema/
│   ├── renderer/
│   ├── editor-core/
│   ├── text-fit/
│   ├── image-processing/
│   ├── animation/
│   └── quality/
├── blueprints/
│   ├── banner1/
│   │   ├── references/
│   │   ├── assets/
│   │   └── blueprints/
│   ├── banner2/
│   │   ├── references/
│   │   ├── assets/
│   │   └── blueprints/
│   └── _market-template/
├── assets/
│   ├── fonts/
│   ├── shared-logos/
│   └── sample-images/
├── docs/
│   ├── PROJECT-HANDOFF.md
│   ├── ARCHITECTURE.md
│   ├── BLUEPRINT-SPEC.md
│   ├── DASHBOARD.md
│   ├── V1-MVP.md
│   └── V2-AI.md
└── tests/
    ├── fixtures/
    ├── golden/
    └── visual/
```

Market folders are examples only. Adding a market should be configuration/data work, not a code fork.

---

## 16. What the user needs to provide next

Start with **one pilot market**.

Ideal input:
1. All final reference banners for that market (roughly 10 sizes).
2. PNG/JPG references are sufficient to start.
3. PSD/source files are useful if available, but should not be required for the final production workflow.
4. Logo files and logo variants.
5. Font names/files and font usage rules.
6. Brand colors / fixed graphic elements.
7. One or more original source photos used in reference banners, if available.
8. Animated/GIF examples if the market uses them.
9. Preferably 2–3 content examples with very different copy lengths:
   - short headline
   - long headline
   - long legal copy

From these references, infer and document:
- dimensions
- layer structure
- spacing
- image positioning
- crop/focal rules
- masks/gradients
- typography
- CTA/legal rules
- animation rules
- auto-fit constraints

Do one market well before scaling to the other 5–6 markets.

---

## 17. Build roadmap

### Milestone 0 — Reference ingestion
Exit gate:
- one pilot market has complete reference assets
- exact size list confirmed
- fonts/logos available or gaps documented

### Milestone 1 — Blueprint schema + renderer
Exit gate:
- schema validated
- one static reference recreated from JSON
- golden render comparison established

### Milestone 2 — Blueprint Editor
Exit gate:
- create/edit layers visually
- save/publish versioned blueprint
- duplicate/version rollback works

### Milestone 3 — Campaign generator
Exit gate:
- upload one image + copy
- Generate All creates all pilot-market sizes
- text auto-fit and masks work

### Milestone 4 — Review + override editor
Exit gate:
- all banners visible together
- individual banner can be corrected without changing master
- reset-to-blueprint works

### Milestone 5 — Export + quality
Exit gate:
- Export All
- exact output dimensions
- source-resolution and text-overflow checks
- visual regression fixtures

### Milestone 6 — Animation
Exit gate:
- frame-based blueprint
- preview timeline
- animated export for required small sizes

### V1 release gate
The pilot market can complete a real campaign without Photoshop in the normal workflow.

### V2 — AI assistance
Only after V1 contracts are stable:
- AI service/API boundary
- segmentation / Select Subject
- smart crop / focal suggestion
- composition assistance
- reference analysis
- AI-assisted blueprint proposal

V2 must remain optional: manual/blueprint rendering still works without AI.

---

## 18. Explicit product decisions from the discussion

- Photoshop should be removed from the **daily production path**.
- The application should not require manually rebuilding ~10 banners per campaign.
- Inputs should be entered once and propagated across all banner sizes.
- Each market can have different layouts for the same dimensions.
- Blueprints must be editable.
- Blueprint changes must be versioned.
- Generated banners can have one-off overrides.
- Masks/gradients do not require AI.
- Subject isolation can use AI later.
- OpenCV/OpenCV.js belongs in V1 for deterministic image processing.
- AI belongs in V2 behind an API/adapter boundary.
- Very small formats can use animated/multi-frame blueprints.
- Final quality should use original source assets, not low-resolution previews.
- The user must be able to see all generated banners together before export.

---

## 19. Codex starting instruction

When this repository is opened in Codex, begin with:

> Read `docs/PROJECT-HANDOFF.md`. Build V1 only. Do not add SAM/DINO or other AI dependencies yet. Preserve the V2 adapter boundary in architecture. First implement a validated versioned blueprint schema and deterministic renderer, then a minimal visual blueprint editor, then the campaign Generate All dashboard. Keep original source assets immutable and make generated banner overrides non-destructive. Use OpenCV.js only where it provides useful deterministic image-processing operations; do not make it the UI/editor abstraction.

Before implementing real market templates, ingest the pilot-market reference assets supplied by the user and create golden visual fixtures.

---

## 20. Definition of success

A user can select a market, upload one campaign image, enter campaign text once, title and subtitle, click **Generate All**, inspect all required banner sizes, correct only the exceptions, and export the complete campaign — without manually rebuilding the campaign in Photoshop.
