"""Explicit, pinned Florence setup; inference never downloads weights."""
from huggingface_hub import snapshot_download
from .models import FLORENCE_REPO, FLORENCE_REVISION


def main():
    print(f'Downloading {FLORENCE_REPO} at {FLORENCE_REVISION}.', flush=True)
    folder = snapshot_download(
        FLORENCE_REPO,
        revision=FLORENCE_REVISION,
        allow_patterns=['*.json', '*.safetensors', 'merges.txt', 'vocab.json'],
        max_workers=2,
    )
    from .runtime import VisionRuntime
    profile = VisionRuntime().profile('florence')
    if not profile.get('installed'):
        raise RuntimeError(profile.get('message', 'Incomplete Florence checkpoint'))
    print(f'Installed and discovered: {folder}', flush=True)
    print(profile.get('message') or 'Florence is ready for local analysis.', flush=True)


if __name__ == '__main__':
    main()
