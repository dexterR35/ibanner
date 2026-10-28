"""Pinned local discovery. HTTP inference never downloads model weights."""
import json
import os
import re
from functools import lru_cache
from pathlib import Path

from services.accelerator import hardware_status, memory_status, pick_gpu  # noqa: F401 (re-exported)

REGISTRY_FILE = Path(__file__).with_name('qwen-models.json')
# Only these Transformers classes may be named by the registry.
QWEN_LOADERS = {'Qwen3VLForConditionalGeneration'}
FLORENCE_REPO = 'florence-community/Florence-2-base-ft'
FLORENCE_REVISION = '0b03b6f15a4a211370fb204aee4e7dd48887ea37'


@lru_cache(maxsize=1)
def qwen_registry():
    data = json.loads(REGISTRY_FILE.read_text(encoding='utf-8'))
    for name, variant in data['variants'].items():
        if variant['loader'] not in QWEN_LOADERS:
            raise ValueError(f'{name}: loader {variant["loader"]} is not allowed')
        if not re.fullmatch(r'[a-f0-9]{40}', variant['revision']):
            raise ValueError(f'{name}: revision must be a 40-character commit hash')
    if data['default'] not in data['variants']:
        raise ValueError('Default Qwen variant is not registered')
    return data


def qwen_variant_id():
    return os.environ.get('BANNERFLOW_QWEN_VARIANT', '').strip() or qwen_registry()['default']


def qwen_variant(variant_id=None):
    """The selected registry entry, with its id. Unknown ids raise ValueError."""
    variant_id = variant_id or qwen_variant_id()
    variants = qwen_registry()['variants']
    if variant_id not in variants:
        raise ValueError(f'Unknown BANNERFLOW_QWEN_VARIANT "{variant_id}". Choose one of: {", ".join(variants)}.')
    return {'id': variant_id, **variants[variant_id]}


_default = qwen_registry()['variants'][qwen_registry()['default']]
QWEN_REPO, QWEN_REVISION = _default['repo'], _default['revision']


def hf_snapshot(repo, revision):
    from huggingface_hub.constants import HF_HUB_CACHE
    return Path(HF_HUB_CACHE) / ('models--' + repo.replace('/', '--')) / 'snapshots' / revision


def model_location(name, variant_id=None):
    key = f'BANNERFLOW_{name.upper()}_MODEL'
    # An explicitly empty override disables a model, including in isolated tests.
    if key in os.environ and (name != 'qwen' or not variant_id or variant_id == qwen_variant_id()):
        return os.environ[key], os.environ.get(f'BANNERFLOW_{name.upper()}_REVISION', '')
    if name == 'qwen':
        try:
            variant = qwen_variant(variant_id)
        except ValueError:
            return None, ''
        repo, revision = variant['repo'], variant['revision']
    elif name == 'florence':
        repo, revision = FLORENCE_REPO, FLORENCE_REVISION
    else:
        return None, ''
    return str(hf_snapshot(repo, revision)), revision


def _requested_check(requested, requirements, label):
    if not re.fullmatch(r'auto|cpu|cuda(:\d+)?', requested or ''):
        return {'ready': False, 'requirements': requirements,
                'message': f'BANNERFLOW_{label}_DEVICE must be auto, cpu, cuda or cuda:N.'}
    return None


def select_qwen_profile(hardware, requested='auto', variant=None, precision=None):
    """Pure device selection, independently testable on a CPU-only machine."""
    variant = variant or qwen_variant()
    budgets = variant['budgets']
    precision = precision or os.environ.get('BANNERFLOW_QWEN_PRECISION', 'auto').strip().lower()
    if precision not in {'auto', 'nf4', 'bf16'}:
        return {'ready': False, 'message': 'BANNERFLOW_QWEN_PRECISION must be auto, nf4 or bf16.'}
    quantized = variant.get('quantizedCudaBudget')
    invalid = _requested_check(requested, budgets['cuda'], 'QWEN')
    if invalid:
        return invalid
    if hardware.get('error'):
        return {'ready': False, 'message': 'Install a compatible PyTorch runtime: ' + hardware['error']}
    gpu, gpu_message = pick_gpu(hardware, requested, budgets['cuda']['minimumVRAMGiB'])
    quantization = None
    if quantized and precision != 'bf16' and (gpu is None or precision == 'nf4'):
        gpu, gpu_message = pick_gpu(hardware, requested, quantized['minimumVRAMGiB'])
        if gpu is not None:
            quantization = 'nf4'
    if requested.startswith('cuda') and gpu is None:
        return {'ready': False, 'requirements': budgets['cuda'],
                'message': f"{variant['label']} on CUDA needs {budgets['cuda']['recommended']}. {gpu_message or ''}".strip()}
    kind = 'cuda' if gpu is not None else 'cpu'
    if precision == 'nf4' and not quantization:
        return {'ready': False, 'requirements': quantized,
                'message': 'NF4 Qwen loading requires a compatible CUDA GPU. Use auto or bf16 for CPU execution.'}
    limits = quantized if quantization else budgets[kind]
    ready = (hardware['memory']['totalGB'] or 0) >= limits['minimumRAMGiB']
    return {'ready': ready, 'device': f"cuda:{gpu['index']}" if gpu else 'cpu',
            'deviceName': gpu['name'] if gpu else 'CPU',
            'dtype': ('bfloat16' if gpu['bfloat16'] else 'float16') if gpu else 'float32',
            'requirements': limits, 'gpu': gpu, 'variant': variant['id'], 'quantization': quantization, 'warning': gpu_message,
            'message': None if ready else f"{variant['label']} is installed; this machine does not meet the {kind.upper()} profile. Required: {limits['recommended']}. CUDA is selected automatically when a suitable GPU is available."}


def select_florence_profile(hardware, requested='auto'):
    """Conservative application budget for one bounded Florence-2-base-ft image."""
    requirements = {'minimumRAMGiB': 8, 'availableRAMGiB': 2,
                    'minimumVRAMGiB': 4, 'availableVRAMGiB': 2}
    invalid = _requested_check(requested, requirements, 'FLORENCE')
    if invalid:
        return invalid
    if hardware.get('error'):
        return {'ready': False, 'requirements': requirements,
                'message': 'Install a compatible PyTorch runtime: ' + hardware['error']}
    gpu, gpu_message = pick_gpu(hardware, requested, requirements['minimumVRAMGiB'])
    if requested.startswith('cuda') and gpu is None:
        return {'ready': False, 'requirements': requirements,
                'message': ('Florence CUDA needs a GPU with at least 4 GiB VRAM and CUDA-enabled PyTorch. ' + (gpu_message or '')).strip()}
    ready = (hardware['memory']['totalGB'] or 0) >= requirements['minimumRAMGiB']
    return {'ready': ready, 'device': f"cuda:{gpu['index']}" if gpu else 'cpu',
            'deviceName': gpu['name'] if gpu else 'CPU',
            'dtype': ('bfloat16' if gpu['bfloat16'] else 'float16') if gpu else 'float32',
            'requirements': requirements, 'gpu': gpu, 'warning': gpu_message,
            'message': None if ready else 'Florence-2-base-ft needs at least 8 GiB physical RAM.'}
