"""Shared hardware detection and device choice for every local model.

Device settings, most specific first:
  BANNERFLOW_<MODEL>_DEVICE  (QWEN, FLORENCE, SAM3, TOOLS)
  BANNERFLOW_DEVICE          (all models)
Values: auto (default), cpu, cuda, cuda:N. Auto picks the largest GPU that has
kernels in the installed PyTorch build and meets the model's budget, else CPU.
An explicit CUDA request never silently falls back to CPU.

The pure helpers take plain dicts so they can be tested without a GPU.
"""
import os
import re

DEVICE_VALUE = re.compile(r'auto|cpu|cuda(:\d+)?')
SETUP_HINT = 'Run "npm run ai:setup" to install a PyTorch build that matches this GPU.'


def memory_status():
    """Physical RAM (not swap)."""
    try:
        import psutil
        memory = psutil.virtual_memory()
        total, available = memory.total, memory.available
    except ImportError:
        try:
            total = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
            available = os.sysconf('SC_AVPHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
        except (ValueError, OSError, AttributeError):
            return {'totalGB': None, 'availableGB': None}
    return {'totalGB': round(total / 1024**3, 1), 'availableGB': round(available / 1024**3, 1)}


def parse_arch(entry):
    """'sm_120' -> ('sm', 12, 0, ''), 'compute_90' -> ('compute', 9, 0, ''), 'sm_90a' -> ('sm', 9, 0, 'a')."""
    match = re.fullmatch(r'(sm|compute)_(\d+)(\d)([af]?)', entry or '')
    return (match[1], int(match[2]), int(match[3]), match[4]) if match else None


def cuda_kernels_for(capability, arch_list):
    """Whether a PyTorch CUDA build can run on a device of this compute capability.

    Binary kernels (sm_XY) run on the same major version with an equal or newer
    minor version; 'a' variants only on exactly that device. PTX (compute_XY)
    can be compiled at load time for any equal or newer device.
    """
    major, minor = capability
    for entry in arch_list:
        parsed = parse_arch(entry)
        if not parsed:
            continue
        kind, arch_major, arch_minor, suffix = parsed
        if kind == 'compute' and (arch_major, arch_minor) <= (major, minor):
            return True
        if kind == 'sm' and suffix == 'a' and (arch_major, arch_minor) == (major, minor):
            return True
        if kind == 'sm' and suffix != 'a' and arch_major == major and arch_minor <= minor:
            return True
    return False


def hardware_status():
    """RAM plus every visible GPU. Creates a CUDA context but loads no model."""
    memory = memory_status()
    try:
        import torch
    except (ImportError, OSError) as error:
        return {'memory': memory, 'cuda': [], 'torch': None, 'cudaRuntime': None, 'hip': None,
                'archList': [], 'error': str(error)[:300]}
    hip = getattr(torch.version, 'hip', None)
    status = {'memory': memory, 'cuda': [], 'torch': torch.__version__, 'cudaRuntime': torch.version.cuda,
              'hip': hip, 'archList': [], 'error': None}
    try:
        if not torch.cuda.is_available():
            return status
        arch_list = list(torch.cuda.get_arch_list())
        status['archList'] = arch_list
        for index in range(torch.cuda.device_count()):
            props = torch.cuda.get_device_properties(index)
            if hip:
                arch = getattr(props, 'gcnArchName', '').split(':')[0]
                capability, kernels = arch, not arch_list or arch in arch_list
                bfloat16 = bool(torch.cuda.is_bf16_supported())
            else:
                capability = f'{props.major}.{props.minor}'
                kernels = cuda_kernels_for((props.major, props.minor), arch_list)
                # Native BF16 starts with Ampere (8.0); older GPUs only emulate it.
                bfloat16 = props.major >= 8
            free = None
            if kernels:
                with torch.cuda.device(index):
                    free, _ = torch.cuda.mem_get_info()
            status['cuda'].append({
                'index': index, 'name': props.name, 'capability': capability,
                'totalGiB': round(props.total_memory / 1024**3, 2),
                'freeGiB': round(free / 1024**3, 2) if free is not None else None,
                'bfloat16': bfloat16, 'kernels': kernels,
            })
    except (RuntimeError, AssertionError, OSError) as error:
        status['error'] = str(error)[:300]
    return status


def incompatible_message(gpu, hardware):
    build = f"CUDA {hardware.get('cudaRuntime')}" if hardware.get('cudaRuntime') else 'this PyTorch build'
    return (f"{gpu['name']} (compute {gpu.get('capability')}) has no kernels in PyTorch "
            f"{hardware.get('torch')} ({build}). {SETUP_HINT}")


def requested_device(*names):
    """First non-empty value among the per-model variables and BANNERFLOW_DEVICE."""
    for name in (*names, 'BANNERFLOW_DEVICE'):
        value = os.environ.get(name, '').strip().lower()
        if value:
            return value
    return 'auto'


def pick_gpu(hardware, requested='auto', minimum_gib=0):
    """Return (gpu or None, message or None).

    For 'auto', None means use the CPU; the message then explains why a present
    GPU was skipped. For explicit CUDA requests, None is an error.
    """
    if not DEVICE_VALUE.fullmatch(requested or ''):
        return None, 'Device must be auto, cpu, cuda or cuda:N.'
    if requested == 'cpu':
        return None, None
    devices = sorted(hardware.get('cuda') or [], key=lambda d: (d['totalGiB'], d.get('freeGiB') or 0), reverse=True)
    if requested.startswith('cuda:'):
        devices = [d for d in devices if d['index'] == int(requested.split(':')[1])]
    usable = [d for d in devices if d.get('kernels', True)]
    gpu = next((d for d in usable if d['totalGiB'] >= minimum_gib), None)
    if gpu:
        return gpu, None
    blocked = next((d for d in devices if not d.get('kernels', True)), None)
    if blocked:
        return None, incompatible_message(blocked, hardware)
    if usable:
        return None, f"{usable[0]['name']} has {usable[0]['totalGiB']} GiB; this model needs {minimum_gib} GiB of GPU memory."
    if requested.startswith('cuda'):
        return None, 'No CUDA GPU is visible to PyTorch. ' + SETUP_HINT
    return None, None


def select_device(requested='auto', minimum_gib=0, hardware=None):
    """Device for models without a detailed memory profile (SAM 3, image tools)."""
    hardware = hardware if hardware is not None else hardware_status()
    if hardware.get('torch') is None:
        return {'ready': False, 'device': None, 'deviceName': None, 'gpu': None,
                'message': 'PyTorch is not installed in the AI environment. ' + SETUP_HINT}
    gpu, message = pick_gpu(hardware, requested, minimum_gib)
    if gpu is None and requested.startswith('cuda'):
        return {'ready': False, 'device': None, 'deviceName': None, 'gpu': None, 'message': message}
    if not DEVICE_VALUE.fullmatch(requested or ''):
        return {'ready': False, 'device': None, 'deviceName': None, 'gpu': None, 'message': message}
    return {'ready': True, 'device': f"cuda:{gpu['index']}" if gpu else 'cpu',
            'deviceName': gpu['name'] if gpu else 'CPU', 'gpu': gpu, 'warning': message, 'message': None}
