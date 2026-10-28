"""Explicit one-time setup: npm run qwen:download [-- --variant qwen3-vl-8b | --list]."""
import argparse
import os

from huggingface_hub import snapshot_download

from .models import qwen_registry, qwen_variant, qwen_variant_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--variant', help='Registry id (default: BANNERFLOW_QWEN_VARIANT or the registry default)')
    parser.add_argument('--list', action='store_true', help='Show registered variants and exit')
    args = parser.parse_args()
    if args.list:
        for name, variant in qwen_registry()['variants'].items():
            print(f"{name}: {variant['repo']} @ {variant['revision'][:12]}, {variant['weightsGB']} GB, "
                  f"{variant['license']}; needs {variant['budgets']['cuda']['recommended']}")
        return
    variant = qwen_variant(args.variant or qwen_variant_id())
    print(f"Downloading {variant['repo']} at {variant['revision']} ({variant['weightsGB']} GB weights).", flush=True)
    folder = snapshot_download(
        variant['repo'], revision=variant['revision'],
        allow_patterns=['*.json', '*.safetensors', 'merges.txt', '*.jinja'],
        max_workers=2,
    )
    os.environ['BANNERFLOW_QWEN_VARIANT'] = variant['id']
    from .runtime import VisionRuntime
    profile = VisionRuntime().profile('qwen')
    if not profile.get('installed'):
        raise RuntimeError(profile.get('message', 'Incomplete checkpoint'))
    print(f'Installed and discovered: {folder}', flush=True)
    if variant['id'] != qwen_registry()['default']:
        print(f"Select it with BANNERFLOW_QWEN_VARIANT={variant['id']} (in .env or the shell), then restart npm run dev.")
    print(profile.get('message') or f"Qwen is ready for local planning on {profile.get('deviceName')}.", flush=True)


if __name__ == '__main__':
    main()
