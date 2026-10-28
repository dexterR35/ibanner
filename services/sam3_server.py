"""Local Florence subject boxes and opt-in SAM precision; weights load on request."""
import asyncio
from functools import lru_cache
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import sys
import threading

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from services.model_memory import discard_model, clear_device_cache

SERVICE = "bannerflow-sam3"  # Stable wire identity for existing local proxies/clients.
MAX_BYTES = 30 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 40_000_000
HF_REPO = "facebook/sam3"
HF_REVISION = "3c879f39826c281e95690f02c7821c4de09afae7"


@lru_cache(maxsize=1)
def runtime_probe():
    required = ("torch", "torchvision", "timm", "ftfy", "iopath", "huggingface_hub", "einops", "decord", "triton", "pkg_resources", "psutil")
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    try:
        import torch
        cuda = torch.cuda.is_available()
        device = torch.cuda.get_device_name(0) if cuda else "CPU"
    except Exception:
        cuda, device = False, "unavailable"
    return {"missing": missing, "cuda": cuda, "device": device}


@lru_cache(maxsize=1)
def transformers_probe():
    required = ("torch", "torchvision", "transformers", "huggingface_hub", "safetensors")
    missing = [name for name in required if importlib.util.find_spec(name) is None]
    try:
        from services.accelerator import requested_device, select_device
        # Float32 SAM 3 weights are 3.4 GB; 6 GiB leaves room for image features.
        selection = select_device(requested_device("BANNERFLOW_SAM3_DEVICE"), minimum_gib=6)
    except Exception as error:
        selection = {"ready": False, "message": str(error)[:300]}
    if not selection["ready"]:
        return {"missing": missing, "cuda": False, "device": "unavailable", "torchDevice": None,
                "message": selection.get("message")}
    return {"missing": missing, "cuda": selection["device"].startswith("cuda"), "device": selection["deviceName"],
            "torchDevice": selection["device"], "warning": selection.get("warning")}


def transformers_model_path():
    configured = os.environ.get("BANNERFLOW_SAM3_MODEL")
    if configured:
        return Path(configured).expanduser().resolve()
    hf_home = Path(os.environ.get("HF_HOME", Path.home() / ".cache/huggingface"))
    cache = Path(os.environ.get("HF_HUB_CACHE", hf_home / "hub"))
    # The downloader pins this snapshot. Other revisions require an explicit model path.
    return cache / "models--facebook--sam3" / "snapshots" / HF_REVISION


def transformers_files_ready(folder):
    """Preflight only; the model loader validates tensor contents and configuration."""
    try:
        if not isinstance(json.loads((folder / "config.json").read_text(encoding="utf-8")), dict):
            return False
        if not any((folder / name).is_file() for name in ("processor_config.json", "preprocessor_config.json")):
            return False
        if not (folder / "tokenizer_config.json").is_file():
            return False
        if not (folder / "tokenizer.json").is_file() and not all((folder / name).is_file() for name in ("vocab.json", "merges.txt")):
            return False
        index = folder / "model.safetensors.index.json"
        if index.is_file():
            shards = set(json.loads(index.read_text(encoding="utf-8"))["weight_map"].values())
            # Accept local shards only, never path traversal or an incomplete download.
            return bool(shards) and all(Path(name).name == name and (folder / name).is_file() and
                                       (folder / name).stat().st_size > 0 for name in shards)
        weights = folder / "model.safetensors"
        return weights.is_file() and weights.stat().st_size > 0
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return False


def normalized_detections(boxes, scores, label, width, height):
    results = []
    for coordinates, score in zip(boxes, scores):
        values = [float(v) for v in coordinates]
        score = float(score)
        if len(values) != 4 or not all(math.isfinite(v) for v in [*values, score]) or not 0 <= score <= 1:
            continue
        x0, y0, x1, y1 = values
        box = {"xmin": max(0, x0 / width), "ymin": max(0, y0 / height),
               "xmax": min(1, x1 / width), "ymax": min(1, y1 / height)}
        if box["xmin"] >= box["xmax"] or box["ymin"] >= box["ymax"]:
            continue
        results.append({"label": label, "score": score, "box": box})
    return results


class Sam3Engine:
    def __init__(self, repo=None, checkpoint=None, probe=runtime_probe):
        self.repo = Path(repo or os.environ.get("BANNERFLOW_SAM3_REPO", Path(__file__).resolve().parents[2] / "sam3")).resolve()
        self.checkpoint = checkpoint or os.environ.get("BANNERFLOW_SAM3_CHECKPOINT")
        self.probe = probe
        self.processor = None
        self.state = "available"
        self.last_error = None
        self.lock = threading.Lock()

    def unload(self):
        model = getattr(self, 'model', None)
        processor_model = getattr(self.processor, 'model', None)
        self.processor = None
        if hasattr(self, 'model'):
            self.model = None
        discard_model(model)
        if processor_model is not model:
            discard_model(processor_model)
        del model, processor_model
        self.state = 'available'
        clear_device_cache()

    def checkpoint_path(self):
        if self.checkpoint:
            return Path(self.checkpoint).expanduser().resolve()
        candidates = [self.repo / "sam3.pt", self.repo / "checkpoints/sam3.pt"]
        cache = Path.home() / ".cache/huggingface/hub/models--facebook--sam3/snapshots"
        if cache.is_dir():
            candidates += sorted(cache.glob("*/sam3.pt"))
        return next((p for p in candidates if p.is_file()), candidates[0])

    def health(self):
        issues = []
        if not (self.repo / "sam3/model_builder.py").is_file():
            issues.append({"code": "source_missing", "message": "SAM 3 source folder not found."})
        if not self.checkpoint_path().is_file():
            issues.append({"code": "checkpoint_missing", "message": "SAM 3 model weights (sam3.pt) are missing."})
        runtime = self.probe()
        if runtime["missing"]:
            issues.append({"code": "dependencies_missing", "message": "SAM 3 Python dependencies need installation.", "packages": runtime["missing"]})
        # This checkout constructs positional encodings on CUDA even when device='cpu'.
        if not runtime["cuda"]:
            issues.append({"code": "cuda_unavailable", "message": "This SAM 3 installation requires a CUDA-compatible runtime."})
        if self.last_error:
            issues.append({"code": "model_error", "message": self.last_error})
        return {"service": SERVICE, "schemaVersion": 1, "ready": not issues,
                "state": "needs_setup" if issues else self.state, "loaded": self.processor is not None,
                "device": runtime["device"], "issues": issues, "backend": "native"}

    def load_model(self):
        sys.path.insert(0, str(self.repo))
        os.environ["HF_HUB_OFFLINE"] = "1"
        from sam3.model_builder import build_sam3_image_model
        from sam3.model.sam3_image_processor import Sam3Processor
        model = build_sam3_image_model(bpe_path=str(self.repo / "sam3/assets/bpe_simple_vocab_16e6.txt.gz"),
                                      checkpoint_path=str(self.checkpoint_path()), load_from_HF=False,
                                      device="cuda", eval_mode=True, compile=False)
        self.processor = Sam3Processor(model, device="cuda", confidence_threshold=0.5)

    def infer(self, image, labels):
        state = self.processor.set_image(image)
        detections = []
        for label in labels:
            self.processor.reset_all_prompts(state)
            output = self.processor.set_text_prompt(prompt=label, state=state)
            detections += normalized_detections(output["boxes"].detach().cpu().tolist(),
                                               output["scores"].detach().cpu().tolist(), label, *image.size)
        return detections

    def detect(self, image, labels):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, "SAM 3 is already processing another image.")
        try:
            status = self.health()
            if not status["ready"]:
                raise HTTPException(503, " ".join(item["message"] for item in status["issues"]))
            import torch
            if self.processor is None:
                self.state = "loading"
                # Never fetch gated weights or use an uninitialized model implicitly.
                self.load_model()
            self.state = "busy"
            # Bound mask allocations while retaining the original aspect ratio.
            image.thumbnail((1600, 1600))
            with torch.inference_mode():
                detections = self.infer(image, labels)
            return sorted(detections, key=lambda item: item["score"], reverse=True)[:30]
        except HTTPException:
            raise
        except Exception as error:
            self.last_error = "SAM 3 could not load or process the image. Check the local service console."
            print(f"SAM 3 inference failed: {type(error).__name__}: {error}", file=sys.stderr)
            raise HTTPException(503, self.last_error) from error
        finally:
            self.state = "ready" if self.processor else "available"
            self.lock.release()

    def segment(self, image, label):
        raise HTTPException(501, "This SAM backend does not expose the bounded mask contract.")


class TransformersSam3Engine(Sam3Engine):
    """Hugging Face image/text SAM 3; supports CPU without importing the Meta checkout."""

    def __init__(self, model_path=None, probe=transformers_probe):
        super().__init__(probe=probe)
        self.model_path = Path(model_path) if model_path else transformers_model_path()
        self.model = None

    def health(self):
        runtime = self.probe()
        issues = []
        if runtime["missing"]:
            issues.append({"code": "dependencies_missing", "message": "Install the local Transformers environment for SAM 3.",
                           "packages": runtime["missing"]})
        if runtime["device"] == "unavailable":
            issues.append({"code": "runtime_unavailable",
                           "message": runtime.get("message") or "PyTorch could not start in the local SAM 3 environment."})
        if not transformers_files_ready(self.model_path):
            issues.append({"code": "checkpoint_missing", "message": "Download the Hugging Face SAM 3 model files after access is approved."})
        if self.last_error:
            issues.append({"code": "model_error", "message": self.last_error})
        return {"service": SERVICE, "schemaVersion": 1, "ready": not issues,
                "state": "needs_setup" if issues else self.state, "loaded": self.processor is not None,
                "device": runtime["device"], "issues": issues, "backend": "transformers",
                "note": runtime.get("warning") or ("CPU mode is supported. Searches may be slow." if not runtime["cuda"] else "")}

    def load_model(self):
        import torch
        from transformers import Sam3Model, Sam3Processor
        probe = self.probe()
        device = probe.get("torchDevice") or ("cuda" if probe["cuda"] else "cpu")
        if device == "cpu":
            torch.set_num_threads(min(4, os.cpu_count() or 1))
        options = {"local_files_only": True, "trust_remote_code": False}
        # Use explicit image classes: AutoModel can select a different SAM task.
        model = Sam3Model.from_pretrained(str(self.model_path), **options, dtype=torch.float32,
                                         attn_implementation="sdpa").to(device).eval()
        processor = Sam3Processor.from_pretrained(str(self.model_path), **options)
        self.model, self.processor = model, processor

    def segment(self, image, label):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, "SAM 3 is already processing another image.")
        try:
            if not self.health()["ready"]:
                raise HTTPException(503, "SAM 3 model is unavailable.")
            import torch
            import numpy as np
            if self.processor is None:
                self.load_model()
            original_size = image.size
            proxy = image.copy()
            proxy.thumbnail((1024, 1024))
            self.state = "busy"
            with torch.inference_mode():
                inputs = self.processor(images=proxy, text=label or "person", return_tensors="pt").to(self.model.device)
                output = self.model(**inputs)
                result = self.processor.post_process_instance_segmentation(output, threshold=0.5, mask_threshold=0.5, target_sizes=[(proxy.height,proxy.width)])[0]
            selected = result["scores"].argsort(descending=True)[:8].tolist()
            instances = []
            for index in selected:
                mask = result["masks"][index].detach().cpu().numpy().astype("uint8")
                mask = np.asarray(Image.fromarray(mask).resize(original_size, Image.Resampling.NEAREST))
                box = result["boxes"][index].detach().cpu().tolist()
                box = [box[0]*image.width/proxy.width,box[1]*image.height/proxy.height,box[2]*image.width/proxy.width,box[3]*image.height/proxy.height]
                instances.append((mask,box,float(result["scores"][index])))
            return instances
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(503, "SAM mask inference failed; use manual focus or the box fallback.") from error
        finally:
            self.state = "ready" if self.processor else "available"
            self.lock.release()

    def infer(self, image, labels):
        inputs = self.processor(images=image, return_tensors="pt").to(self.model.device)
        vision = self.model.get_vision_features(pixel_values=inputs.pixel_values)
        detections = []
        for label in labels:
            text = self.processor(text=label, return_tensors="pt").to(self.model.device)
            output = self.model(vision_embeds=vision, input_ids=text.input_ids, attention_mask=text.attention_mask)
            # Cropping needs boxes; avoid upsampling every segmentation mask to image size.
            result = self.processor.post_process_object_detection(output, threshold=0.5,
                                                                  target_sizes=[(image.height, image.width)])[0]
            detections += normalized_detections(result["boxes"].detach().cpu().tolist(),
                                               result["scores"].detach().cpu().tolist(), label, *image.size)
        return detections


def create_app(engine=None, tools=None, vision=None):
    if engine is None:
        backend = os.environ.get("BANNERFLOW_SAM3_BACKEND", "transformers")
        if backend not in {"native", "transformers"}:
            raise ValueError("BANNERFLOW_SAM3_BACKEND must be native or transformers.")
        engine = Sam3Engine() if backend == "native" else TransformersSam3Engine()
    from services.vision.scheduler import ModelScheduler
    scheduler = ModelScheduler()
    def release_sam():
        if hasattr(engine, 'unload'):
            engine.unload()
            return
        if hasattr(engine, 'model'): engine.model = None
        if hasattr(engine, 'processor'): engine.processor = None
        if hasattr(engine, 'state'): engine.state = 'available'
    scheduler.register('sam', release_sam)
    from services.vision.runtime import VisionRuntime
    vision = vision or VisionRuntime()
    app = FastAPI(title="Bannerflow local image analysis", docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def local_requests_only(request, call_next):
        host = request.url.hostname
        origin = request.headers.get("origin")
        allowed = {f"http://{name}:{port}" for name in ("localhost", "127.0.0.1") for port in (5178, 5179, 4173)}
        if host not in {"127.0.0.1", "localhost", "::1"} or (origin and origin not in allowed):
            return JSONResponse({"detail": "Only the local banner app may use this service."}, status_code=403)
        return await call_next(request)

    @app.get("/health")
    async def health(precision: bool = False):
        if precision:
            return await asyncio.to_thread(engine.health)
        profile = await asyncio.to_thread(vision.profile, 'florence')
        return {'service': SERVICE, 'schemaVersion': 1, 'engine': 'florence',
                'ready': profile['ready'], 'state': 'needs_setup' if not profile['ready'] else 'busy' if vision.lock.locked() else 'available',
                'loaded': vision.loaded == profile.get('profileId'), 'device': profile.get('deviceName') or 'unavailable',
                'issues': [] if profile['ready'] else [{'code': 'florence_setup', 'message': profile.get('message') or 'Run npm run florence:download.'}]}

    @app.post("/detect")
    async def detect(request: Request, query: str = Query(min_length=1, max_length=160), precision: bool = False):
        labels = list(dict.fromkeys(label.strip().lower() for label in query.split(",") if label.strip()))[:5]
        if not labels:
            raise HTTPException(422, "Enter a subject to find.")
        if "person" in labels and "human face" not in labels:
            labels.append("human face")
        if request.headers.get("content-type", "").split(";")[0] not in {"image/png", "image/jpeg", "image/webp"}:
            raise HTTPException(415, "Use a PNG, JPEG or WebP image.")
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_BYTES:
                raise HTTPException(413, "Use an image smaller than 30 MB.")
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"PNG", "JPEG", "WEBP"} or source.width * source.height > 40_000_000:
                    raise ValueError("Unsupported image.")
                image = ImageOps.exif_transpose(source).convert("RGB")
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as error:
            raise HTTPException(422, "Image could not be decoded or exceeds 40 megapixels.") from error
        if await request.is_disconnected():
            raise HTTPException(499, "Search cancelled.")
        if precision:
            detections = await scheduler.submit('sam', engine.detect, image, labels, request=request)
        else:
            detections = await scheduler.submit('vision', vision.run, 'subjects', {'sourceImage': image, 'labels': labels}, request=request)
        return {"service": SERVICE, "schemaVersion": 1, "engine": "sam3" if precision else "florence", "detections": detections}

    from services.tool_routes import install_tool_routes
    from services.vision.routes import install_vision_routes
    install_tool_routes(app, engine, tools, scheduler)
    install_vision_routes(app, vision, scheduler)
    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=5181, access_log=False)
