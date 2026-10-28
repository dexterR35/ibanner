# Model roles · 26 October 2026

| Model | Banner role | Current integration |
| --- | --- | --- |
| Qwen3-VL 8B Instruct | Reads imagery/copy and proposes structural layout instructions | Sole planner; NF4 verified on 16 GB CUDA |
| Florence-2 | Subject/object boxes, crop focus and OCR evidence | Default local detector and Create region analyzer; OCR fallback for import and Read image text |
| PaddleOCR PP-OCRv6 small (RapidOCR 3.10.0, ONNX Runtime, CPU) | Text lines with confidence for Blueprint import role suggestions and Asset Library text | Bundled, hash-checked models; preferred over Florence OCR when ready |
| ZhengPeng7/BiRefNet | Transparent subject cut-outs | Default local cut-out adapter; original remains unchanged |
| facebook/sam3 | Optional precise subject selection and segmentation masks | Explicit precision API only; excluded from normal loading, readiness and Create |
| Qwen/Qwen-Image-2.1 | Generates or edits raster artwork, including RGBA assets and masked local edits | Evaluated only; no Diffusers pipeline or generation/edit node added |

The [SAM 3 model card](https://huggingface.co/facebook/sam3) distinguishes `Sam3Model`/`Sam3Processor` concept segmentation (text and exemplar boxes) from `Sam3TrackerModel`/`Sam3TrackerProcessor` visual-prompt segmentation (points, boxes, masks). The pasted tracker examples concern the latter. The existing local image/text adapter uses explicit classes and bounded output; generic `AutoModel` or whole-image automatic mask generation should not replace it without implementing and validating the intended task.

Qwen3-VL 8B, Florence-2 and BiRefNet are already installed on this machine. The default workflow needs no SAM 3 account access or weights. `/health` and `/detect?query=…` use Florence-2; `/tools/cutout` uses BiRefNet with the selected box. These paths never probe or invoke SAM, even when its weights are available. Only an explicit `precision=true` API request selects SAM for detection or cut-out refinement. There is no automatic SAM escalation or precision selector in the UI. SAM setup remains documented for a later precision request. No Hugging Face token belongs in project files or logs.

Florence uses `<CAPTION_TO_PHRASE_GROUNDING>` for query-driven subject search and `<OD>` for Create's object evidence. Its boxes have no model confidence value; the app leaves scores absent. See the [official Florence examples](https://huggingface.co/microsoft/Florence-2-base#caption-to-phrase-grounding) and [BiRefNet inference](https://huggingface.co/ZhengPeng7/BiRefNet#use-the-loaded-birefnet-for-inference). The shared service still unloads weights after each job.

[Qwen-Image 2.1](https://huggingface.co/Qwen/Qwen-Image-2.1) is a different model family from the VL planner. Its official examples use `QwenImage21Pipeline` from Diffusers for text-to-image, image editing and transparent RGBA generation; the card also describes mask/paint-annotation guidance. The repository is approximately 33.1 GB and includes a 7B visual generation component plus other pipeline components. Its documented memory optimization is CPU offload. No local 16 GB VRAM feasibility/performance claim is made; a dedicated pinned runtime and measured quantization/offload profile would be needed.

The [published Qwen-Image 2.1 license](https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE), sections 1(i) and 2, limits the supplied model to research/evaluation and requires a separate commercial license for commercial use. This matters for production advertising. The research model was not downloaded or installed as part of this evaluation.

A future artwork stage should produce new content-hashed derivative assets with provenance, preserving source originals. Florence supplies subject boxes, BiRefNet supplies cut-outs, and Qwen3-VL plans the composition; each model unloads before the next stage. Banner copy, logo, CTA, legal text and timeline remain editable layers in the existing renderer rather than being baked into a generated image. The proposed Qwen-Image generation/editing stage is not implemented.
