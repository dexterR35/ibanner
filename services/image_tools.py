"""Optional local image tools: BiRefNet cut-out, LaMa background extension, Real-ESRGAN upscale.

Each tool loads lazily from pinned local files, processes one image at a time and never
downloads. Results are new images; the caller stores them as separate derived assets.
"""
from functools import lru_cache
import math
import os
import sys
import threading

from fastapi import HTTPException
from PIL import Image

from services import models

MAX_OUTPUT_PIXELS = 40_000_000


@lru_cache(maxsize=1)
def _selection():
    from services.accelerator import requested_device, select_device
    return select_device(requested_device("BANNERFLOW_TOOLS_DEVICE"), minimum_gib=4)


def _torch():
    import torch
    if _selection().get("device") == "cpu":
        torch.set_num_threads(min(8, os.cpu_count() or 1))
    return torch


def _device(torch):
    selection = _selection()
    if not selection["ready"]:
        raise RuntimeError(selection["message"])
    return selection["device"]


# ---------------------------------------------------------------------------------------------
# Real-ESRGAN RRDBNet (architecture from xinntao/Real-ESRGAN, BSD-3-Clause).
def build_rrdbnet(scale):
    torch = _torch()
    nn, F = torch.nn, torch.nn.functional

    class ResidualDenseBlock(nn.Module):
        def __init__(self, feat=64, grow=32):
            super().__init__()
            self.conv1 = nn.Conv2d(feat, grow, 3, 1, 1)
            self.conv2 = nn.Conv2d(feat + grow, grow, 3, 1, 1)
            self.conv3 = nn.Conv2d(feat + 2 * grow, grow, 3, 1, 1)
            self.conv4 = nn.Conv2d(feat + 3 * grow, grow, 3, 1, 1)
            self.conv5 = nn.Conv2d(feat + 4 * grow, feat, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(0.2, True)

        def forward(self, x):
            x1 = self.lrelu(self.conv1(x))
            x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
            x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
            x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
            return self.conv5(torch.cat((x, x1, x2, x3, x4), 1)) * 0.2 + x

    class RRDB(nn.Module):
        def __init__(self, feat):
            super().__init__()
            self.rdb1, self.rdb2, self.rdb3 = ResidualDenseBlock(feat), ResidualDenseBlock(feat), ResidualDenseBlock(feat)

        def forward(self, x):
            return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x

    class RRDBNet(nn.Module):
        def __init__(self, scale, feat=64, blocks=23):
            super().__init__()
            self.scale = scale
            self.conv_first = nn.Conv2d(3 * (4 if scale == 2 else 1), feat, 3, 1, 1)
            self.body = nn.Sequential(*[RRDB(feat) for _ in range(blocks)])
            self.conv_body = nn.Conv2d(feat, feat, 3, 1, 1)
            self.conv_up1 = nn.Conv2d(feat, feat, 3, 1, 1)
            self.conv_up2 = nn.Conv2d(feat, feat, 3, 1, 1)
            self.conv_hr = nn.Conv2d(feat, feat, 3, 1, 1)
            self.conv_last = nn.Conv2d(feat, 3, 3, 1, 1)
            self.lrelu = nn.LeakyReLU(0.2, True)

        def forward(self, x):
            feat = F.pixel_unshuffle(x, 2) if self.scale == 2 else x
            feat = self.conv_first(feat)
            feat = feat + self.conv_body(self.body(feat))
            feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
            feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
            return self.conv_last(self.lrelu(self.conv_hr(feat)))

    return RRDBNet(scale)


# ---------------------------------------------------------------------------------------------
def _box_iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0


def refine_mask(sam_mask, matte, torch):
    """SAM decides which pixels belong to the object; BiRefNet softens only its contour band.

    A global matte can target a different foreground object. When it barely overlaps the
    selected object, the SAM mask is used alone.
    """
    F = torch.nn.functional
    solid = sam_mask.float()
    area = float(solid.sum())
    if area == 0:
        return solid, False
    if float(((matte > 0.1) & (solid > 0)).sum()) / area < 0.2:
        return solid, False
    h, w = solid.shape
    radius = max(2, min(10, round(min(w, h) * 0.004)))
    size = radius * 2 + 1
    grid = solid[None, None]
    outer = F.max_pool2d(grid, size, 1, radius)[0, 0]
    inner = -F.max_pool2d(-grid, size, 1, radius)[0, 0]
    band = (outer > 0) & (inner == 0)
    refined = inner.clone()
    refined[band] = matte[band]
    return refined, True


class ImageTools:
    def __init__(self, sam=None):
        self.sam = sam
        self.lock = threading.Lock()
        self.state = "available"
        self.birefnet = None
        self.lama = None
        self.esrgan = {}

    def unload(self):
        from services.model_memory import discard_model, clear_device_cache
        for model in [self.birefnet, self.lama, *self.esrgan.values()]:
            discard_model(model)
        self.birefnet = self.lama = None
        self.esrgan.clear()
        clear_device_cache()

    # -- status -----------------------------------------------------------------------------
    def health(self):
        missing = []
        for name in ("torch", "transformers", "timm", "kornia", "einops"):
            try:
                __import__(name)
            except Exception:
                missing.append(name)
        try:
            selection = _selection()
            device = selection["deviceName"] if selection["ready"] else "unavailable"
        except Exception:
            device = "unavailable"

        def tool(ready_files, message, needs=()):
            issues = []
            if any(name in missing for name in needs):
                issues.append({"code": "dependencies_missing", "message": "Install services/requirements-tools.txt."})
            if not ready_files:
                issues.append({"code": "weights_missing", "message": message})
            return {"ready": not issues, "issues": issues}

        birefnet = tool(models.birefnet_ready(), "Run npm run models:download for BiRefNet.",
                        ("torch", "transformers", "timm", "kornia", "einops"))
        return {
            "service": "bannerflow-tools", "schemaVersion": 1, "state": self.state, "device": device,
            "tools": {
                "cutout": {**birefnet, "selection": "box"},
                "extend": tool(models.file_ready("lama"), "Run npm run models:download for LaMa.", ("torch",)),
                "upscale": tool(models.file_ready("esrgan-x2") and models.file_ready("esrgan-x4"),
                                "Run npm run models:download for Real-ESRGAN.", ("torch",)),
            },
        }

    def _run(self, name, work):
        if not self.lock.acquire(blocking=False):
            raise HTTPException(429, "Another image tool is running. Try again when it finishes.")
        try:
            status = self.health()["tools"][name]
            if not status["ready"]:
                raise HTTPException(503, " ".join(item["message"] for item in status["issues"]))
            self.state = "busy"
            return work()
        except HTTPException:
            raise
        except Exception as error:
            print(f"Image tool {name} failed: {type(error).__name__}: {error}", file=sys.stderr)
            raise HTTPException(503, "The image tool could not process this image. Check the local service console.") from error
        finally:
            self.state = "available"
            self.lock.release()

    # -- models -----------------------------------------------------------------------------
    def _birefnet(self):
        torch = _torch()
        if self.birefnet is None:
            from transformers import AutoModelForImageSegmentation
            # Custom model code from the pinned, locally downloaded MIT revision only.
            model = AutoModelForImageSegmentation.from_pretrained(
                str(models.birefnet_path()), trust_remote_code=True, local_files_only=True)
            self.birefnet = model.to(_device(torch)).eval().float()
        return self.birefnet

    def _lama(self):
        torch = _torch()
        if self.lama is None:
            self.lama = torch.jit.load(str(models.verified_path("lama")), map_location=_device(torch)).eval()
        return self.lama

    def _esrgan(self, scale):
        torch = _torch()
        if scale not in self.esrgan:
            state = torch.load(models.verified_path(f"esrgan-x{scale}"), map_location="cpu", weights_only=True)
            state = state.get("params_ema") or state.get("params") or state
            net = build_rrdbnet(scale)
            net.load_state_dict(state, strict=True)
            self.esrgan[scale] = net.to(_device(torch)).eval()
        return self.esrgan[scale]

    # -- operations -------------------------------------------------------------------------
    def matte(self, image):
        """Soft foreground alpha (0–1 tensor at the image size)."""
        torch = _torch()
        F = torch.nn.functional
        model = self._birefnet()
        rgb = torch.from_numpy(__import__("numpy").asarray(image.convert("RGB"), dtype="float32") / 255)
        x = rgb.permute(2, 0, 1)[None]
        x = F.interpolate(x, size=(1024, 1024), mode="bilinear", align_corners=False)
        mean = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
        std = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
        with torch.inference_mode():
            pred = model(((x - mean) / std).to(_device(torch)))[-1].sigmoid().cpu()
        return F.interpolate(pred, size=(image.height, image.width), mode="bilinear", align_corners=False)[0, 0]

    def saliency(self, image, columns=32):
        """BiRefNet foreground map as a coarse grid (0-100 per cell) plus the foreground box.

        Layout uses it to keep copy off the subject; no pixels are returned or stored.
        """
        return self._run("cutout", lambda: self._saliency(image, columns))

    def _saliency(self, image, columns):
        import numpy as np
        rgb = image.convert("RGB")
        rgb.thumbnail((1024, 1024))
        alpha = self.matte(rgb).numpy()
        h, w = alpha.shape
        cols = max(4, min(64, columns))
        rows = max(4, min(64, round(cols * h / w)))
        grid = []
        for r in range(rows):
            for c in range(cols):
                cell = alpha[r * h // rows:max(r * h // rows + 1, (r + 1) * h // rows),
                             c * w // cols:max(c * w // cols + 1, (c + 1) * w // cols)]
                grid.append(int(round(float(cell.mean()) * 100)))
        ys, xs = np.nonzero(alpha > 0.5)
        box = None
        if xs.size:
            box = {"x": float(xs.min()) / w, "y": float(ys.min()) / h,
                   "width": float(xs.max() - xs.min() + 1) / w, "height": float(ys.max() - ys.min() + 1) / h}
        return {"schemaVersion": 1, "engine": "birefnet", "cols": cols, "rows": rows, "values": grid,
                "box": box, "coverage": round(float((alpha > 0.5).mean()), 4)}

    def cutout(self, image, box=None, label="person", precision=False):
        """Transparent RGBA cut-out. Returns (image, normalized box in the source, engine)."""
        return self._run("cutout", lambda: self._cutout(image, box, label, precision))

    def _cutout(self, image, box, label, precision=False):
        import numpy as np
        torch = _torch()
        width, height = image.size
        if box is None:
            crop_box = (0, 0, width, height)
        else:
            x0, y0, x1, y1 = box[0] * width, box[1] * height, box[2] * width, box[3] * height
            pad_x, pad_y = (x1 - x0) * 0.15, (y1 - y0) * 0.15
            crop_box = (max(0, math.floor(x0 - pad_x)), max(0, math.floor(y0 - pad_y)),
                        min(width, math.ceil(x1 + pad_x)), min(height, math.ceil(y1 + pad_y)))
        crop = image.crop(crop_box)
        sam_mask = None
        if box is not None:
            target = (box[0] * width, box[1] * height, box[2] * width, box[3] * height)
            if precision and self.sam and self.sam.health().get("ready"):
                best, best_iou = None, 0.3
                try:
                    instances = self.sam.segment(image, label)
                except HTTPException as error:
                    print(f"SAM 3 masks unavailable for cut-out: {error.detail}", file=sys.stderr)
                    instances = []
                finally:
                    if hasattr(self.sam, 'unload') and not self.sam.lock.locked():
                        self.sam.unload()
                for mask, instance_box, _score in instances:
                    iou = _box_iou(target, instance_box)
                    if iou > best_iou:
                        best, best_iou = mask, iou
                if best is not None:
                    sam_mask = torch.from_numpy(best[crop_box[1]:crop_box[3], crop_box[0]:crop_box[2]])
        # SAM is unloaded before BiRefNet loads. CPU mask pixels connect the stages.
        matte = self.matte(crop)
        engine = "birefnet"
        alpha = matte
        if box is not None:
            if sam_mask is not None:
                alpha, _ = refine_mask(sam_mask, matte, torch)
                engine = "sam3+birefnet"
            else:
                gate = torch.zeros_like(matte)
                gx0, gy0 = int(target[0] - crop_box[0]), int(target[1] - crop_box[1])
                gx1, gy1 = math.ceil(target[2] - crop_box[0]), math.ceil(target[3] - crop_box[1])
                gate[max(0, gy0):gy1, max(0, gx0):gx1] = 1
                alpha = matte * gate
        alpha = (alpha.clamp(0, 1).numpy() * 255).round().astype("uint8")
        rgba = np.dstack([np.asarray(crop.convert("RGB")), alpha])
        result = Image.fromarray(rgba, "RGBA")
        bounds = Image.fromarray((alpha > 5).astype("uint8") * 255).getbbox()
        if not bounds:
            raise HTTPException(422, "No foreground was found in the selected area.")
        result = result.crop(bounds)
        left, top = crop_box[0] + bounds[0], crop_box[1] + bounds[1]
        normalized = (left / width, top / height, (left + result.width) / width, (top + result.height) / height)
        return result, normalized, engine

    def extend(self, image, pads):
        """Grow the canvas by (left, top, right, bottom) fractions and fill the new area with LaMa."""
        return self._run("extend", lambda: self._extend(image, pads))

    def _extend(self, image, pads):
        import numpy as np
        torch = _torch()
        F = torch.nn.functional
        image = image.convert("RGB")
        width, height = image.size
        left, top, right, bottom = (round(p * size) for p, size in zip(pads, (width, height, width, height)))
        full_w, full_h = width + left + right, height + top + bottom
        if full_w * full_h > MAX_OUTPUT_PIXELS:
            raise HTTPException(422, "The extended image would exceed 40 megapixels.")
        # Inpaint at a bounded working size, then keep every original pixel unchanged.
        scale = min(1, 1024 / max(full_w, full_h))
        work_w, work_h = max(8, round(full_w * scale)), max(8, round(full_h * scale))
        inner = (round(left * scale), round(top * scale), round((left + width) * scale), round((top + height) * scale))
        small = image.resize((max(1, inner[2] - inner[0]), max(1, inner[3] - inner[1])), Image.LANCZOS)
        source = np.asarray(small, dtype="float32") / 255
        # Replicate the border as an initial guess; LaMa replaces the masked area.
        canvas = np.pad(source, ((inner[1], work_h - inner[3]), (inner[0], work_w - inner[2]), (0, 0)), mode="edge")
        mask = np.ones((work_h, work_w), dtype="float32")
        # A 2 px overlap lets LaMa blend into the original edge.
        mask[inner[1] + 2:inner[3] - 2, inner[0] + 2:inner[2] - 2] = 0
        pad_h, pad_w = (-work_h) % 8, (-work_w) % 8
        x = torch.from_numpy(canvas).permute(2, 0, 1)[None]
        m = torch.from_numpy(mask)[None, None]
        if pad_h or pad_w:
            x = F.pad(x, (0, pad_w, 0, pad_h), mode="reflect")
            m = F.pad(m, (0, pad_w, 0, pad_h), mode="reflect")
        device = _device(torch)
        with torch.inference_mode():
            out = self._lama()(x.to(device), m.to(device)).cpu()[0, :, :work_h, :work_w]
        filled = Image.fromarray((out.clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype("uint8"))
        result = filled.resize((full_w, full_h), Image.LANCZOS)
        result.paste(image, (left, top))
        return result

    def upscale(self, image, scale):
        return self._run("upscale", lambda: self._upscale(image, scale))

    def _upscale(self, image, scale, tile=192, overlap=12):
        import numpy as np
        torch = _torch()
        image = image.convert("RGB")
        width, height = image.size
        if width * height * scale * scale > MAX_OUTPUT_PIXELS:
            raise HTTPException(422, "The upscaled image would exceed 40 megapixels.")
        net = self._esrgan(scale)
        device = _device(torch)
        source = torch.from_numpy(np.asarray(image, dtype="float32") / 255).permute(2, 0, 1)[None]
        output = torch.zeros((1, 3, height * scale, width * scale))
        # Tiles bound memory on CPU; overlapping margins are discarded to avoid seams.
        for y in range(0, height, tile):
            for x in range(0, width, tile):
                x0, y0 = max(0, x - overlap), max(0, y - overlap)
                x1, y1 = min(width, x + tile + overlap), min(height, y + tile + overlap)
                patch = source[:, :, y0:y1, x0:x1]
                ph, pw = (-patch.shape[2]) % 2, (-patch.shape[3]) % 2
                if ph or pw:
                    patch = torch.nn.functional.pad(patch, (0, pw, 0, ph), mode="replicate")
                with torch.inference_mode():
                    result = net(patch.to(device)).cpu()
                tx1, ty1 = min(width, x + tile), min(height, y + tile)
                output[:, :, y * scale:ty1 * scale, x * scale:tx1 * scale] = \
                    result[:, :, (y - y0) * scale:(ty1 - y0) * scale, (x - x0) * scale:(tx1 - x0) * scale]
        pixels = (output[0].clamp(0, 1).permute(1, 2, 0).numpy() * 255).round().astype("uint8")
        return Image.fromarray(pixels)
