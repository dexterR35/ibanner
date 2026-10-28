# Banner Blueprint Studio documentation

Start with [SYSTEM.md](SYSTEM.md), then [BLUEPRINT-SPEC.md](BLUEPRINT-SPEC.md). [ASSET-AUDIT.md](ASSET-AUDIT.md) records what is actually supplied; [DEVELOPMENT.md](DEVELOPMENT.md) describes the implementation and checks. [UI-COMPONENTS.md](UI-COMPONENTS.md) covers the JSX source structure, shared controls, pages, routing and Outlet, with usage examples. [STATUS.md](STATUS.md) distinguishes the working foundation from remaining production work.

The original [project handoff](../PROJECT-HANDOFF.md) is preserved. The user's latest direction takes precedence: Vite, React and **JavaScript**, reusable components, configurable markets and dimensions, a shared standard with market-specific layouts, editable fades, and timing for each GIF part. The app ships three starter markets (BANNER1, BANNER2 and Banner 3) as blueprints only: no example banners, brand logos or brand copy. Banners are built from scratch on those layouts.

## System vocabulary

| Concept | Responsibility |
| --- | --- |
| Size preset | Width and height; shared across markets |
| Common blueprint | Draft composition rules that seed new market/size combinations |
| Market | Locale, legal copy, logo/font asset bindings and configured sizes |
| Blueprint revision | Immutable layout and timeline snapshot for one market and size |
| Campaign | One set of copy and original asset bindings for a market |
| Generated banner | Pins a blueprint revision; may carry local override revisions |
| Scene | One animation part with its own duration and per-layer tracks |
| Measured blueprint | A starting layout measured from a finished design (BANNER1 and Banner 3 starter sizes); used as an Arrange example |

## Updating the standard

1. Starter layouts live in code: `createBlueprint` in `src/data/defaults.js` (BANNER1/BANNER2 and new markets) and the Banner 3 layout table in `src/data/banner3.js` (native boxes, GIF part sequence and durations per size). Run `npm run schema:document` to refresh the JSON snapshots under `blueprints/`.
2. To start a layout from a finished banner you own, use **New size → finished banner** in Blueprints: PaddleOCR/Florence suggest roles and boxes; the image itself is not stored as an example.
3. Measured starting sizes are flagged `measured` on their blueprint entry; Arrange uses them as in-context examples.
4. View each market’s layout boxes in Blueprints. Add/duplicate a size to open its blueprint editor. Arrange reusable boxes, fades and timing, then save; Studio uses the layout with the market’s logo, font and hero assets.
5. Review text fit, legal treatment, all scenes, output dimensions and file weight at native size.
6. Choose **Save blueprint** to append a standard revision and update the matching Studio banner automatically. The changed standard properties apply while local copy, crop and unrelated customizations remain. **Edit blueprint fade** offers a quick fade-only dialog with up to 16 points. Studio saves remain local overrides; original references and previous revisions are preserved. Previously saved mesh revisions synchronize once when their market opens; no Reset banner is needed.

## Image-and-copy generation

Open **Create** for a connected draft-generation graph: **Image → Analyze image → Qwen layout → Format nodes**, with **Copy** also connected to Qwen layout. There is no Compose node and no blocking checker.

- **Image** uploads or replaces the active market's source; **Copy** edits the market's exact headline, subtitle, CTA, legal copy and creative brief.
- **Analyze image** runs Florence-2 (objects, main subject), PaddleOCR (text printed in the photo) and OpenCV (colour); a BiRefNet cut-out is optional. A missing model is reported and the run continues.
- **Qwen layout** (Qwen3-VL 8B, text-only PosterO method, `/vision/layout`) places every connected format using the market's nearest measured blueprints as in-context examples. For each size the code then compares the saved design, the nearest measured blueprint scaled to that size and Qwen's layouts with the same scoring as Studio's Arrange now (fit, collisions, subject crop, reading order, closeness to the reference) and keeps the best. Text fits inside its box and the photo crop follows the subject: every size produces a draft. Turning Qwen off, or Qwen being unavailable, still produces drafts from the saved design or nearest reference.
- **Format** nodes show the draft, which candidate won and any copy that is too long for that size. **Suggest shorter …** asks Qwen for shorter copy; an approved version applies to that size only (`campaign.copyFits`). Generate one size only, Download PNG, Use in Studio (a local edit on that banner, undoable) and Edit in Studio. The Qwen layout node holds Generate layouts, Use all drafts in Studio, Export generated drafts / market matrix, Undo generation and Cancel.

Saved flows from before this change (with a Compose node) are migrated when the project loads; batches from the old strict engine are dropped as regenerable history. Banners already accepted from the old engine keep rendering unchanged.

