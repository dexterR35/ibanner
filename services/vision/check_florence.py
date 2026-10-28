"""Portable Florence preflight; --smoke loads trained weights on a local fixture."""
import argparse
import base64
import json
from pathlib import Path
from .runtime import VisionRuntime


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    runtime = VisionRuntime()
    profile = runtime.profile('florence')
    print(json.dumps({k: profile.get(k) for k in (
        'model', 'installed', 'ready', 'device', 'deviceName', 'dtype',
        'requirements', 'hardware', 'message')}, indent=2))
    if not args.smoke:
        return
    if not profile['ready']:
        raise SystemExit('Resolve the reported prerequisites before running inference.')
    fixture = Path(__file__).resolve().parents[2] / 'tests/fixtures/text-banner-300x600.png'
    result = runtime.run('reference', {
        'image': base64.b64encode(fixture.read_bytes()).decode(),
        'profileId': profile['profileId'],
    })
    if not result['textRegions']:
        raise SystemExit('Florence ran but found no text regions in the local banner fixture.')
    print(json.dumps({'smoke': 'passed', 'textRegions': len(result['textRegions']),
                      'objects': len(result['objects']), 'provenance': result['provenance']}, indent=2))


if __name__ == '__main__':
    main()
