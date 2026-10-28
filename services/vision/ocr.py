"""Local text reading with PaddleOCR PP-OCRv6 models through RapidOCR (ONNX Runtime, CPU).

The detection and recognition models ship inside the pinned `rapidocr` wheel. They are
checked against pinned SHA-256 hashes and passed as explicit paths, so a request never
downloads anything. A fresh engine is built per job and released afterwards, like the
other model families.
"""
import hashlib
import importlib.metadata
import json
import math
from functools import lru_cache
from pathlib import Path

RAPIDOCR_VERSION = '3.10.0'
# Bundled PP-OCRv6 "small" multilingual models (covers English and other Latin scripts).
MODELS = {
    'det': ('PP-OCRv6_det_small.onnx', '090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f'),
    'rec': ('PP-OCRv6_rec_small.onnx', '6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884'),
}
TEXT_SCORE = 0.5
MAX_LINES = 300


def _fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


@lru_cache(maxsize=8)
def _sha256(path, size, mtime):  # size/mtime make the cache follow file changes
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def _model_folder():
    import rapidocr
    return Path(rapidocr.__file__).resolve().parent / 'models'


def ocr_status():
    """Readiness without loading models. Never raises."""
    base = {'ready': False, 'engine': 'rapidocr', 'models': 'PP-OCRv6 small (PaddleOCR)', 'device': 'cpu'}
    try:
        version = importlib.metadata.version('rapidocr')
        runtime = importlib.metadata.version('onnxruntime')
    except importlib.metadata.PackageNotFoundError:
        return {**base, 'message': 'PaddleOCR (RapidOCR) is not installed. Run npm run ai:setup.'}
    if version != RAPIDOCR_VERSION:
        return {**base, 'message': f'Install the pinned rapidocr {RAPIDOCR_VERSION} runtime with npm run ai:setup (found {version}).'}
    try:
        folder = _model_folder()
        files = {}
        for role, (name, expected) in MODELS.items():
            path = folder / name
            if not path.is_file():
                return {**base, 'message': f'PaddleOCR model {name} is missing. Reinstall with npm run ai:setup.'}
            stat = path.stat()
            if _sha256(str(path), stat.st_size, stat.st_mtime_ns) != expected:
                return {**base, 'message': f'PaddleOCR model {name} does not match its pinned hash. Reinstall with npm run ai:setup.'}
            files[role] = {'file': name, 'sha256': expected}
    except (ImportError, OSError) as error:
        return {**base, 'message': f'PaddleOCR is unavailable: {error}'[:300]}
    contract = {'engine': 'rapidocr', 'version': version, 'onnxruntime': runtime, 'models': files,
                'textScore': TEXT_SCORE, 'useAngleClassifier': False, 'coordinateSpace': 'normalized-oriented-preview'}
    return {**base, 'ready': True, 'message': None, 'version': version, 'profileId': _fingerprint(contract),
            'contract': contract}


def read_text(image, status=None):
    """Lines of text with confidence and a normalized axis-aligned box, top to bottom."""
    status = status or ocr_status()
    if not status['ready']:
        raise RuntimeError(status['message'])
    import numpy as np
    from rapidocr import RapidOCR
    folder = _model_folder()
    engine = RapidOCR(params={
        'Global.log_level': 'warning', 'Global.text_score': TEXT_SCORE,
        # Banners are upright; the 180-degree classifier adds time and flips short words.
        'Global.use_cls': False,
        'Det.model_path': str(folder / MODELS['det'][0]),
        'Rec.model_path': str(folder / MODELS['rec'][0]),
    })
    try:
        output = engine(np.asarray(image.convert('RGB')))
    finally:
        del engine
    width, height = image.size
    lines = []
    boxes = output.boxes if output.boxes is not None else []
    for quad, text, score in zip(boxes, output.txts or (), output.scores or ()):
        text = ' '.join(str(text).split())
        if not text or not math.isfinite(float(score)):
            continue
        xs, ys = [float(p[0]) for p in quad], [float(p[1]) for p in quad]
        if not all(math.isfinite(v) for v in xs + ys):
            continue
        x1, y1 = max(0.0, min(xs)), max(0.0, min(ys))
        x2, y2 = min(float(width), max(xs)), min(float(height), max(ys))
        if x2 - x1 < 2 or y2 - y1 < 2:
            continue
        lines.append({'text': text[:500], 'confidence': round(min(1.0, max(0.0, float(score))), 4),
                      'box': {'x': x1 / width, 'y': y1 / height, 'width': (x2 - x1) / width, 'height': (y2 - y1) / height}})
    lines.sort(key=lambda line: (round(line['box']['y'], 3), line['box']['x']))
    return {'schemaVersion': 1, 'engine': 'rapidocr', 'width': width, 'height': height,
            'lines': lines[:MAX_LINES], 'profileId': status['profileId'],
            'provenance': {**status['contract'], 'modelsLabel': status['models'], 'device': 'cpu'}}
