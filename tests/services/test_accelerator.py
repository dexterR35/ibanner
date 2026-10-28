"""Device choice must never pick a GPU the installed PyTorch build cannot run."""
import os
import unittest
from unittest.mock import patch

from services.accelerator import cuda_kernels_for, parse_arch, pick_gpu, requested_device, select_device

CU130 = ['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120']
CU126 = ['sm_50', 'sm_60', 'sm_70', 'sm_75', 'sm_80', 'sm_86', 'sm_90']


def gpu(index, name, total, kernels=True, capability='12.0'):
    return {'index': index, 'name': name, 'capability': capability, 'totalGiB': total,
            'freeGiB': total - 1, 'bfloat16': True, 'kernels': kernels}


class ArchitectureTests(unittest.TestCase):
    def test_parse_arch(self):
        self.assertEqual(parse_arch('sm_120'), ('sm', 12, 0, ''))
        self.assertEqual(parse_arch('sm_86'), ('sm', 8, 6, ''))
        self.assertEqual(parse_arch('compute_90'), ('compute', 9, 0, ''))
        self.assertEqual(parse_arch('sm_90a'), ('sm', 9, 0, 'a'))
        self.assertIsNone(parse_arch('gfx1100'))

    def test_blackwell_needs_sm_120_or_ptx(self):
        self.assertTrue(cuda_kernels_for((12, 0), CU130))
        self.assertFalse(cuda_kernels_for((12, 0), CU126))
        self.assertTrue(cuda_kernels_for((12, 0), CU126 + ['compute_90']))
        self.assertTrue(cuda_kernels_for((12, 1), ['sm_120']))

    def test_same_major_binaries_and_exact_arch_specific_kernels(self):
        self.assertTrue(cuda_kernels_for((8, 9), ['sm_80', 'sm_86']))
        self.assertFalse(cuda_kernels_for((8, 0), ['sm_86']))
        self.assertFalse(cuda_kernels_for((6, 1), CU130))
        self.assertTrue(cuda_kernels_for((9, 0), ['sm_90a']))
        self.assertFalse(cuda_kernels_for((10, 0), ['sm_90a']))


class SelectionTests(unittest.TestCase):
    def hardware(self, *devices):
        return {'memory': {'totalGB': 32, 'availableGB': 20}, 'cuda': list(devices), 'torch': '2.14.1+cu126',
                'cudaRuntime': '12.6', 'archList': CU126, 'error': None}

    def test_auto_skips_gpu_without_kernels_and_says_why(self):
        hardware = self.hardware(gpu(0, 'RTX 5060 Ti', 15.9, kernels=False))
        chosen, message = pick_gpu(hardware, 'auto', 4)
        self.assertIsNone(chosen)
        self.assertIn('no kernels', message)
        self.assertIn('ai:setup', message)
        selection = select_device('auto', 4, hardware)
        self.assertTrue(selection['ready'])
        self.assertEqual(selection['device'], 'cpu')
        self.assertIn('no kernels', selection['warning'])

    def test_explicit_cuda_never_falls_back(self):
        hardware = self.hardware(gpu(0, 'RTX 5060 Ti', 15.9, kernels=False))
        self.assertFalse(select_device('cuda', 4, hardware)['ready'])
        self.assertFalse(select_device('cuda:3', 0, self.hardware(gpu(0, 'GPU', 16)))['ready'])
        self.assertFalse(select_device('gpu', 0, self.hardware())['ready'])

    def test_largest_compatible_gpu_that_fits_wins(self):
        hardware = self.hardware(gpu(0, 'Small', 6), gpu(1, 'Large', 24), gpu(2, 'Broken', 48, kernels=False))
        self.assertEqual(select_device('auto', 4, hardware)['device'], 'cuda:1')
        self.assertEqual(select_device('cuda:0', 4, hardware)['device'], 'cuda:0')
        self.assertEqual(select_device('cpu', 4, hardware)['device'], 'cpu')
        too_small, message = pick_gpu(self.hardware(gpu(0, 'Small', 6)), 'auto', 22)
        self.assertIsNone(too_small)
        self.assertIn('needs 22 GiB', message)

    def test_missing_torch_is_not_reported_as_cpu(self):
        hardware = {'memory': {}, 'cuda': [], 'torch': None, 'error': 'No module named torch'}
        self.assertFalse(select_device('auto', 0, hardware)['ready'])

    def test_per_model_setting_then_global_then_auto(self):
        with patch.dict(os.environ, {'BANNERFLOW_DEVICE': 'cpu', 'BANNERFLOW_QWEN_DEVICE': 'cuda:1'}):
            self.assertEqual(requested_device('BANNERFLOW_QWEN_DEVICE'), 'cuda:1')
            self.assertEqual(requested_device('BANNERFLOW_SAM3_DEVICE'), 'cpu')
        with patch.dict(os.environ, {'BANNERFLOW_DEVICE': '', 'BANNERFLOW_QWEN_DEVICE': ''}):
            self.assertEqual(requested_device('BANNERFLOW_QWEN_DEVICE'), 'auto')


if __name__ == '__main__':
    unittest.main()
