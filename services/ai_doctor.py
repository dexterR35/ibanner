"""What can this machine run? `npm run ai:doctor` (add `-- --json` for machine-readable output).

Checks the installed PyTorch build against each GPU, runs small real kernels
(float32, half-precision matmul, convolution and attention) and reports which
models are installed and where they would run. Loads no model weights.
"""
import argparse
import importlib.metadata
import json
import os
import platform
import shutil
import sys
import time

from services.accelerator import hardware_status, requested_device, select_device


def gpu_smoke(index, half):
    """Run the kinds of kernels the models use. Returns (ok, detail)."""
    import torch
    device = f'cuda:{index}'
    try:
        start = time.perf_counter()
        torch.manual_seed(0)
        a = torch.randn(1024, 1024, device=device)
        b = torch.randn(1024, 1024, device=device)
        expected = a.cpu().double() @ b.cpu().double()
        # TF32 may be enabled, so compare loosely against a float64 CPU reference.
        error = ((a @ b).cpu().double() - expected).abs().max().item()
        if error > 1.0:
            return False, f'float32 matmul differs from the CPU result by {error:.3f}'
        dtype = getattr(torch, half)
        product = (a.to(dtype) @ b.to(dtype)).float()
        image = torch.randn(1, 3, 64, 64, device=device, dtype=dtype)
        conv = torch.nn.functional.conv2d(image, torch.randn(8, 3, 3, 3, device=device, dtype=dtype))
        q = torch.randn(1, 4, 128, 64, device=device, dtype=dtype)
        attention = torch.nn.functional.scaled_dot_product_attention(q, q, q)
        torch.cuda.synchronize(device)
        if not all(torch.isfinite(t.float()).all() for t in (product, conv, attention)):
            return False, f'{half} kernels produced non-finite values'
        return True, f'float32 and {half} kernels ran in {(time.perf_counter() - start) * 1000:.0f} ms'
    except Exception as error:  # Any kernel failure means this GPU is unusable here.
        return False, f'{type(error).__name__}: {str(error).splitlines()[0][:240]}'


def package_versions():
    names = ('torch', 'torchvision', 'transformers', 'accelerate', 'huggingface_hub', 'fastapi', 'timm', 'bitsandbytes')
    versions = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def models_status():
    from services import models as tool_models
    from services.sam3_server import transformers_files_ready, transformers_model_path
    from services.vision.models import qwen_registry, qwen_variant_id
    from services.vision.runtime import VisionRuntime
    from services.vision.ocr import ocr_status
    runtime = VisionRuntime()
    active = qwen_variant_id()
    qwen = runtime.profile('qwen')
    florence = runtime.profile('florence')
    keys = ('ready', 'installed', 'device', 'deviceName', 'dtype', 'quantization', 'message', 'warning')
    variants = {}
    from services.vision.models import hf_snapshot
    for name, variant in qwen_registry()['variants'].items():
        variants[name] = {'label': variant['label'], 'weightsGB': variant['weightsGB'],
                          'downloaded': (hf_snapshot(variant['repo'], variant['revision']) / 'config.json').is_file(),
                          'active': name == active,
                          'recommended': variant.get('quantizedCudaBudget', variant['budgets']['cuda'])['recommended']}
    sam = select_device(requested_device('BANNERFLOW_SAM3_DEVICE'), minimum_gib=6)
    tools = select_device(requested_device('BANNERFLOW_TOOLS_DEVICE'), minimum_gib=4)
    return {
        'qwen': {'variant': active, **{k: qwen.get(k) for k in keys}, 'variants': variants},
        'florence': {k: florence.get(k) for k in keys},
        'sam3': {'downloaded': transformers_files_ready(transformers_model_path()), 'device': sam.get('deviceName'),
                 'message': sam.get('message')},
        'imageTools': {'birefnet': tool_models.birefnet_ready(),
                       **{key: tool_models.file_ready(key) for key in tool_models.FILES}, 'device': tools.get('deviceName')},
        'ocr': {k: v for k, v in ocr_status().items() if k in ('ready', 'message', 'version')},
        'ffmpeg': bool(shutil.which('ffmpeg') and shutil.which('ffprobe')),
    }


def report():
    hardware = hardware_status()
    for gpu in hardware['cuda']:
        if gpu['kernels']:
            gpu['smoke'], gpu['smokeDetail'] = gpu_smoke(gpu['index'], 'bfloat16' if gpu['bfloat16'] else 'float16')
        else:
            gpu['smoke'], gpu['smokeDetail'] = False, 'skipped: no kernels for this GPU in the installed build'
    try:
        model_report = models_status()
    except Exception as error:
        model_report = {'error': f'{type(error).__name__}: {error}'}
    return {
        'python': {'version': platform.python_version(), 'executable': sys.executable},
        'platform': f'{platform.system()} {platform.release()} {platform.machine()}',
        'packages': package_versions(),
        'hardware': hardware,
        'deviceSetting': requested_device(),
        'models': model_report,
    }


def mark(ok):
    return 'OK  ' if ok else 'FAIL'


def print_human(data):
    hw = data['hardware']
    print(f"Python {data['python']['version']} ({data['python']['executable']})")
    print(f"Platform {data['platform']}")
    print(f"RAM {hw['memory']['totalGB']} GB total, {hw['memory']['availableGB']} GB available")
    packages = data['packages']
    build = f"CUDA {hw['cudaRuntime']}" if hw.get('cudaRuntime') else f"ROCm {hw['hip']}" if hw.get('hip') else 'CPU only'
    print(f"PyTorch {packages['torch'] or 'not installed'} ({build}); Transformers {packages['transformers'] or 'not installed'}")
    if hw.get('error'):
        print(f"  Problem: {hw['error']}")
    if hw.get('archList'):
        print(f"  GPU kernels in this build: {', '.join(hw['archList'])}")
    for gpu in hw['cuda']:
        print(f"{mark(gpu['smoke'])} GPU {gpu['index']}: {gpu['name']} (compute {gpu['capability']}, {gpu['totalGiB']} GiB"
              f"{', ' + str(gpu['freeGiB']) + ' GiB free' if gpu['freeGiB'] is not None else ''}) - {gpu['smokeDetail']}")
    if not hw['cuda']:
        print('No GPU visible to PyTorch; models run on the CPU.')
    models = data['models']
    if 'error' in models:
        print(f"Model checks failed: {models['error']}")
        return
    print(f"\nDevice setting: {data['deviceSetting']} (BANNERFLOW_DEVICE)")
    qwen = models['qwen']
    where = f"on {qwen['deviceName']} ({qwen['dtype']})" if qwen.get('device') else ''
    precision = 'NF4 4-bit weights' if qwen.get('quantization') else 'full weights'
    print(f"{mark(qwen['ready'])} Qwen planner [{qwen['variant']}, {precision}] {where} {qwen.get('message') or ''}".rstrip())
    if qwen.get('warning'):
        print(f"     Note: {qwen['warning']}")
    for name, variant in qwen['variants'].items():
        state = 'downloaded' if variant['downloaded'] else 'not downloaded'
        print(f"     {'*' if variant['active'] else ' '} {name}: {variant['label']}, {variant['weightsGB']} GB, {state}; needs {variant['recommended']}")
    florence = models['florence']
    where = f"on {florence['deviceName']} ({florence['dtype']})" if florence.get('device') else ''
    print(f"{mark(florence['ready'])} Florence-2 subject boxes / image analysis {where} {florence.get('message') or ''}".rstrip())
    sam = models['sam3']
    print(f"{'OK  ' if sam['downloaded'] else 'SKIP'} Optional SAM 3 precision: {'weights installed' if sam['downloaded'] else 'not installed; Florence-2 / BiRefNet work without it'}"
          f"{', runs on ' + sam['device'] if sam.get('device') else ''}")
    tools = models['imageTools']
    names = ', '.join(f"{key} {'yes' if tools[key] else 'no'}" for key in tools if key != 'device')
    print(f"{mark(all(v for k, v in tools.items() if k != 'device'))} Image tools ({names}){', runs on ' + tools['device'] if tools.get('device') else ''}")
    ocr = models['ocr']
    print(f"{mark(ocr['ready'])} PaddleOCR text reading (PP-OCRv6 via RapidOCR {ocr.get('version') or ''}), runs on CPU {ocr.get('message') or ''}".rstrip())
    print(f"{mark(models['ffmpeg'])} FFmpeg video sampling")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--json', action='store_true')
    parser.add_argument('--expect-gpu', choices=('auto', 'yes', 'no'), default='auto',
                        help='yes: exit 2 unless at least one GPU passes the kernel check')
    args = parser.parse_args()
    data = report()
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        print_human(data)
    if data['packages']['torch'] is None:
        sys.exit(1)
    expect = args.expect_gpu == 'yes' or (args.expect_gpu == 'auto' and shutil.which('nvidia-smi'))
    if expect and not any(gpu.get('smoke') for gpu in data['hardware']['cuda']):
        print('\nAn NVIDIA GPU is present but no GPU passed the kernel check. Run "npm run ai:setup" '
              '(it selects a matching PyTorch build), or set BANNERFLOW_DEVICE=cpu to use the CPU on purpose.',
              file=sys.stderr)
        sys.exit(2)


if __name__ == '__main__':
    # Windows consoles may use a legacy code page; never crash on a model message.
    sys.stdout.reconfigure(errors='replace')
    main()
