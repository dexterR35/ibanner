"""Discard retired model tensors without creating a second copy in CPU RAM."""
import gc
import sys


def discard_model(model):
    if model is None or not hasattr(model, 'modules'):
        return
    # Drop storage even if a generation/dispatch hook still references the module.
    # This also handles bitsandbytes Params4bit, which cannot always move to meta.
    for module in model.modules():
        try:
            module._parameters.clear()
            module._buffers.clear()
        except (AttributeError, RuntimeError, NotImplementedError):
            try:
                module.to_empty(device='meta', recurse=False)
            except (AttributeError, RuntimeError, NotImplementedError):
                pass
        if hasattr(module, 'quant_state'):
            module.quant_state = None
        if hasattr(module, '_cache'):
            module._cache = None


def clear_device_cache():
    gc.collect()
    torch = sys.modules.get('torch')
    if not torch:
        return
    try:
        if torch.cuda.is_available():
            for device in range(torch.cuda.device_count()):
                with torch.cuda.device(device):
                    torch.cuda.synchronize()
                    torch.cuda.empty_cache()
        if hasattr(torch, 'mps') and torch.backends.mps.is_available():
            torch.mps.empty_cache()
    except (RuntimeError, AssertionError):
        pass
