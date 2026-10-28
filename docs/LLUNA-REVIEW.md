# Lluna review · 26 October 2026

> Historical review. Since 28 October 2026 Create is Image → Analyze image → Qwen layout → Format nodes; the Suggest-layouts preview, Compose node and strict validator described below were removed. See SYSTEM.md.

Reviewed [dexterR35/lluna](https://github.com/dexterR35/lluna) at commit `b3754354c43c861195e1d240914d1287be18694a`, specifically its [node registry](https://github.com/dexterR35/lluna/blob/b3754354c43c861195e1d240914d1287be18694a/backend/graph/registry.py), [device scheduler](https://github.com/dexterR35/lluna/blob/b3754354c43c861195e1d240914d1287be18694a/backend/graph/scheduler.py) and [memory budgets](https://github.com/dexterR35/lluna/blob/b3754354c43c861195e1d240914d1287be18694a/backend/tools/shared/memory.py).

Lluna separates dependency order from device admission: independent pixel/file nodes can overlap, while heavyweight model adapters take a device slot. Its model cache is conservative on ordinary GPUs, and its memory checks account for image resolution and leave headroom. Bannerflow uses the same architectural ideas with its own bounded, serial inference queue; no Lluna runtime or executable node imports were added.

| Lluna node/model role | Bannerflow application |
| --- | --- |
| Load Image, Prompt, Describe Image | Image and Copy inputs; Florence-2 regions and Qwen VL layout planning |
| Preview / Save Image | Layout diagrams, shared Canvas previews, native PNG/ZIP export |
| Remove Background / BiRefNet variants | Existing optional derived cut-out workflow |
| Select Object / SAM | Existing optional subject-focus adapter; gated weights still require setup |
| Upscale / Real-ESRGAN; retouch / LaMa | Existing optional image-tool adapters |
| Generate Image / FLUX.2, Qwen-Image | Raster generation/editing; these do not replace an editable layout blueprint |

For this request, the image and exact advertising copy should determine a new composition. Sending an existing master to a vision-language model biases it toward rearranging that master. Create now omits saved geometry from the default planner context and candidate pool. **Use saved Blueprint** explicitly restores the old, revision-pinned path. Qwen-Image in Lluna is an image generator; Bannerflow's Qwen3-VL 8B planner produces constrained layout instructions. They are distinct model families.

The node flow is **Image + Copy → Analyze → Suggest layouts → Generate suggested layouts → Format outputs → Studio / export**. Suggestions are editable scene instructions rendered as labeled diagrams, not baked final pixels. Qwen advice remains subject to deterministic fit/copy/subject checks. Rules provide a visible fallback when Qwen cannot plan.

Memory changes: decoded-image cache ownership is capped at eight entries / 96 MiB estimated RGBA pixels; images still in use remain valid. Rejected candidates keep failure evidence without retaining unused text measurements. The model service admits at most four active/waiting requests, executes one at a time, drops disconnected waiters, releases model families during handoff, clears allocator caches when Florence/Qwen switch, and unloads model weights immediately after every job. The browser holds up to eight waiting jobs with captured inputs and removable queue entries. Pending browser work ends when leaving Create or switching markets; it is not an unattended service.

These limits bound cache/queue ownership, not total browser/process memory. Active previews, reference resources, model weights, inference activations and export buffers also use memory. No new model downloads, diffusion runtime, Lluna graph import, arbitrary model nodes, or brand/reference approval is implied.


## Node UI and execution review · 27 October 2026

Read the actual [LlunaNode.jsx](https://github.com/dexterR35/lluna/blob/main/frontend/src/nodes/LlunaNode.jsx) and [node CSS](https://github.com/dexterR35/lluna/blob/main/frontend/src/styles/index.css). The Create redesign adapts its separate header/media/settings/footer structure, model availability controls, typed outside handles, stage status and progress display. It does not import Lluna executable graphs, diffusion models or arbitrary Python tools.

Image/Copy → Analyze image → Suggest layouts → preview → Generate suggested layouts → dimensions is the intended path. Analyze image can run independently and displays Florence object boxes. Suggestions list every connected size with a checked schematic or actionable blockers. Placement, photo allocation and text fitting run automatically from frozen evidence using campaign typography. Node controls for subject position, photo share, font limits and manual recipes have been removed. Old fresh-flow tuning cannot require production font/logo assets or restrict the automatic recipe search. Failed layouts trigger a bounded alternate-placement search with the same strict checks. Generating unchanged reviewed suggestions promotes the same scenes without repeating Qwen. Saved-Blueprint mode uses authored geometry/constraints and disables fresh subject-aware designs; generation locks remain authoritative.

The model selector captures the pinned Qwen checkpoint and precision per request; cache keys isolate choices. The service advertises installed/ready models and still runs one heavy operation at a time with immediate weight cleanup. Busy controls disable edits, model selection, uploads and conflicting runs; cancellation and view navigation remain available. The old UI queue buttons are superseded by this locking behavior. Existing queued-job data remains compatible.

Percentage is completed workflow units (source/analysis/cut-out/planning/size checks), with elapsed time. It holds during model loading/inference because no reliable per-kernel completion percentage is available; there is no timer-based fake progress. View-layout version 2 reflows old node positions once without changing edges/settings, artwork, original assets or master history. Arrange nodes repeats that view-only reflow. Add all market sizes derives dimensions from configured market Blueprints instead of a hardcoded list.
