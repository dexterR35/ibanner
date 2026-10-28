"""Adapter contract tests with a fake engine; these do not claim SAM 3 inference."""
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from services.sam3_server import Sam3Engine, TransformersSam3Engine, create_app, normalized_detections, transformers_files_ready


class FakeEngine:
    def __init__(self):
        self.calls = []

    def health(self):
        return {"service": "bannerflow-sam3", "schemaVersion": 1, "ready": True,
                "state": "available", "loaded": False, "device": "test fixture", "issues": []}

    def detect(self, image, labels):
        self.calls.append((image.size, image.mode, labels))
        return normalized_detections([[10, 20, 60, 80]], [.9], labels[0], *image.size)


class DefaultDetectorTests(unittest.TestCase):
    def test_default_health_and_search_use_florence_without_probing_sam(self):
        from services.vision.runtime import VisionRuntime
        sam, vision = FakeEngine(), VisionRuntime()
        profile = {'ready': True, 'profileId': 'fixture', 'deviceName': 'fixture CPU'}
        answer = [{'label': 'person', 'box': {'xmin': .1, 'ymin': .2, 'xmax': .6, 'ymax': .8}}]
        client = TestClient(create_app(sam, vision=vision), base_url='http://127.0.0.1:5181')
        data = io.BytesIO()
        Image.new('RGB', (100, 80)).save(data, format='PNG')
        with patch.object(sam, 'health', side_effect=AssertionError('SAM health probed')), \
             patch.object(sam, 'detect', side_effect=AssertionError('SAM inference ran')), \
             patch.object(vision, 'profile', return_value=profile), \
             patch.object(vision, 'run', return_value=answer) as infer:
            self.assertTrue(client.get('/health').json()['ready'])
            response = client.post('/detect?query=person', content=data.getvalue(), headers={'content-type': 'image/png'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['engine'], 'florence')
            self.assertEqual(response.json()['detections'], answer)
            self.assertEqual(infer.call_args.args[0], 'subjects')
            self.assertEqual(infer.call_args.args[1]['labels'], ['person', 'human face'])
            self.assertIsNone(vision.model)

    def test_missing_florence_does_not_require_sam_or_load_any_model(self):
        from services.vision.runtime import VisionRuntime
        vision = VisionRuntime()
        client = TestClient(create_app(FakeEngine(), vision=vision), base_url='http://127.0.0.1:5181')
        with patch.object(vision, 'profile', return_value={'ready': False, 'message': 'Run npm run florence:download.'}):
            status = client.get('/health').json()
        self.assertFalse(status['ready'])
        self.assertEqual(status['issues'][0]['code'], 'florence_setup')
        self.assertIsNone(vision.model)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = FakeEngine()
        self.client = TestClient(create_app(self.engine), base_url="http://127.0.0.1:5181")
        buffer = io.BytesIO()
        Image.new("RGB", (100, 100)).save(buffer, format="PNG")
        self.png = buffer.getvalue()

    def upload(self, query="person", image=None, headers=None):
        return self.client.post("/detect", params={"query": query, "precision": True}, content=self.png if image is None else image,
                                headers=headers or {"content-type": "image/png", "origin": "http://localhost:5178"})

    def test_health_and_normalized_detection_contract(self):
        self.assertEqual(self.client.get("/health?precision=true").json(), self.engine.health())
        response = self.upload(" Person, person, playing card ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.engine.calls, [((100, 100), "RGB", ["person", "playing card", "human face"])])
        self.assertEqual(response.json()["engine"], "sam3")
        self.assertEqual(response.json()["detections"][0]["box"], {"xmin": .1, "ymin": .2, "xmax": .6, "ymax": .8})

    def test_invalid_queries_and_images_never_reach_inference(self):
        for query in ("", "  ,  ", "a" * 161):
            self.assertEqual(self.upload(query).status_code, 422)
        self.assertEqual(self.upload(image=b"not an image").status_code, 422)
        self.assertEqual(self.upload(headers={"content-type": "image/svg+xml"}).status_code, 415)
        with patch("services.sam3_server.MAX_BYTES", 10):
            self.assertEqual(self.upload().status_code, 413)
        self.assertEqual(self.engine.calls, [])

    def test_only_local_app_origins_can_submit(self):
        response = self.upload(headers={"content-type": "image/png", "origin": "https://other.example"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/health", headers={"host": "other.example"}).status_code, 403)
        self.assertEqual(self.engine.calls, [])

    def test_exif_orientation_matches_browser_coordinates(self):
        buffer = io.BytesIO()
        exif = Image.Exif()
        exif[274] = 6
        Image.new("RGB", (40, 80)).save(buffer, format="JPEG", exif=exif)
        response = self.upload(image=buffer.getvalue(), headers={"content-type": "image/jpeg"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.engine.calls[0][0], (80, 40))

    def test_boxes_are_clamped_and_invalid_values_removed(self):
        boxes = [[-10, -10, 200, 200], [5, 5, 5, 10], [0, 0, float('nan'), 30], [0, 0, 10, 10]]
        results = normalized_detections(boxes, [.9, .8, .9, 2], "person", 100, 100)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["box"], {"xmin": 0, "ymin": 0, "xmax": 1, "ymax": 1})

    def test_missing_weights_and_cuda_stop_before_model_loading(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "sam3").mkdir()
            Path(folder, "sam3/model_builder.py").touch()
            engine = Sam3Engine(repo=folder, checkpoint=str(Path(folder, "missing.pt")),
                                probe=lambda: {"missing": ["timm"], "cuda": False, "device": "CPU"})
            health = engine.health()
            self.assertFalse(health["ready"])
            self.assertEqual({issue["code"] for issue in health["issues"]},
                             {"checkpoint_missing", "cuda_unavailable", "dependencies_missing"})
            with self.assertRaises(HTTPException) as caught:
                engine.detect(Image.new("RGB", (10, 10)), ["person"])
            self.assertEqual(caught.exception.status_code, 503)
            self.assertIsNone(engine.processor)
            self.assertFalse(engine.lock.locked())

    def test_busy_engine_returns_retryable_error(self):
        engine = Sam3Engine()
        engine.lock.acquire()
        try:
            with self.assertRaises(HTTPException) as caught:
                engine.detect(Image.new("RGB", (10, 10)), ["person"])
            self.assertEqual(caught.exception.status_code, 429)
        finally:
            engine.lock.release()

    def test_transformers_cpu_is_not_reported_as_cuda_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ("config.json", "processor_config.json", "tokenizer_config.json", "tokenizer.json"):
                (root / name).write_text('{}')
            engine = TransformersSam3Engine(model_path=root, probe=lambda: {"missing": [], "cuda": False, "device": "CPU"})
            self.assertEqual([item['code'] for item in engine.health()['issues']], ['checkpoint_missing'])
            (root / 'model.safetensors').write_bytes(b'fixture preflight only')
            health = engine.health()
            self.assertTrue(health['ready'])
            self.assertFalse(health['loaded'])
            self.assertEqual(health['backend'], 'transformers')
            self.assertIn('CPU mode is supported', health['note'])

    def test_transformers_shards_must_be_complete_and_local(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ("config.json", "processor_config.json", "tokenizer_config.json", "tokenizer.json"):
                (root / name).write_text('{}')
            index = root / 'model.safetensors.index.json'
            index.write_text(json.dumps({'weight_map': {'layer': 'part.safetensors'}}))
            self.assertFalse(transformers_files_ready(root))
            (root / 'part.safetensors').write_bytes(b'fixture preflight only')
            self.assertTrue(transformers_files_ready(root))
            index.write_text(json.dumps({'weight_map': {'layer': '../part.safetensors'}}))
            self.assertFalse(transformers_files_ready(root))

    @unittest.skipUnless(importlib.util.find_spec('transformers'), 'optional Transformers environment not installed')
    def test_real_transformers_cpu_execution_with_tiny_random_test_weights(self):
        # Exercises model loading, text/image processors, CPU forward and box processing.
        # Random tiny weights establish API/runtime compatibility, NOT detection accuracy.
        import torch
        from tokenizers import Tokenizer, models, pre_tokenizers
        from transformers import Sam3Model, Sam3Config, Sam3Processor, Sam3ImageProcessor, PreTrainedTokenizerFast
        from huggingface_hub.utils import disable_progress_bars
        disable_progress_bars()
        torch.set_num_threads(2)
        common = dict(hidden_size=32, num_attention_heads=4, intermediate_size=64, num_layers=1)
        config = Sam3Config(
            vision_config=dict(backbone_config=dict(hidden_size=32, intermediate_size=64, num_hidden_layers=2,
                num_attention_heads=4, image_size=224, patch_size=14, window_size=8, global_attn_indexes=[0, 1]),
                fpn_hidden_size=32, scale_factors=[2.0, 1.0]),
            text_config=dict(vocab_size=32, hidden_size=32, intermediate_size=64, projection_dim=32,
                num_hidden_layers=2, num_attention_heads=4, max_position_embeddings=32, hidden_act='gelu',
                bos_token_id=0, eos_token_id=1),
            geometry_encoder_config=dict(**common, mask_fuser_hidden_size=32, mask_fuser_num_layers=1),
            detr_encoder_config=common,
            detr_decoder_config=dict(**common, num_queries=5),
            mask_decoder_config=dict(hidden_size=32, num_upsampling_stages=2),
        )
        tokenizer = Tokenizer(models.WordLevel({'[PAD]': 0, '[UNK]': 1, 'person': 2, 'human': 3, 'face': 4}, unk_token='[UNK]'))
        tokenizer.pre_tokenizer = pre_tokenizers.Whitespace()
        tokenizer = PreTrainedTokenizerFast(tokenizer_object=tokenizer, pad_token='[PAD]', unk_token='[UNK]', model_max_length=32)
        processor = Sam3Processor(Sam3ImageProcessor(size={'height': 224, 'width': 224}), tokenizer)
        with tempfile.TemporaryDirectory() as folder:
            Sam3Model(config).save_pretrained(folder)
            processor.save_pretrained(folder)
            engine = TransformersSam3Engine(model_path=folder, probe=lambda: {'missing': [], 'cuda': False, 'device': 'CPU'})
            self.assertTrue(engine.health()['ready'])
            with patch('socket.socket.connect', side_effect=AssertionError('Inference must stay offline')):
                detections = engine.detect(Image.new('RGB', (160, 80)), ['person', 'human face'])
            self.assertIsInstance(detections, list)
            self.assertEqual(engine.model.device.type, 'cpu')
            self.assertTrue(engine.health()['loaded'])
            self.assertFalse(engine.lock.locked())


if __name__ == "__main__":
    unittest.main()
