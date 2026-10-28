# JSX structure and reusable UI

The app uses JavaScript for logic and JSX for React components. Shared UI is independent of campaign data. Pages compose feature components; the workspace provider owns shared state and actions. The canvas renderer and blueprint contracts stay in `core/`.

## Source map

```text
src/
├── main.jsx                       # Mount React
├── App.jsx                        # BrowserRouter and global styles
├── app/
│   ├── router.jsx                 # Page and editor routes
│   ├── navigation.js              # Sidebar labels and icons
│   ├── WorkspaceProvider.jsx      # Load workspace once, context and dialogs
│   └── workspace-context.js
├── layouts/
│   ├── WorkspaceLayout.jsx        # Sidebar + topbar + <Outlet />
│   └── Page.jsx                   # Page spacing and optional sidebar
├── pages/
│   ├── CampaignPage.jsx
│   ├── BlueprintsPage.jsx
│   ├── AssetsPage.jsx
│   ├── BlueprintEditorPage.jsx    # Structural editor and explicit standard save
│   ├── EditorPage.jsx             # Route entry lookup and lazy editor
│   └── NotFoundPage.jsx
├── components/
│   ├── ui/                       # Generic controls and containers
│   │   ├── index.js              # Public component exports
│   │   ├── Button.jsx
│   │   ├── Input.jsx
│   │   ├── Field.jsx
│   │   ├── Card.jsx
│   │   ├── Title.jsx
│   │   ├── Feedback.jsx
│   │   └── Modal.jsx
│   ├── workspace/                # Sidebar, topbar, header, global dialogs
│   ├── campaign/                 # Campaign panel, artboards, tools, collection
│   ├── assets/                   # Uploaded asset library
│   ├── banner/                   # Shared canvas preview
│   └── editor/                   # Editor, Konva surface, timeline, text controls
├── hooks/
│   ├── useProject.js             # IndexedDB persistence and image resources
│   ├── useWorkspace.js           # Workspace context consumer
│   ├── useAutoArrange.js         # Debounced composition and manual arrangement
│   └── useWorkspaceController.js # Campaign, market, blueprint and export actions
├── styles/
│   ├── tokens.css                # Theme colors, font and surface tokens
│   ├── index.css                 # Shared UI and feature layout styles
│   └── studio.css                # Studio canvas, tools and artboard layout
├── core/                         # Schema, rendering, export, storage, analysis
└── data/                         # Factories, presets and the Banner 3 layout table
```

## Shared components

Import controls from `components/ui/index.js`. They accept native HTML props, including event handlers, `disabled`, accessibility attributes and React 19 `ref` props. They do not read workspace state.

| Component | Main props and behavior |
| --- | --- |
| `Button` | `variant`: `primary`, `secondary` (default), `subtle`, `icon`, `export`, `plain`. `loading` adds a spinner and disables the button. Defaults to `type="button"`; use `type="submit"` explicitly for forms. |
| `IconButton` | `label` provides its accessible name and default tooltip. `title` can override the tooltip. Put an icon inside. |
| `Input`, `Textarea`, `Select` | Native controls with shared styling. Support controlled or uncontrolled values and native `onChange(event)`. |
| `Field` | `label`, `hint`, `error`, one control child. Connects label, hint and error IDs; errors set `aria-invalid` and announce an alert. |
| `TextField`, `TextareaField`, `SelectField` | Field and control composed together. `fieldClassName` styles the wrapper; `className` styles the control. `SelectField` takes option children. |
| `NumberField` | `label`, `value`, `onChange(number)`, `min`, `max`, `step`. Keeps the existing editor's finite-number callback contract. |
| `Checkbox` | `label`, `checked`, native `onChange(event)`. Label includes the control. |
| `Card`, `CardHeader`, `CardBody`, `CardFooter` | Composable containers with `as`, `className` and native props. Card defaults to an `article`. |
| `InfoCard` | `icon` (a component), `title`, body children, `tone`: `info`, `warning`, `success`. |
| `Title` | Semantic heading via `as="h1"` (default), `h2`, or `h3`; accepts native props. |
| `PageHeader` | `eyebrow`, `title`, `description`, `actions`. One page heading. |
| `SectionHeader` | `title`, optional `count`, `actions`, `className`. An `h2` for collections. |
| `EmptyState` | `icon`, body children and optional `action`. |
| `LoadingState` | `title`, `description`, optional `icon`; announced as a status. |
| `ProgressBar` | Indeterminate operation feedback with an accessible `label` and current-stage `description`; no estimated percentage. |
| `StatusMessage` | Body children, `icon`, `variant`: `toast`, `error`, or `busy-status`. Errors use an alert role. |
| `Modal` | `title`, `onClose`, `wide`, body children. Native modal dialog with a labeled title and Escape handling. Mount it only while open. |

Choose `Field` with a primitive when the control needs custom composition. Use the precomposed fields for ordinary forms. Add feature styling with classes rather than duplicating the shared control markup.

Focused text, number, color, textarea and select controls use one accent border. Search and the market selector highlight their shared wrapper instead of the nested control. Buttons, links, checkboxes and sliders retain their keyboard focus outline.

```jsx
import { Info } from 'lucide-react';
import {
  Button, TextField, Card, CardHeader, CardBody, CardFooter, InfoCard, Title,
} from '../components/ui/index.js';

export default function CampaignNameCard({ name, onNameChange, onSave, saving }) {
  return (
    <Card>
      <CardHeader><Title as="h2">Campaign details</Title></CardHeader>
      <CardBody>
        <TextField
          label="Campaign name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          hint="Used in the exported file name."
        />
        <InfoCard icon={Info} title="Shared across formats">
          Each banner can keep its own layout override.
        </InfoCard>
      </CardBody>
      <CardFooter>
        <Button variant="primary" loading={saving} onClick={onSave}>Save</Button>
      </CardFooter>
    </Card>
  );
}
```

## Pages, layouts and Outlet

`WorkspaceProvider` is a parent route, so navigating between pages or opening an editor keeps the loaded project and workspace controls alive. Its Outlet renders either `WorkspaceLayout` or the full editor. `WorkspaceLayout` has a second Outlet for the selected dashboard page.

| URL | Page |
| --- | --- |
| `/` | Redirect to `/campaign`, retaining query parameters |
| `/campaign` | Zoomable artboard workspace and campaign sidebar |
| `/blueprints` | Layout diagrams and Edit blueprint actions for every market |
| `/assets` | Uploaded originals |
| `/campaign/:entryId/edit` | Individual banner editor |
| `/blueprints/:entryId` | Read-only blueprint diagram, dimensions, layout areas and GIF timing |
| `/blueprints/:entryId/edit` | Structural blueprint editor, saving to the standard and matching Studio banner |
| Any unknown route or entry | Recovery page with a campaign action |

`?market=BANNER2` selects the active market and survives reloads and browser history. Editor content uses the market belonging to its `entryId`, including direct URLs without a query string. For example, `/campaign/BANNER2-320x50/edit` opens the BANNER2 banner. Saving or closing returns to the corresponding market and collection.

To add a page:

1. Create a JSX file in `src/pages/`. Compose it with `Page`, `PageHeader` (or `WorkspacePageHeader` for market context), and shared UI.
2. Register its route inside `WorkspaceLayout` in `src/app/router.jsx`.
3. Add its label and icon in `src/app/navigation.js` if it belongs in the sidebar. Use the same ID as its first URL segment.
4. Read shared state through `useWorkspace()` in the page or feature container. Pass props to reusable presentational components. Keep page-local state local.

```jsx
import Page from '../layouts/Page.jsx';
import { PageHeader, InfoCard } from '../components/ui/index.js';

export default function ReportsPage() {
  return (
    <Page>
      <PageHeader title="Reports" description="Review your campaign output." />
      <InfoCard title="Ready for content">Compose this page from shared components.</InfoCard>
    </Page>
  );
}
```

For a page with a secondary panel, pass `sidebar={<YourPanel />}` to `Page`. It appears to the right of the content on desktop and below it on mobile, matching the campaign page. The editor has its own full-screen shell and is lazy-loaded from `EditorPage`.

React Router uses browser URLs. A production host must serve `index.html` for non-file app routes so direct URLs and refresh work. Vite's development server already provides this fallback. See the official [routing guide](https://reactrouter.com/start/declarative/routing) and [Outlet API](https://reactrouter.com/api/components/Outlet).

## Styling and boundaries

Change interface colors and typography in `styles/tokens.css`; put shared control rules in `styles/index.css`. Feature layouts use named classes in that stylesheet. Low-specificity card defaults allow existing banner/reference layouts to retain their sizing. Interface theme changes never change blueprint artwork colors.

Keep rendering, storage and schema logic out of UI primitives. `useWorkspaceController` coordinates existing domain operations; `core/` remains their implementation. Original assets and saved blueprint JSON are unchanged by this component refactor.

Subject focus is a campaign feature in `components/campaign/SubjectFocusPanel.jsx`, using shared fields, buttons and checkboxes. `hooks/useSubjectFocus.js` handles local inference state; `core/subject-data.js` validates normalized metadata and `core/subject-position.js` handles reusable crop geometry. `useSubjectService.js` supplies Florence-2 connection diagnostics through `core/subject-service.js`. There is no browser inference runtime or provider picker. SAM precision is explicit API-only. The editor keeps the Create GIF switch visible for every format and mounts Timeline only for animated mode.

Blueprint cards use `components/blueprints/BlueprintCard.jsx` and `BlueprintPreview.jsx`; these components never receive campaign content or resource bindings. Every market renders SVG layout boxes; there is no linked example artwork. `FormatCollection` shares search and size filters between the Studio collection and the blueprint library. `BlueprintDetailPage` owns the read-only detail view, and its Edit in Studio action opens the campaign editor for the entry's market. Save banner stores a local override. Edit blueprint opens `BlueprintEditorPage` and reuses Editor with `blueprintMode`, the same layer list/inspector, Konva geometry/mesh controls and GIF-only Timeline. It supplies no campaign resources or copy. Headline, Subtitle and Legal add actions assign source roles at creation, so selecting a text layer needs no Content binding field. `core/blueprint-diagram.js` paints boxes through `renderFrame` with shared timing, crossfades and `core/image-fade.js` treatment; Save blueprint calls the standard sync action.

The detail view also has a scoped `BlueprintFadeEditor` dialog. It reuses `FadeMeshControls` for type, presets, point count and softness. `FadeMeshDiagram` adds accessible draggable/keyboard points and transition guides to the structural diagram; `FadeMeshOverlay` provides the equivalent Konva handles in Studio and the focused editor. Both consume `core/fade-mesh.js` for direction mapping, bounds and interpolation. `core/blueprint-fade.js` accepts only image fade properties and appends an immutable draft revision; it cannot update campaign content or other layout fields. Both full and fade-only saves use `core/blueprint-edit.js` to synchronize the matching banner, preserving unrelated local properties and history.


## Studio canvas components

- `ArtboardWorkspace` takes `items` (`id`, `width`, `height`), `renderArtboard`, `empty`, `resetKey`, `footer`, optional top-center `actions`, centered `overlay`, left `inspector` and lower `timeline` slots. Selection is controlled through `selectedId`, `onSelect` and `onDeselect`; `marketKey` separates temporary artboard placements. It owns bounded camera movement, fitting, shortcuts and title dragging. `renderArtboard` receives the current zoom and whether artwork interaction is allowed. View controls stay fixed as artboards move; camera fitting reserves room for controls. It never changes campaign data.
- `CanvasToolbar` provides the reusable floating Select, Hand, zoom, fit and optional reset-placement controls. `BannerCard` presents dimensions, GIF status, export and an optional focused-editor action. Clicking artwork selects its inline editor; unselected boards use `BannerPreview` with exact native pixels through the shared renderer.
- `StudioBannerEditor` lazy-loads one active `Editor`, preserves resources during replacement and commits through `saveEditor(..., { stayInStudio: true })`. The shared `Editor` owns draft state and undo/redo for both inline and focused editing. In inline mode it portals the inspector and GIF timeline into workspace slots and validates/autosaves per-banner overrides; focused mode retains explicit Save.
- `EditorLayers`, `LayerInspector` and `LayerAssetPreview` are shared JSX components used by both editor presentations. Inline properties expose per-banner copy, layout, crop, fade and styling; original uploads and market typography remain in the right campaign panel. The shared `CanvasEditor` adjusts interaction padding and handle size for Studio camera zoom without changing output geometry.
- `StudioToolbar` composes shared search, filter tabs and Add size. `CanvasCampaignActions` combines `AutoPlaceSubject` with a native `Button` using `aria-pressed` for Match blueprints / Keep blueprint boxes and another `aria-pressed` toggle `Button` for Arrange now / automatic arrangement. Turning arrangement on applies it immediately. Neither control has a checkbox or a second click target. They use the selected campaign’s persisted settings and market-scoped actions. The group occupies the canvas’s absolutely positioned `actions` slot, stays fixed during zoom/pan, and wraps on narrow canvases. `ArtboardWorkspace` observes its height to keep the fitted artboards, floating tool rail and inspector below it. Provider and layout guidance use tooltips. `FormatSearch` and `FormatTabs` in `FormatControls.jsx` are also used by the Blueprint library.
- `CampaignPage` supplies `studio-artboard-page` to `Page`, imports the scoped `studio.css` layout, and composes the canvas with the existing right sidebar. It has no campaign hero heading or draft/reference summary card.
- `useSubjectFocus.autoPlace` makes an explicit cancellable request to local Florence-2 with the original image resource. Its `placing` flag disables mutation controls and guards controller actions; `SubjectPlacementStatus` shares a borderless infinite bar, Florence-2 label and cancel icon across the canvas overlay, reference pages and editor wait screen. Completed/error feedback stays in the toolbar; the full stage remains available to assistive technology. `core/focus-market.js` applies the chosen subject to current banner layouts, only changing crop coordinates and zoom. Automatic upload searches and sidebar manual selection retain their previous semantics. Successful manual searches display the selectable results without a match-count paragraph; progress, errors and no-match guidance remain visible. SubjectFocusPanel has no provider picker; setup failures leave manual focus available.

The shared inspector omits Layer name, Content binding, Preferred size and the Fill available space button. `TextLayoutControls` is unboxed, with no section border or background. New text defaults to line spacing 1 and vertical middle. Existing current banners, standards and working drafts also receive spacing 1 through the one-time workspace migration; historical snapshots stay intact. `fitText` automatically grows/shrinks copy within each saved box for preview and every export; local text edits preserve box geometry.

`GifParts` displays native-size, shared-renderer scene snapshots below each animated `BannerCard`. Its `gifGroupHeight` supplies the complete grouped bounds to `ArtboardWorkspace`. Part selection passes a scene request through `StudioBannerEditor` to the existing Editor, seeking its timeline without creating another editor or changing artwork data.


Create uses `WorkflowProgress.jsx` for completed-step percentages and elapsed time, and `CopyFitPanel.jsx` on format nodes for copy that is too long for a size (Qwen shorter copy, approved per size).
