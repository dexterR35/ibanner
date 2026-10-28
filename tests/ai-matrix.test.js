import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TORCH_CHANNELS,
  channelById,
  choosePython,
  chooseTorchChannel,
  indexUrl,
  parseNvidiaSmi,
  torchPins,
} from '../scripts/ai-matrix.js';

const gpu = (name, compute, memoryMiB = 16311) => ({
  index: 0,
  name,
  compute,
  memoryMiB,
  driver: 'x',
});

test('nvidia-smi parsing handles old and new CUDA version headers', () => {
  const query =
    '0, NVIDIA GeForce RTX 5060 Ti, 12.0, 16311, 617.42\n1, Tesla P4, 6.1, 7680, 617.42\n';
  const modern = parseNvidiaSmi(
    '| NVIDIA-SMI 617.42   KMD Version: 617.42   CUDA UMD Version: 13.4 |',
    query,
  );
  assert.equal(modern.driverCuda, '13.4');
  assert.deepEqual(
    modern.gpus.map((g) => [g.name, g.compute]),
    [
      ['NVIDIA GeForce RTX 5060 Ti', 12],
      ['Tesla P4', 6.1],
    ],
  );
  assert.equal(
    parseNvidiaSmi('| Driver Version: 560.94   CUDA Version: 12.6 |', '').driverCuda,
    '12.6',
  );
  assert.deepEqual(parseNvidiaSmi('', '[Not Supported]').gpus, []);
});

test('Blackwell cards get a channel with sm_120 kernels, never cu126', () => {
  const card = gpu('NVIDIA GeForce RTX 5060 Ti', 12.0);
  const latest = chooseTorchChannel({
    platform: 'win32',
    python: '3.13',
    gpus: [card],
    driverCuda: '13.4',
  });
  assert.equal(latest.channel.id, 'cu130');
  const olderDriver = chooseTorchChannel({
    platform: 'linux',
    python: '3.12',
    gpus: [card],
    driverCuda: '12.9',
  });
  assert.equal(olderDriver.channel.id, 'cu128');
  const tooOld = chooseTorchChannel({
    platform: 'win32',
    python: '3.13',
    gpus: [card],
    driverCuda: '12.6',
  });
  assert.equal(tooOld.channel.id, 'cpu');
  assert.match(tooOld.warnings[0], /driver supporting CUDA 12\.8/);
});

test('older GPUs and drivers fall back to channels that still ship their kernels', () => {
  const pascal = gpu('GeForce GTX 1080', 6.1, 8192);
  assert.equal(
    chooseTorchChannel({ platform: 'win32', python: '3.13', gpus: [pascal], driverCuda: '13.0' })
      .channel.id,
    'cu126',
  );
  const ada = gpu('RTX 4090', 8.9, 24564);
  assert.equal(
    chooseTorchChannel({ platform: 'linux', python: '3.11', gpus: [ada], driverCuda: '12.6' })
      .channel.id,
    'cu126',
  );
  assert.equal(
    chooseTorchChannel({ platform: 'linux', python: '3.11', gpus: [ada], driverCuda: '13.1' })
      .channel.id,
    'cu130',
  );
});

test('the largest GPU decides the channel', () => {
  const small = { ...gpu('GTX 1050', 6.1, 4096), index: 0 };
  const large = { ...gpu('RTX 5090', 12.0, 32607), index: 1 };
  const choice = chooseTorchChannel({
    platform: 'linux',
    python: '3.13',
    gpus: [small, large],
    driverCuda: '13.0',
  });
  assert.equal(choice.gpu.name, 'RTX 5090');
  assert.equal(choice.channel.id, 'cu130');
});

test('machines without NVIDIA GPUs and macOS get CPU builds', () => {
  assert.equal(chooseTorchChannel({ platform: 'linux', python: '3.12' }).channel.id, 'cpu');
  assert.equal(chooseTorchChannel({ platform: 'win32', python: '3.13' }).channel.id, 'cpu');
  const mac = chooseTorchChannel({ platform: 'darwin', python: '3.13' });
  assert.equal(mac.channel.id, 'pypi');
  assert.equal(indexUrl(mac.channel), null);
  assert.equal(torchPins(mac.channel).torch, 'torch==2.14.1');
});

test('explicit channels are honoured but checked', () => {
  const card = gpu('RTX 5060 Ti', 12.0);
  const forced = chooseTorchChannel({
    platform: 'win32',
    python: '3.13',
    gpus: [card],
    driverCuda: '13.4',
    requested: 'cu126',
  });
  assert.equal(forced.channel.id, 'cu126');
  assert.match(forced.warnings.join(' '), /no kernels/);
  assert.match(
    chooseTorchChannel({ platform: 'win32', python: '3.13', requested: 'rocm7.2' }).error,
    /no wheels/,
  );
  assert.match(
    chooseTorchChannel({ platform: 'linux', python: '3.13', requested: 'cu999' }).error,
    /Unknown/,
  );
  assert.match(
    chooseTorchChannel({ platform: 'linux', python: '3.12', requested: 'cu132' }).error,
    /no wheels/,
  );
});

test('pins carry the build label so pip cannot substitute another build', () => {
  assert.deepEqual(torchPins(channelById('cu130')), {
    torch: 'torch==2.14.1+cu130',
    torchvision: 'torchvision==0.29.1+cu130',
  });
  assert.equal(indexUrl(channelById('cu128')), 'https://download.pytorch.org/whl/cu128');
  for (const channel of TORCH_CHANNELS)
    assert.ok(channel.python.length && channel.platforms.length, channel.id);
});

test('Python preference avoids versions without wheels', () => {
  const found = [
    { version: '3.15', executable: 'py315' },
    { version: '3.12', executable: 'py312' },
    { version: '3.13', executable: 'py313' },
  ];
  assert.equal(choosePython(found).executable, 'py313');
  assert.equal(choosePython([{ version: '3.15', executable: 'py315' }]), null);
  assert.equal(choosePython([{ version: '3.9', executable: 'py39' }]), null);
});
