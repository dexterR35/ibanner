"""One-time download of the optional image-tool weights; never called by the image API."""
import sys
import tempfile
import urllib.request
from pathlib import Path

from services.models import BIREFNET_REPO, BIREFNET_REVISION, FILES, birefnet_path, birefnet_ready, file_path, model_dir, sha256


def fetch(key):
    spec, target = FILES[key], file_path(key)
    if target.is_file() and sha256(target) == spec["sha256"]:
        print(f"{spec['name']} already verified.")
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {spec['name']} ({spec['bytes'] / 1e6:.0f} MB, {spec['licence']})…")
    with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as handle:
        partial = Path(handle.name)
    try:
        urllib.request.urlretrieve(spec["url"], partial)
        if sha256(partial) != spec["sha256"]:
            print(f"{spec['name']} failed checksum verification; nothing was installed.")
            return False
        partial.replace(target)
        return True
    finally:
        partial.unlink(missing_ok=True)


def main():
    ok = all([fetch(key) for key in FILES])
    if not birefnet_ready():
        from huggingface_hub import snapshot_download
        print("Downloading BiRefNet general (Swin-L, MIT, ~445 MB)…")
        folder = Path(snapshot_download(BIREFNET_REPO, revision=BIREFNET_REVISION,
                                        allow_patterns=["*.json", "*.py", "model.safetensors"]))
        if folder.resolve() != birefnet_path().resolve():
            print(f"BiRefNet saved at {folder}. Set BANNERFLOW_BIREFNET_MODEL to use it.")
    ok = ok and birefnet_ready()
    print(f"Image tool weights {'are ready' if ok else 'are incomplete'} in {model_dir()} and the Hugging Face cache.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
