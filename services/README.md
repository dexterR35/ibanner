# Local Qwen, Florence-2 and BiRefNet services

The app sends an uploaded image and object query to a loopback-only Python service. Normalized subject boxes feed the existing per-format crop engine. Frames, fades, original files and master revisions retain their existing behavior. Default subject search uses Florence-2 phrase-grounded boxes; cut-outs use BiRefNet alone. Explicit precision requests can use SAM instance masks with BiRefNet matting. Box detection remains independently usable.

## Set up any machine (NVIDIA GPU, AMD/CPU, macOS)

The browser app never needs this service. To enable Qwen planning, Florence-2 subject boxes/analysis and BiRefNet image tools on a machine (SAM is optional):

```sh
npm run ai:setup          # detects the GPU, creates .venv-sam3, installs a matching PyTorch build
npm run florence:download # ~1 GB, needed by Create's Analyze image node and Blueprint import
npm run qwen:download     # ~17.5 GB, Qwen3-VL 8B Instruct planner
npm run ai:doctor         # runs real GPU kernels and reports what will run where
npm run qwen:smoke        # loads Qwen on the chosen device and checks one plan
npm run dev
```

`ai:setup` reads `nvidia-smi`. It picks the newest PyTorch CUDA build that has kernels for the GPU and that the driver supports, otherwise the CPU build. Then it installs the pinned service requirements with PyTorch locked so nothing can replace it, and runs the doctor. It is safe to rerun: an existing environment and a matching PyTorch are reused. Options: `--dry-run`, `--torch <channel>`, `--python <path>`, `--reinstall-torch`, `--recreate`.

| Channel | PyTorch | For |
| --- | --- | --- |
| `cu130` | 2.14.1 | NVIDIA compute 7.5–12.x (Turing to Blackwell, including RTX 50-series) with a driver supporting CUDA 13.0+. Default when possible. |
| `cu128` | 2.11.0 | Same GPUs plus Volta, for drivers supporting CUDA 12.8–12.9. |
| `cu126` | 2.14.1 | Older GPUs (Maxwell to Hopper). **Has no Blackwell kernels**: an RTX 50-series card reports CUDA available and then fails at the first kernel. |
| `cu132` | 2.14.1 | Explicit only (`--torch cu132`); Python 3.13–3.14. |
| `cpu` | 2.14.1 | No NVIDIA GPU, or a driver too old for the GPU (setup prints the driver version needed). |
| `rocm7.2` | 2.14.1 | Explicit only, Linux AMD GPUs. Not tested in this project. |
| `pypi` | 2.14.1 | macOS. The services run on CPU (MPS is not implemented). |

Supported Python: 3.13 (preferred), 3.12, 3.14, 3.11, 3.10. **Python 3.15 is not yet usable**: Pillow 12.1.1 and PyYAML have no 3.15 wheels. On Windows, `py install 3.13` (Python install manager) adds a usable interpreter next to a newer default; setup finds it through `py -3.13`. On Linux use the distribution's `python3.13`/`python3.12` or `uv python install 3.13`.

The doctor also checks the build: `torch.cuda.is_available()` alone is not enough. Every service uses one device selector (`services/accelerator.py`). It skips any GPU whose compute capability has no kernels in the installed build and says why, and it picks the largest GPU that meets the model's memory budget. An explicit `cuda`/`cuda:N` request never falls back to the CPU. Device settings, most specific first: `BANNERFLOW_QWEN_DEVICE`, `BANNERFLOW_FLORENCE_DEVICE`, `BANNERFLOW_SAM3_DEVICE`, `BANNERFLOW_TOOLS_DEVICE`, then `BANNERFLOW_DEVICE`; values `auto` (default), `cpu`, `cuda`, `cuda:N`.

Per-machine settings can live in a gitignored `.env` in the project root (see `.env.example`); shell variables win. npm's Python commands and `npm run dev` load it. For example, `HF_HOME=D:\models\huggingface` keeps model weights off a small system drive. On Windows without Developer Mode, the Hugging Face cache copies files instead of symlinking them; the warning is harmless. Set `HF_HUB_DISABLE_SYMLINKS_WARNING=1` to hide it.

### Qwen3-VL 8B: the sole planner

Banner Flow uses [Qwen/Qwen3-VL-8B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct), pinned to `0c351dd01ed87e9c1b53cbc748cba10e6187ff3b`. Qwen2.5/3B and Qwen3-VL 4B options and their loader are removed. It runs through the existing Python/Transformers service, with no Ollama dependency. The 17.53 GB upstream checkpoint is downloaded once with `npm run qwen:download`; model loading never downloads files.

`BANNERFLOW_QWEN_PRECISION=auto` selects full BF16/FP16 on GPUs meeting the full-weight budget, otherwise NF4 4-bit on compatible smaller CUDA GPUs. NF4 quantizes the same 8B checkpoint, retaining its parameter count; it does not select a smaller model. The visual encoder and output head retain their normal dtype. Quantization method, runtime version and skipped modules participate in the profile fingerprint and provenance, and Create labels NF4 explicitly. `bf16` selects full weights, `nf4` requires a supported CUDA device, and `cpu` device selection uses FP32. There is no CPU/disk offload of a CUDA profile.

| Profile | Application budget |
| --- | --- |
| CUDA NF4 | 16 GB RAM / 12 GB GPU, at least 6 GiB RAM and 9 GiB VRAM free before loading |
| CUDA full weights | 32 GB RAM / 24 GB GPU, at least 8 GiB RAM and 19 GiB VRAM free |
| CPU FP32 | 48 GB RAM minimum / 64 GB recommended, at least 40 GiB available |

These are bounded application budgets, not vendor guarantees. `bitsandbytes==0.50.2` is pinned in the Python requirements. Its Windows CUDA 13.0 NF4 kernels were verified on the RTX 5060 Ti; this does not certify all hardware.

### Verified on Windows with CUDA · 26 October 2026

RTX 5060 Ti 16 GB, 64 GB RAM, Python 3.13, PyTorch 2.14.1+cu130, Transformers 5.17.0 and bitsandbytes 0.50.2. The real 8B NF4 planner smoke passed in 34.3 seconds including loading, with 7.06 GiB peak allocated. The scheduler unloaded weights immediately afterward: resident null, about 32 MiB allocated / 34 MiB reserved, rather than model-sized allocations. CUDA/runtime workspace overhead can remain; completely zero process/device memory is not promised. SAM 3 trained weights remain gated/missing on this machine.

### Subject-aware planning and copy shortening · 26 October 2026

The `/vision/plan` planner (compositions, variant priority, Blueprint edits) was removed on 28 October 2026. Create uses `/vision/layout` with the nearest references as examples, the same operation as Studio's Arrange now; `layout` accepts the node's `modelVariant` / `modelPrecision`.

## Earlier setup on the Linux build machine · 27 September 2026

**Transformers is the default backend and supports CPU.** The separate `.venv-sam3` environment contains Transformers 5.17.0, Accelerate 1.15.0 and Hugging Face Hub 1.33.0. It reuses the machine's installed PyTorch 2.13.0 and torchvision 0.28.0 through system site packages. Global packages and the source checkout at `/home/dexter/Desktop/projects/sam3` were not changed.

Hugging Face's [SAM 3 model card](https://huggingface.co/facebook/sam3) documents `Sam3Model` / `Sam3Processor` with a CPU fallback. This implementation avoids the hard-coded CUDA allocations in the separate Meta checkout. That earlier Linux AMD/PyTorch setup had no GPU acceleration and selected CPU. The current Windows GPU profile is documented above.

Historical Linux SAM verification: the approved Hugging Face account was signed in locally and the full trained weights (3,439,938,512 bytes) are downloaded at the pinned revision. A real application test found **four person/face matches** in the football reference photo. A search with the model already loaded took **34.4 seconds on CPU**; saved focus, market/master isolation and exact PNG/preview pixel equality passed. This is one reference-image smoke test, not a general accuracy benchmark. The smaller random-model test remains useful for runtime checks without gated weights. See the [verified result](../docs/verification/sam3-real-cpu.png) and [test record](../docs/verification/sam3-cpu.json).

## Model access and download on another machine

Request access to [facebook/sam3](https://huggingface.co/facebook/sam3) through your own Hugging Face account and review its conditions there. Once approved, run these commands in a terminal:

```sh
cd /home/dexter/Desktop/projects/banner-flow
.venv-sam3/bin/hf auth login
npm run sam3:download
```

The CLI starts a browser device-authorization flow. Open its link, enter its short code and authorize with the approved account; wait for the CLI to report success. No token needs to be pasted into chat or source files. The downloader verifies the existing account's model access. It does not accept terms, create an account or bypass the access gate. It downloads Transformers JSON/tokenizer/Safetensors files from pinned revision `3c879f39826c281e95690f02c7821c4de09afae7`, excluding the separate native `sam3.pt` checkpoint.

After download, use **Check connection**, then **Find subject**. Model loading happens on the first search. Files stay in the standard Hugging Face cache, or in `BANNERFLOW_SAM3_MODEL` if configured. If your Transformers files are already downloaded at another path/revision, set that variable to the folder containing `config.json`, processor/tokenizer files and `model.safetensors` (or its complete shard index and shards). The source checkout alone and a native `.pt` file are not a Transformers model folder.

## Run and configuration

`npm run dev` starts Vite and the optional Python service, or reuses an existing Bannerflow service on port 5181. It stops only the child processes it started. `npm run dev:ui` runs Vite alone; `npm run sam3:serve` runs the adapter alone. These commands select `BANNERFLOW_PYTHON`, then `.venv-sam3/bin/python` if present, then `python3`.

To recreate the optional environment, run `npm run ai:setup` (see the top of this file). That Linux machine reused a system PyTorch through `--system-site-packages`; `ai:setup` instead installs a matching PyTorch inside the venv. `services/requirements.txt` covers the HTTP adapter only; `requirements-transformers.txt` adds the pinned Transformers stack. The browser app remains usable if Python/model setup is incomplete.

| Variable | Meaning | Default |
| --- | --- | --- |
| `BANNERFLOW_SAM3_BACKEND` | `transformers` or `native` | `transformers` |
| `BANNERFLOW_SAM3_MODEL` | Local Transformers model folder | Pinned HF cache snapshot |
| `BANNERFLOW_PYTHON` | Python executable used by npm commands | Project venv, then `python3` |
| `BANNERFLOW_SAM3_REPO` | Source directory for native backend | Sibling `sam3` directory |
| `BANNERFLOW_SAM3_CHECKPOINT` | Native backend's local `sam3.pt` | Source root, source `checkpoints/`, then usual HF cache |

Restart the service after changing the interpreter, backend or paths. An already-running service is reused and retains its original environment. Native mode remains available for a compatible runtime and native checkpoint; its CUDA requirement applies only to that checkout/backend. Transformers mode uses explicit image classes, Float32, SDPA and `local_files_only=True`, with remote custom code disabled. It reuses image features across text queries and uses the official object-detection postprocessor to avoid allocating original-resolution segmentation masks. Inference never downloads model files or requests credentials.

## Controls and behavior

- **Florence-2** is the default subject detector and uses the local Python service. SAM 3 weights and authentication are unnecessary for this path. Missing setup, inference failures, timeouts and invalid responses show an error; no browser model runs as a fallback. Manual focus, editing and export remain available.
- **Check connection** refreshes diagnostics without loading weights. “Available” means files/runtime preflight passed; the first search still validates and loads the model.
- A valid search with no matches preserves an existing focus. Local query/results persist with the image ID and survive backups. Legacy provider preferences migrate to `florence` without rewriting historical detection provenance.
- Changing image, query or market cancels the client request and discards late results. A running Python operation may finish in the background. Busy-service waiting shares the three-minute client deadline; manual focus or cancellation stops the wait. Model weights unload after every completed or failed job, before the next queued job starts. Restart after correcting the model environment.

## API and privacy

The service binds `127.0.0.1:5181`. Vite proxies `/api/subjects` in dev and local production preview, rejecting non-loopback clients. The adapter restricts Host and Origin to the local app on ports 5178, 5179 or 4173. Static hosting does not include Python; manual focus remains available without a connected local service. A hosted SAM 3 deployment would need a separately authenticated API and is outside this integration.

`GET /health` returns Florence-2 readiness without probing SAM or loading weights. The historical service identity remains `bannerflow-sam3` for existing proxies. `GET /health?precision=true` explicitly checks the optional SAM runtime instead. Both support CPU/CUDA profiles.

`POST /detect?query=person` accepts raw PNG/JPEG/WebP bytes (30 MB and 40 megapixels maximum). Queries are bounded to 160 characters and five unique comma-separated labels; `person` adds a face query. EXIF orientation is normalized. Florence runs `<CAPTION_TO_PHRASE_GROUNDING>` on a preview bounded to 1024 px. Output is `{service, schemaVersion, engine: "florence", detections: [{label, box: {xmin, ymin, xmax, ymax}}]}` in normalized source coordinates. Florence supplies no confidence scores. `precision=true` explicitly selects SAM and its scored detections instead. JavaScript validates model identity, coordinates and optional scores.

`POST /tools/cutout` uses BiRefNet with the selected box, regardless of whether SAM is installed. Only `precision=true` requests optional SAM instance refinement. No automatic escalation or UI precision picker is provided. Normal Create uses its frozen Florence object evidence and never calls SAM. Qwen3-VL 8B remains the editable-layout planner; Qwen-Image 2.1 remains evaluated only.

The local service receives image bytes on this computer, keeps them in memory for inference and writes no source image files. No browser inference runtime is included. Inference sends no images externally. Separate model-download commands contact Hugging Face; no token is needed for already-installed weights, and credentials must stay outside project files/logs.

## Verification

`npm run test:sam3` runs the Python service suite (the command retains its historical name). It covers default Florence routing without SAM probes, normalized grounded boxes, explicit precision, BiRefNet default behavior, queue cleanup, input bounds, EXIF, local origins and optional-model setup. Fake/tiny models verify runtime behavior; they do not establish trained-model accuracy.

The subject browser tests use HTTP fixtures for default Florence integration, persistence, setup errors, malformed responses, busy-service waiting and cancellation. The opt-in subject-focus test runs trained Florence inference and checks persisted crops against exported pixels.

To repeat the full trained-model application test once the service is ready and idle:

```sh
BANNERFLOW_REAL_FLORENCE=1 npx playwright test tests/e2e/subject-focus.spec.js --grep "real local model" --workers=1
BANNERFLOW_REAL_STACK=1 npx playwright test tests/e2e/model-stack.spec.js --workers=1
```

This opt-in run uses an isolated browser workspace and the synthetic photo fixture in `tests/fixtures/`; it does not replace the user's campaign image. Normal test runs skip trained inference and exercise the integration through HTTP fixtures. Browser AI, its dependency and download scripts are removed.

## Optional asset intelligence adapters

The existing loopback service now exposes `/vision/capabilities`, `/vision/ocr`, `/vision/plan`, `/vision/reference`, `/vision/shorten` and `/vision/media` (through `/api/subjects` in Vite). It retains Host/Origin checks, bounded uploads and no inference-time downloads. `/vision/ocr` reads text with PaddleOCR PP-OCRv6 *small* models through pinned RapidOCR 3.10.0 on ONNX Runtime 1.31.1 (CPU); see *PaddleOCR text reading* below. The SigLIP `/vision/embed` route was removed on 27 October 2026 and returns 404. Media sampling uses Pillow for GIF/WebP and local FFmpeg/ffprobe for video, up to 30 MB, 120 seconds, 4 megapixels and 12 sampled frames.

Qwen uses only pinned `Qwen/Qwen3-VL-8B-Instruct`. Qwen is installed in the build environment at pinned revision `0c351dd01ed87e9c1b53cbc748cba10e6187ff3b`. Qwen discovers that snapshot in the standard Hugging Face cache on each machine. For custom installations, configure `BANNERFLOW_QWEN_MODEL` to its local snapshot directory and `BANNERFLOW_QWEN_REVISION` to an immutable 40-character commit hash. Use the pinned `services/requirements-transformers.txt` runtime (5.17.0). Capabilities report setup problems without loading models. No newer/different checkpoint is substituted.

Profiles include model/processor revision, config hashes, runtime, dtype, patch budget, alpha compositing, text preprocessing and prompt version. The adapter uses local files only and no remote model code. The shared local-service scheduler serializes heavy requests across SAM, image tools and vision. Switching families releases other resident models and clears the CUDA allocator cache before loading. This coordinates one service process, not unrelated applications or additional service processes.

The browser owns durable assets and results. The inference process holds no canonical campaign database and never receives filesystem paths from a model. Qwen can only propose allowed variants/IDs; client validation rejects extra fields, copy mutations and invented references. OCR/model text remains untrusted display/search evidence.

Real-checkpoint smoke tests require explicit `BANNERFLOW_REAL_QWEN=1` and a configured installed snapshot. Normal service tests skip those gates and verify unavailable-model behavior. Fixture tests do not establish model quality. The adapter API follows the official [Qwen3-VL](https://huggingface.co/docs/transformers/model_doc/qwen3_vl) runtime contract.


## Portable Qwen activation

Qwen planning and image analysis are enabled by default in **Create**. Each machine selects its own hardware profile; the build machine is not a deployment restriction. Weights load lazily on the first generation, not on a health check. No Qwen inference is required to build the frontend.

Run `npm run ai:setup`, `npm run qwen:download` and `npm run qwen:check`, then restart the local service after source/environment changes. `npm run qwen:smoke` loads the real 8B checkpoint, checks one plan, and reports peak and after-job GPU allocation. See the profile budgets above. Device overrides remain `auto`, `cpu`, `cuda` or `cuda:N`; an explicit unsupported CUDA request never silently uses the CPU.

The shared queue runs one heavy operation at a time. All model families unload after every job, including errors; cancellation of an active GPU call waits for its bounded operation to finish before unloading. A default cut-out loads only BiRefNet. An explicit precision cut-out runs SAM first, transfers its selected mask to CPU, unloads SAM, then loads BiRefNet. No model weights are deleted from disk. Reloading after every job adds latency in exchange for available RAM/VRAM between jobs.

## PaddleOCR text reading

`/vision/ocr` returns `{schemaVersion: 1, engine: "rapidocr", width, height, lines: [{text, confidence, box: {x, y, width, height}}], profileId, provenance}` with normalized boxes, top to bottom. It uses the PP-OCRv6 *small* detection and recognition models that ship inside the pinned `rapidocr` wheel (multilingual Latin script, including accented letters). `ocr_status()` checks both files against pinned SHA-256 hashes and passes explicit paths, so requests never download a model; the angle classifier is off because banners are upright. A new engine is built per job and released afterwards. `npm run ai:setup` installs `services/requirements-ocr.txt` through `requirements-tools.txt`, and `npm run ai:doctor` reports readiness. OCR text is untrusted evidence.

Blueprint finished-banner import and the Asset Library's *Read image text* use it first and fall back to Florence `<OCR_WITH_REGION>`. Import groups lines into blocks (similar height, small gap, overlapping or aligned, same sampled text colour) and suggests roles in order of evidence: a match with the market's campaign headline/subtitle/CTA/legal copy (accent-folded words, or letter pairs for 8+ letters); a solid fill behind short text (CTA button, box traced to the button edges); small bottom text or age/licence marks (legal); a short wordmark above the copy (logo); then the largest and next-largest remaining text (headline, subtitle). When two differently styled blocks match a multi-line headline they become `first-line` and `remaining-lines` layers. Suggested font size is 0.7x the OCR line height (PP-OCRv6 boxes measured ~1.45x the em size for Arial, Arial Bold and Impact at 10-60 px); text colour, button fill and page background are sampled from the reference in the browser. Each layer name states its role, reason and the text read. Florence regions keep a 1:1 size estimate (uncalibrated). Unmatched blocks stay as unassigned text layers.

## Florence-2 reference and Create analysis

The finished-banner import in Blueprints and the connected **Analyze image** node in Create use the pinned [`florence-community/Florence-2-base-ft`](https://huggingface.co/florence-community/Florence-2-base-ft) checkpoint, revision `0b03b6f15a4a211370fb204aee4e7dd48887ea37`. It runs the documented `<OCR_WITH_REGION>` and `<OD>` tasks through the installed Transformers processor and postprocessor. Requests stay on the loopback service; inference loads local weights only and does not run remote model code. The model snapshot is downloaded explicitly into the standard Hugging Face cache.

```sh
npm run florence:download
npm run florence:check
npm run florence:smoke
```

Run the download/check on each machine that will analyze images. The service uses `.venv-sam3` or `BANNERFLOW_PYTHON` and the pinned `services/requirements-transformers.txt` runtime. `BANNERFLOW_FLORENCE_MODEL` and `BANNERFLOW_FLORENCE_REVISION` can select a complete local snapshot at an immutable commit. `BANNERFLOW_FLORENCE_DEVICE` accepts `auto`, `cpu`, `cuda` or `cuda:N`. Auto selects a CUDA device with at least 4 GiB total VRAM or CPU otherwise; explicit CUDA does not switch to CPU. The application preflight budgets 8 GiB physical RAM and 2 GiB available RAM (plus 2 GiB free VRAM for CUDA). These are conservative application thresholds, not a vendor guarantee for every workload. A machine with 32 GB RAM is sufficient for the CPU profile if the pinned runtime and weights are installed. CUDA additionally needs a compatible GPU, driver and CUDA-enabled PyTorch.

Blueprint import reads the reference with PaddleOCR (Florence OCR boxes when PaddleOCR is not ready) and suggests logo, headline, subtitle, CTA and legal roles; see *PaddleOCR text reading* below. It never copies the reference's words into layer text or campaign content. Users review the suggested draft before saving a new immutable revision; an existing size opens as unsaved changes. Create stores Florence object evidence and PaddleOCR text lines (Florence text when PaddleOCR is not ready) in the frozen batch and passes the text as `context.ocr`, with `context.ocrEngine`, to Qwen; the strict solver and shared renderer still own actual placement and export. OpenCV separately measures pixel appearance, and Florence object boxes supply subject focus and SAM 3 is excluded from automatic Create analysis. Neither substitutes for Florence regions. Missing or failed Florence prevents generation through a connected Analyze image node (reference import needs PaddleOCR or Florence); original assets and saved master revisions remain untouched.

On this CPU-only build machine, the installed trained checkpoint found 9 text regions and 5 object regions in one local 300×600 reference smoke. This verifies real inference and the response contract, not region accuracy across markets or reference fidelity. Manual role assignment and visual approval remain necessary.

## Blueprint-aware Qwen planning

Create sends each format's saved design (or a seeded new size) and its nearest references to Qwen as layout trees; there is no separate saved-Blueprint mode.

The HTTP model queue admits up to four active/waiting requests in arrival order and runs one heavyweight operation at a time. Queue overflow returns 429, waiting beyond ten minutes returns 504, and disconnected waiting requests never run. A cancelled active GPU call finishes before the slot is released. `/vision/capabilities` includes queue status and allocated/reserved CUDA memory when available. Model families yield memory on handoff; SAM, image tools and vision discard retired parameter/buffer storage without allocating a CPU weight copy, release owners, collect garbage, synchronize devices and clear allocator caches after every job. `unloadAfterJob` is true and `idleUnloadSeconds` is zero in the active service. Restart the local Python service after changing its source.

## Studio AI arrangement endpoints

- `POST /vision/layout` (Qwen3-VL, text-only): PosterO-style layout generation (Hsu et al., CVPR 2025) re-implemented in `services/vision/layout.py`. Each target sends the canvas, the element ids to place (`<role>_<n>`, character counts, GIF parts) and up to 10 example layout trees (SVG `<rect>` boxes from the nearest references). The model samples `samples` completions per target (temperature 0.7, seeded) in one job; several targets share a generate call. Parsed boxes are clamped to the canvas and unknown ids are dropped. The browser scores every candidate against the saved design and the nearest reference; nothing is applied unchecked.
- `POST /vision/roles` (Qwen3-VL): given a reference image and its PaddleOCR lines, returns one role per line (logo, headline, subtitle, cta, legal, other) plus logo and photo boxes. Used by Blueprint import; the rule-based roles remain the fallback.
- `POST /tools/saliency?columns=32` (BiRefNet): a coarse 0-100 foreground grid and the foreground box of an uploaded image; no pixels are returned.

Measured on the RTX 5060 Ti (16 GB) with Qwen3-VL 8B in NF4: about 24 s to load and about 85 s for the 8 BANNER1 sizes with 3 samples each. Holding each BANNER1 size out of its own examples, the best Qwen candidate matched the real reference boxes at a mean IoU of 0.47, versus 0.59 for scaling the nearest other reference, which is why the browser ranks candidates rather than trusting the model.
