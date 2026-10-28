"""Image-tool route and engine tests with fake models; these do not claim model quality."""
import io
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from services import models
from services.sam3_server import create_app

HAS_TORCH = importlib.util.find_spec("torch") is not None


class FakeEngine:
    def health(self):
        return {"service": "bannerflow-sam3", "schemaVersion": 1, "ready": True, "state": "available",
                "loaded": False, "device": "test fixture", "issues": []}


class FakeTools:
    def __init__(self):
        self.calls = []

    def health(self):
        ready = {"ready": True, "issues": []}
        return {"service": "bannerflow-tools", "schemaVersion": 1, "state": "available", "device": "CPU",
                "tools": {"cutout": {**ready, "selection": "box"}, "extend": ready, "upscale": ready}}

    def cutout(self, image, box, label):
        self.calls.append(("cutout", image.size, box, label))
        return Image.new("RGBA", (10, 20), (255, 0, 0, 128)), (0.1, 0.2, 0.3, 0.6), "birefnet"

    def extend(self, image, pads):
        self.calls.append(("extend", image.size, pads))
        return Image.new("RGB", (image.width * 2, image.height))

    def upscale(self, image, scale):
        self.calls.append(("upscale", image.size, scale))
        return image.resize((image.width * scale, image.height * scale))


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.tools = FakeTools()
        self.client = TestClient(create_app(FakeEngine(), self.tools), base_url="http://127.0.0.1:5181")
        buffer = io.BytesIO()
        Image.new("RGB", (40, 30)).save(buffer, format="PNG")
        self.png = buffer.getvalue()
        self.headers = {"content-type": "image/png", "origin": "http://localhost:5178"}

    def post(self, path, params=None, headers=None):
        return self.client.post(path, params=params or {}, content=self.png, headers=headers or self.headers)

    def test_health_lists_each_tool(self):
        self.assertEqual(self.client.get("/tools/health").json()["tools"]["extend"]["ready"], True)

    def test_cutout_returns_png_bounds_and_engine(self):
        response = self.post("/tools/cutout", {"label": " Person ", "xmin": .1, "ymin": .2, "xmax": .5, "ymax": .9})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(response.headers["x-bannerflow-box"], "0.100000,0.200000,0.300000,0.600000")
        self.assertEqual(response.headers["x-bannerflow-engine"], "birefnet")
        self.assertEqual(Image.open(io.BytesIO(response.content)).mode, "RGBA")
        self.assertEqual(self.tools.calls, [("cutout", (40, 30), [.1, .2, .5, .9], "person")])
        self.assertEqual(self.post("/tools/cutout").status_code, 200, "no box removes the whole background")
        self.assertIsNone(self.tools.calls[-1][2])

    def test_invalid_requests_never_reach_the_tools(self):
        self.assertEqual(self.post("/tools/cutout", {"xmin": .1}).status_code, 422)
        self.assertEqual(self.post("/tools/cutout", {"xmin": .5, "ymin": .1, "xmax": .4, "ymax": .9}).status_code, 422)
        self.assertEqual(self.post("/tools/extend").status_code, 422)
        self.assertEqual(self.post("/tools/extend", {"left": 3}).status_code, 422)
        self.assertEqual(self.post("/tools/upscale", {"scale": 3}).status_code, 422)
        self.assertEqual(self.post("/tools/upscale", headers={"content-type": "image/gif"}).status_code, 415)
        self.assertEqual(self.post("/tools/upscale", headers={**self.headers, "origin": "https://x.example"}).status_code, 403)
        self.assertEqual(self.tools.calls, [])

    def test_extend_and_upscale_contracts(self):
        response = self.post("/tools/extend", {"left": .5, "right": .5})
        self.assertEqual(Image.open(io.BytesIO(response.content)).size, (80, 30))
        self.assertEqual(self.tools.calls[-1], ("extend", (40, 30), (.5, 0, .5, 0)))
        response = self.post("/tools/upscale", {"scale": 4})
        self.assertEqual(Image.open(io.BytesIO(response.content)).size, (160, 120))
        self.assertEqual(response.headers["x-bannerflow-engine"], "real-esrgan-x4")


class ModelFileTests(unittest.TestCase):
    def test_missing_or_tampered_weights_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict("os.environ", {"BANNERFLOW_MODEL_DIR": folder}):
            self.assertFalse(models.file_ready("lama"))
            path = Path(folder, models.FILES["lama"]["name"])
            with open(path, "wb") as handle:
                handle.truncate(models.FILES["lama"]["bytes"])
            self.assertTrue(models.file_ready("lama"), "size preflight only")
            with self.assertRaises(RuntimeError):
                models.verified_path("lama")

    def test_health_reports_missing_weights_without_loading(self):
        from services.image_tools import ImageTools
        with tempfile.TemporaryDirectory() as folder, patch.dict(
                "os.environ", {"BANNERFLOW_MODEL_DIR": folder, "BANNERFLOW_BIREFNET_MODEL": folder}):
            tools = ImageTools()
            health = tools.health()["tools"]
            self.assertFalse(any(tool["ready"] for tool in health.values()))
            self.assertEqual(health["cutout"]["selection"], "box")
            with self.assertRaises(HTTPException) as caught:
                tools.upscale(Image.new("RGB", (8, 8)), 2)
            self.assertEqual(caught.exception.status_code, 503)
            self.assertIsNone(tools.birefnet)
            self.assertFalse(tools.lock.locked())

    def test_busy_tools_return_retryable_error(self):
        from services.image_tools import ImageTools
        tools = ImageTools()
        tools.lock.acquire()
        try:
            with self.assertRaises(HTTPException) as caught:
                tools.extend(Image.new("RGB", (8, 8)), (.5, 0, .5, 0))
            self.assertEqual(caught.exception.status_code, 429)
        finally:
            tools.lock.release()


@unittest.skipUnless(HAS_TORCH, "optional PyTorch environment not installed")
class EngineTests(unittest.TestCase):
    def ready(self):
        # Bypass weight preflight: these tests inject fake models.
        return patch("services.image_tools.ImageTools.health", lambda self: {"tools": {
            name: {"ready": True, "issues": []} for name in ("cutout", "extend", "upscale")}})

    def test_rrdbnet_shapes_match_both_supported_scales(self):
        import torch
        from services.image_tools import build_rrdbnet
        for scale in (2, 4):
            with torch.inference_mode():
                out = build_rrdbnet(scale).eval()(torch.rand(1, 3, 12, 16))
            self.assertEqual(tuple(out.shape), (1, 3, 12 * scale, 16 * scale))

    def test_tiled_upscale_equals_single_pass(self):
        import torch
        from services.image_tools import ImageTools

        class Nearest(torch.nn.Module):
            def forward(self, x):
                return torch.nn.functional.interpolate(x, scale_factor=2, mode="nearest")

        tools = ImageTools()
        tools.esrgan[2] = Nearest()
        image = Image.effect_noise((50, 37), 60).convert("RGB")
        with self.ready():
            tiled = tools._upscale(image, 2, tile=16, overlap=4)
        self.assertEqual(tiled.size, (100, 74))
        self.assertEqual(tiled.tobytes(), image.resize((100, 74), Image.NEAREST).tobytes())

    def test_extension_keeps_every_original_pixel(self):
        import torch
        from services.image_tools import ImageTools

        class Grey(torch.nn.Module):
            def forward(self, image, mask):
                return torch.full_like(image, 0.5)

        tools = ImageTools()
        tools.lama = Grey()
        image = Image.effect_noise((40, 20), 80).convert("RGB")
        with self.ready():
            result = tools.extend(image, (0.5, 0, 0.25, 0))
        self.assertEqual(result.size, (70, 20))
        self.assertEqual(result.crop((20, 0, 60, 20)).tobytes(), image.tobytes())
        self.assertEqual(result.getpixel((2, 10)), (128, 128, 128))

    def test_sam_mask_decides_object_and_matte_softens_its_edge(self):
        import torch
        from services.image_tools import refine_mask
        sam = torch.zeros(40, 40, dtype=torch.bool)
        sam[10:30, 10:30] = True
        matte = torch.full((40, 40), 0.5)
        refined, used = refine_mask(sam, matte, torch)
        self.assertTrue(used)
        self.assertEqual(float(refined[20, 20]), 1.0)
        self.assertEqual(float(refined[0, 0]), 0.0)
        self.assertEqual(float(refined[10, 20]), 0.5, "contour band uses the soft matte")
        unrelated = torch.zeros(40, 40)
        unrelated[0:5, 0:5] = 1
        self.assertFalse(refine_mask(sam, unrelated, torch)[1], "a matte on another object is ignored")

    def test_cutout_prefers_the_matching_sam_instance(self):
        import numpy as np
        import torch
        from services.image_tools import ImageTools

        class Sam:
            def __init__(self):
                import threading
                self.lock = threading.Lock()
                self.loaded = False

            def health(self):
                return {"ready": True}

            def segment(self, image, label):
                self.loaded = True
                near = np.zeros((image.height, image.width), dtype=bool)
                near[20:60, 10:40] = True
                far = np.zeros_like(near)
                far[5:15, 70:95] = True
                return [(far, [70, 5, 95, 15], .9), (near, [10, 20, 40, 60], .8)]

            def unload(self):
                self.loaded = False

        tools = ImageTools(sam=Sam())
        def matte(crop):
            if tools.sam:
                self.assertFalse(tools.sam.loaded, 'SAM weights must be unloaded before BiRefNet loads')
            return torch.ones(crop.height, crop.width)
        tools.matte = matte
        image = Image.new("RGB", (100, 80), (0, 120, 0))
        with self.ready():
            cut, box, engine = tools.cutout(image, (0.1, 0.25, 0.4, 0.75), "person", precision=True)
        self.assertEqual(engine, "sam3+birefnet")
        # The near instance (30×40) plus the 2 px contour band where this all-ones matte applies;
        # the far instance is excluded.
        self.assertEqual(cut.size, (34, 44))
        for value, expected in zip(box, (8 / 100, 18 / 80, 42 / 100, 62 / 80)):
            self.assertAlmostEqual(value, expected)
        # Even an available SAM must never run in the default BiRefNet path.
        tools.sam.health = lambda: self.fail('Default cut-out probed SAM')
        with self.ready():
            _, box, engine = tools.cutout(image, (0.1, 0.25, 0.4, 0.75), "person")
        self.assertEqual(engine, "birefnet")


if __name__ == "__main__":
    unittest.main()
