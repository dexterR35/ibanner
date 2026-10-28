# Blueprint contract · schemaVersion 1

The authoritative parser is `src/core/schema.js`. The portable structural schema is [`blueprints/blueprint.schema.json`](../blueprints/blueprint.schema.json). Generated seed snapshots live in `blueprints/banner1/`, `blueprints/banner2/` and `blueprints/banner3/`; refresh these documentation snapshots with `npm run schema:document` when common factories change. `src/data/defaults.js` seeds a new workspace; existing persisted revisions are never migrated by overwriting them. Explicit layout corrections may append a new active revision while leaving generated banners pinned to their earlier revision.

## Identity and canvas

`id` identifies one market/size blueprint (`BANNER1-300x250`). `marketId` binds the market. `width`/`height` are integer native output pixels, 32–2048 inclusive. `background` is a six-digit hex color. `mode` is `static` or `animated`. `repeat` is GIF repetition count (0 = infinite). `schemaVersion` is 1.

Revision identity is outside the blueprint: `{ id, number, status, createdAt, blueprint }`. An entry holds `versions`, `activeVersionId`, an optional working `draft`, and an optional `measured: true` flag for starting layouts measured from a finished design. Revision IDs in generated banners are authoritative, not the entry's latest revision pointer.

## Layer contract

Layers are ordered back to front. Every layer has a unique `id`, name, source binding, x/y, width/height, rotation (degrees around the top-left), opacity (0–1) and visibility. Supported types:

| Type | Rendering behavior |
| --- | --- |
| image | Cover crop from original image, focalX/focalY (0–1), zoom (1–4), linear or point-shaped directional fade |
| logo | Contained original logo; marked text fallback if missing |
| text | Bound campaign/custom text, auto-fit, explicit newlines and word wrapping |
| button | Rounded fill plus fitted CTA text |
| shape / background | Filled rounded rectangle |

Source bindings are `hero`, `logo`, `headline`, `subtitle`, `cta`, `legal`, or `custom`. Custom text uses the layer's `text`. Campaigns can highlight an exact, case-sensitive word or phrase with `accentWord` and `accentColor` in headline/subtitle layers. Spans spanning a wrapped line are not highlighted as a single span in this first implementation.

Text properties: `minFontSize`, `maxLines`, `lineHeight`, `fontWeight`, `align` and `fill`. Text always grows or shrinks to fill its existing box, using a bounded binary search of canvas metrics at half-pixel steps (maximum 500 px). `fontSize` remains in the portable schema as a legacy composition hint; it no longer caps rendered text, and its inspector input is removed. Automatic geometry suggestions retain that hint for their allocation heuristic. Minimum font size and maximum rows are preferred limits, not truncation limits. When those preferences cannot fit all content, rendering uses a bounded 20-step fallback search, permits extra rows and smaller type, and breaks overlong words at grapheme boundaries. Explicit manual line breaks remain intact. The box geometry stays unchanged and reduced-below-minimum text gets a readability review note. Composition scoring retains its preferred-size constraints. Legal copy gets an additional 9 px review threshold, which is a draft design check, not a claim about regulatory minimums.

Optional `campaign.typography` is `original` (also the missing-field behavior) or `outfit`. Original uses the saved layer's normal/bold weight and uploaded font/Arial. Outfit overrides the effective text weights by role: headline and CTA/button 800, subtitle/custom text 600, legal 400. These runtime rules do not alter blueprint revisions or their original weights, and the logo image is unaffected. Typography participates in resource loading and the campaign layout key, persists in backups, and is applied consistently during measurement and rendering. Turning off Auto arrange retains geometry while the new font fits its existing boxes.

## Text flow and available space

Each layer stores its own `textFlow`:

| Value | Behavior |
| --- | --- |
| `auto` | Joins campaign line breaks, wraps for this format, and balances the fitted rows without reordering words |
| `single-line` | Prefers one horizontal line; falls back to wrapping and smaller type when necessary to keep all content |
| `manual` | Keeps explicit line breaks and wraps long rows as needed |

`verticalAlign` is `top`, `middle` or `bottom`; horizontal alignment still uses `align`. `lineHeight` controls row spacing and defaults to 1; `verticalAlign` defaults to `middle`. A one-time workspace migration sets current standards, working drafts, banner overrides and arrangements to line spacing 1 in every market. It appends standard/history revisions and preserves older archived snapshots. `project.lineSpacingVersion: 1` records completion; later deliberate manual spacing edits are not repeatedly reset. `textOverride` is optional local copy (`null` means use the source binding). The **Text / rows for this format** field is available in every flow mode and edits this local copy; **Use campaign copy** removes it. Campaign text and other formats stay unchanged. Blueprint revisions support these fields in project data. The structural blueprint editor exposes layout controls and creates Headline, Subtitle or Legal boxes with their binding already assigned; actual campaign words and per-format copy are edited in Studio.

Automatic fill always works **inside the existing box** for text and CTA labels. No Fill available space button is required, and editing local copy does not expand/move the box or change adjacent layers. Font measurement, PNG/GIF output and previews share the same fitter. Text layout has no enclosing border/background; Layer name and Content binding fields are removed from the inspector. Blueprint text roles are chosen when adding a layer.

Missing fields normalize to `manual`, `middle` and `null`, preserving older saved layouts. Fresh 320×50, 728×90 and 300×100 seeds use automatic rows and space-aware text boxes. Existing saved versions are not rewritten. Edit local copy in **Edit banner** and choose **Save banner** to update one existing banner. The blueprint reference stays unchanged.

## Automatic campaign arrangement

The canvas **Auto: On/Off** toggle (`campaign.autoArrange`) defaults to on. Editing headline, subtitle, CTA or legal copy, or replacing the image/logo/font, schedules a deterministic layout pass after a short typing pause and after the new resources load. **Arrange now** is a separate one-time AI arrangement (below); it does not change the Auto setting. Local editor text changes use automatic fitting inside the existing box regardless of that switch. They retain all geometry, manual flow/alignment choices and the photo frame. Campaign-level arrangement remains a separate composition control; Keep blueprint boxes preserves geometry there too.

The arrangement pass measures actual text with the selected font, shares available space among co-visible text layers, and lets separate GIF parts reuse their text region. It evaluates bounded photo-frame adjustments (70–115% of the saved frame along its fade axis), balancing text readability and image aspect ratio while retaining the layout's image direction and fade. Crop focus and zoom remain unchanged unless a subject focus is active. Logo, legal and CTA geometry and all timeline tracks remain unchanged. Rotated or moving text is excluded. A separately detected or manually selected subject focus adds crop-obstruction scoring; without a focus this uses geometry and font metrics. Copy that requires rendering below its preferred minimum produces a readability review note.

`campaign.autoArrange` stores the switch. Optional `campaign.keepBlueprintBoxes` stores fixed-box fitting (legacy default false). Match blueprints enables it and updates banner layout geometry/alignment to the latest active revision while preserving local copy and styling. In fixed-box mode the arrangement pass only optimizes subject crop; the shared renderer fits copy within the saved boxes. Blueprint diagrams use each text layer’s actual horizontal alignment rather than centering every label. `banner.arrangement` is the latest derived blueprint snapshot, with `banner.layoutKey` recording the text and asset bindings used. The normal banner resolver supplies that exact snapshot to previews, editor, quality review and exports. Automatic passes replace this snapshot rather than adding a history revision for every keystroke. They always start from the pinned revision or saved override, preventing repeated arrangement drift. Master revisions and manual override history remain immutable.

Saving an editor override clears the derived snapshot and records the current content key, retaining manual adjustments until another campaign content change. Turning automation off freezes the current layout; ordinary font fitting continues within its boxes. Existing workspaces keep their saved composition until the next content change or manual arrangement. Backups preserve and validate the snapshots/settings; the campaign ZIP manifest records whether each output uses an arranged layout.

### AI arrangement data (schemaVersion 1, additive)

- `banner.aiLayout` `{ source, createdAt, versionId, blueprint }`: the geometry Arrange now chose. `source` is `design`, `reference`, `qwen` or `qwen+reference-photo`. It applies only while `versionId` equals the banner's pinned `blueprintVersionId` and the banner has no manual override; Match blueprints clears it and fixed-box mode ignores it. Automatic passes start from it instead of the saved design. It is a derived snapshot: master revisions are never changed.
- `campaign.photoAnalysis` `{ key, engine: "OpenCV.js", width, height, cols, rows, luminance[], detail[], engines[], subject?, text?, objects? }`: per-cell 0-100 brightness and detail of the rendered photo, plus the optional BiRefNet subject grid/box, PaddleOCR lines printed in the photo and Florence-2 objects (normalized boxes, untrusted labels). `key` identifies the photo binding (asset, reference pack, upscale/extension/cut-out); a different key means the analysis is stale and unused. No pixels are stored.
- `campaign.copyFits[size][role]` (existing, from Create) now also applies in Studio arrangement: approved shorter headline/subtitle/CTA copy becomes that size's local text in the derived snapshot unless the layer already has its own local text. Legal copy is never shortened.

New sizes and new markets start from the nearest measured blueprint shape (the market's own first, otherwise every market's, labelled unverified), scaled to the size and rounded to whole pixels.

## Image positioning

Image `fade` is the fraction of its box from the chosen edge to fully visible artwork. The renderer composites a gradient using the blueprint background. It is an opaque-background fade, not arbitrary alpha masking or segmentation. The image stays original; transforms and crop coordinates are instructions. Runtime resource `heroCrop` records the source region of the demo reference crop; uploaded original imagery has no implicit crop.

### Editable fade curve

Optional image `fadeMesh` replaces the linear fade when enabled:

```json
{
  "enabled": true,
  "softness": 0.25,
  "points": [{"x": 0, "y": 0.2}, {"x": 0.5, "y": 0.6}, {"x": 1, "y": 0.2}]
}
```

The UI creates **16 points** by default, with 2–16 supported, and Straight, U shape and Arch presets. Points describe one open boundary across the image frame. Normalized `x` runs along the edge; `y` is depth into the image from `fadeDirection` (top, bottom, left or right). The first/last x coordinates are fixed at 0/1; internal points can move on both axes but stay ordered with at least 0.005 separation. Values stay within 0–1. This supports shaped edge fades, not closed masks, holes or a multicolor gradient mesh.

Bounded smooth interpolation joins the points. `softness` is 0.01–1 of the frame depth and defines the full transition width centered on the curve. Pixels before the transition use the blueprint background; pixels beyond it show the photo. Dashed editor lines show transition limits. Moving the photo changes only crop coordinates; resizing/rotating the frame carries its normalized curve with it. Point dragging previews continuously and commits one undo step. Disabling the mesh retains the points and restores the previous linear fade.

`core/fade-mesh.js` supplies shared geometry and rendering for Studio, the focused editor and static/GIF exports. A bounded four-surface cache uses masks up to 1024 px on the longest side; larger frames smoothly scale the fade surface. Photo/export resolution remains unchanged. Text-space and subject-placement suggestions conservatively use the curve's least/greatest depth, respectively, rather than assuming the old straight edge. Subject placement does not reshape the mesh.

The Blueprint detail page exposes a quick **fade-only** editor on the structural diagram, alongside the full **Edit blueprint** route. Both append immutable draft revisions and immediately apply changed properties to the matching Studio banner through `core/blueprint-edit.js`. Fade-only saves accept only `fade`, `fadeDirection` and `fadeMesh`; campaign text, asset bindings and crop remain intact. Reset is not required. Previously saved mesh standards synchronize once per active market, recording `banner.syncedBlueprintVersionId`; local fade edits after that remain local. Optional `fadeMesh` stays backward-compatible with schemaVersion 1, and backups store points rather than pixels.

Full blueprint saves retain market, ID and dimensions; Add size creates another entry and opens its editor. Standard changes merge by layer ID and property: changed fields apply, untouched local fields remain, new/deleted standard layers and order propagate, and edited scene data replaces previous scene data. Orphan tracks are pruned and font bounds remain valid. The previous effective banner and updated snapshot are retained in history. Revision `origin: "blueprint-editor"` exempts deliberate geometry from old seed-centering corrections. Old revisions are never overwritten.

The blueprint JSON stores image instructions and bindings; it does not contain the uploaded photo bytes. **Reposition image** changes only `focalX`/`focalY`. Dragging is converted to the frame's local axes, including rotation, and clamped to preserve cover coverage. `x`, `y`, width, height, rotation and fade remain fixed. Zoom in when an axis has no spare image pixels. **Edit frame** explicitly enables moving, resizing and rotating the frame and fade together. A drag is one undo step; a saved campaign override changes only that banner. Reset image position restores centered focus and 1× zoom without touching the fade.

Layer position and rotation are edited on the canvas: drag the selected layer, use corner/edge resize anchors and the round rotation handle. Rotation snaps near multiples of 45 degrees. X/Y/rotation values remain part of JSON and exports, with no numeric inspector fields. Width/height and opacity are still editable in the inspector. Arrow keys move the selection by one native pixel, or ten with Shift. Selection controls live outside the native artwork bounds and do not appear in exports.

Studio uses this same editor inline for the selected artboard. Valid changes automatically append a local banner override; the separate focused editor still saves explicitly. Inline text overrides, geometry and image treatment apply only to that banner. Moving a whole artboard by its title changes temporary workspace placement, not layer coordinates, blueprint JSON or export dimensions. No new blueprint fields are required for the Studio view.

Bottom legal boxes reserve a separate background footer. A stationary photo that crosses a visible bottom legal box is shortened to leave 4 native pixels above it (2 for heights up to 100 px). The box and legal copy are not moved or rewritten. This shared constraint is applied to new seeds, legacy snapshot resolution, diagrams, arrangement and rendering. Draft master corrections append a new revision; prior versions and override history remain intact. Rotated/moving frames and legal-only GIF parts are excluded.

## Text glow

Text and button-label layers support an optional `glow` object:

```json
{
  "enabled": true,
  "color": "#ff162d",
  "blur": 8,
  "opacity": 0.85
}
```

The editor exposes **Text glow**, color, radius (0–40 native pixels) and strength (0–1). Red is the starting color. Glyphs remain clipped to their text box; the glow can extend beyond it, and the canvas clips the final artwork. The renderer composites the effect at native dimensions before applying layer transforms/opacity, so canvas preview, static export and GIF use the same effect. Disabling glow restores the normal text rendering path.

This is a backward-compatible addition to schemaVersion 1. Missing glow fields normalize to disabled, red, 8 px and 0.85 strength. Existing revisions are not restyled automatically. Duplicating a blueprint to a different size scales the glow radius with typography, within the 40 px limit.

## Scene and track contract

```json
{
  "id": "offer",
  "name": "The offer",
  "durationMs": 2000,
  "transitionMs": 0,
  "tracks": {
    "logo": { "visible": true, "startMs": 0 },
    "headline": { "visible": false },
    "subtitle": { "visible": true, "startMs": 100, "endMs": 1900, "fadeInMs": 200, "fadeOutMs": 200, "dx": 0, "dy": 0 }
  }
}
```

1–12 stored parts. Static mode renders the first frame and hides timeline controls; retained parts can be restored by checking Create GIF. Each duration is 100–15000 ms. Total timeline is at most 60 seconds. Tracks refer only to existing layer IDs. An absent track means the layer is visible for the entire scene unless its base visibility is off. `endMs` defaults to scene duration. Intervals are start-inclusive and end-exclusive. Fade-in plus fade-out must fit inside the interval. Movement is linear relative to base coordinates (`dx`/`dy` exposed through JSON in v0.1).

`transitionMs` crossfades from the previous scene during the current scene's first milliseconds, without adding time. The first scene ignores crossfade; the loop boundary is a cut. Preview playback cycles for editing even when a finite export repeat is set. GIF output honors repeat count.

Export samples cuts only at scene/track boundaries; dynamic fades/movement are additionally sampled at 10 fps. GIF centisecond delays round at encoding. Prefer durations divisible by 10; all starter timings already are. Export rejects more than 120 million sampled pixels to bound browser work. Large/high-frame animations should be moved to a worker or export service in a later increment.

## Validation beyond JSON Schema

The Zod runtime parser additionally checks ID uniqueness, known track targets, interval ordering, transition length, minimum/preferred font consistency, total duration. These cross-field checks cannot all be represented by the generated JSON Schema. Never bypass `validateBlueprint` for imported or saved data.

## Extending the system

New layer types require parser, renderer, editor and quality-check support. Bump schemaVersion for incompatible contracts and provide an explicit migration. New sizes and markets need no renderer changes. Adding masks or blend modes must be implemented in the shared renderer before the UI can offer them; unsupported properties must not silently claim to work.

## Campaign subject metadata

Optional `autoSubject` defaults to enabled; `subjectQuery` defaults to `person`. `subjectSearch` stores `{assetId, query, results}` with up to 12 detections. Each detection is `{id, label, score, source, box: {x,y,width,height}}` in normalized original-image coordinates; score is a model matching score, not a calibrated probability. `subjectFocus` adds the bound `assetId` to a selected detection or manual box. The import validator rejects invalid coordinates and mismatched asset IDs. Replacing an image clears its old focus/results. No model weights or photo pixels are embedded in blueprint JSON.

Focus affects the campaign layout key and derived arrangements, never immutable master revisions. The crop optimizer adjusts only `focalX`, `focalY` and `zoom`, preserving frame geometry and fade. It considers co-visible layers painted above the image, including GIF motion/crossfade bounds; rotated/moving photos need manual positioning. Limited source coverage may make a completely clear crop impossible; the shared quality report marks that for review.

The active `campaign.subjectEngine` is `florence`. Legacy `auto`/`browser`/`sam3` preferences normalize to `florence` on load/import. Historical `subjectSearch.engine` and `preference` values remain valid evidence and are not relabelled; new searches record `florence`. Florence phrase-grounded boxes have no confidence score; no probability is invented. Browser inference is removed. Missing local setup or failed inference preserves existing focus/crops and allows manual selection. SAM 3 is available only through an explicit precision API request, not normal campaign automation.

### BANNER1 tall headline

BANNER1 300×600 and 160×600 seed standards separate the white title and pale-blue supporting headline (`#c5e6ff`). Both bind to campaign `headline`: `sourcePart: first-line` uses the first explicit line; `remaining-lines` uses every subsequent line. The default `all` preserves existing bindings. Each block fits its own box without truncation; local text overrides replace only the selected block. Campaign headlines without a line break leave the supporting block empty. Other BANNER1 sizes and BANNER2 retain their existing treatment.

## Banner 3 snapshots and button text

Banner 3 has 11 size snapshots under `blueprints/banner3/` (nine animated, two static). Legacy duplicate entries from older workspaces and their complete banner snapshots stay in the validated `project.consolidatedReferences` archive, excluded from active editing and export. Blueprints carry no image references or bundled resource presets; images and logos come only from campaign uploads. Older `reference`, `references`, `resourcePreset` and `referencePack` fields are removed by the load-time legacy migration.

Button layers support `textFill` (six-digit hex, default white), `textPaddingX` (default 6 px) and `textPaddingY` (default 2 px). Padding is 0–500 native pixels, bounded at render time to retain a positive text box. The same inner box is used by rendering and quality checks; duplicate-size scaling scales the two axes separately. These additive defaults preserve existing buttons. The inspector exposes label color and padding. Text still fits inside the resulting box, without truncation.

Footer image clearance applies only when image and legal boxes overlap horizontally. A leaderboard image beside its legal region retains its full height.

## Image shadow

The optional campaign field `imageFadeEnabled` is a boolean, defaulting to enabled when absent. It gates all image-layer linear and mesh fades for that market in the shared renderer. It does not change stored fade parameters, blueprint revisions, local overrides, crop geometry, image shadows or layout keys. Backups retain this per-market setting.

Optional image-layer `shadow` stores `{enabled, color, opacity, blur, offsetX, offsetY}`. Defaults are false, #000000, 0.5, 8, 0, 4; bounds are 0–1 opacity, 0–40 native-pixel blur, and -100–100 offsets. Missing shadow preserves previous pixels. The shared Canvas renderer casts the shadow from source alpha before applying the existing fade; there is no segmentation or separate source asset. Inspector changes, blueprint saves, overrides, backups, static and GIF exports preserve the same parameters. Duplication scales offsets per axis and blur with typography, bounded by the contract.

## Optional strict generation extension · version 1

The strict generation engine (authored variants, fixed composer rules and the blocking validator) was removed on 28 October 2026. `fitPolicy: "strict-v1"` text/button layers remain valid so banners accepted from it keep rendering and exporting identically: `fontSize` is then the upper bound, `minFontSize` and `maxLines` are hard limits, and an overflow stops that banner's export. New Create drafts are ordinary layers that fit text inside their boxes. `locks`, `cutout` layers and `imageFit: "contain"` keep their meaning.

### Create workflow data

Create flows store nodes `image`, `copy`, `analysis`, `planner` (Qwen layout: `enabled`, `modelVariant` `qwen3-vl-8b`, `modelPrecision` `auto`/`nf4`/`bf16`) and `output` (`marketId`, `width`, `height`), with `layoutVersion: 3`. Older flows with a `compose` node are migrated on load (its format edges move to the Qwen node, its policy is dropped). A generation batch (`schemaVersion: 2`, engine `qwen-layout-1`) freezes `snapshot.bases` and `snapshot.references` per target; items are `succeeded` (with `scene`, `source`, `score`, `copyIssues`), `failed` or `cancelled`. No final image pixels are embedded in JSON.

