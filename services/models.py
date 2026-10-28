"""Pinned local model files for the optional image tools. Inference never downloads."""
import hashlib
import os
from pathlib import Path

# BiRefNet general (Swin-L backbone, MIT). Its model class is custom Hugging Face code,
# executed only from this pinned, locally downloaded revision.
BIREFNET_REPO = "ZhengPeng7/BiRefNet"
BIREFNET_REVISION = "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4"

# Direct release files, verified by SHA-256 before use.
FILES = {
    "lama": {
        "name": "big-lama.pt",
        "url": "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt",
        "sha256": "344c77bbcb158f17dd143070d1e789f38a66c04202311ae3a258ef66667a9ea9",
        "bytes": 205669692,
        "licence": "Apache-2.0 (LaMa)",
    },
    "esrgan-x2": {
        "name": "RealESRGAN_x2plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth",
        "sha256": "49fafd45f8fd7aa8d31ab2a22d14d91b536c34494a5cfe31eb5d89c2fa266abb",
        "bytes": 67061725,
        "licence": "BSD-3-Clause (Real-ESRGAN)",
    },
    "esrgan-x4": {
        "name": "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "sha256": "4fa0d38905f75ac06eb49a7951b426670021be3018265fd191d2125df9d682f1",
        "bytes": 67040989,
        "licence": "BSD-3-Clause (Real-ESRGAN)",
    },
}


def model_dir():
    return Path(os.environ.get("BANNERFLOW_MODEL_DIR", Path.home() / ".cache/bannerflow/models")).expanduser()


def file_path(key):
    return model_dir() / FILES[key]["name"]


def file_ready(key):
    """Cheap preflight by size; the full hash is checked at download and on first load."""
    path = file_path(key)
    return path.is_file() and path.stat().st_size == FILES[key]["bytes"]


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_path(key):
    path = file_path(key)
    if not file_ready(key) or sha256(path) != FILES[key]["sha256"]:
        raise RuntimeError(f"{FILES[key]['name']} is missing or does not match its pinned checksum.")
    return path


def birefnet_path():
    configured = os.environ.get("BANNERFLOW_BIREFNET_MODEL")
    if configured:
        return Path(configured).expanduser().resolve()
    hf_home = Path(os.environ.get("HF_HOME", Path.home() / ".cache/huggingface"))
    cache = Path(os.environ.get("HF_HUB_CACHE", hf_home / "hub"))
    return cache / "models--ZhengPeng7--BiRefNet" / "snapshots" / BIREFNET_REVISION


def birefnet_ready():
    folder = birefnet_path()
    weights = folder / "model.safetensors"
    return all((folder / name).is_file() for name in ("config.json", "birefnet.py", "BiRefNet_config.py")) \
        and weights.is_file() and weights.stat().st_size > 0
