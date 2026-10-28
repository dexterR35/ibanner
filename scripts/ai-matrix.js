/**
 * Which PyTorch build and Python interpreter suit a machine.
 *
 * This is data plus pure selection logic so it can be unit tested on any machine.
 * The choice is only a starting point: `npm run ai:doctor` runs a real kernel on
 * each GPU after installation and is the source of truth.
 */

/** Supported interpreters, most preferred first. Newer versions often lack wheels. */
export const PYTHON_PREFERENCE = ['3.13', '3.12', '3.14', '3.11', '3.10'];

const ALL_PYTHON = ['3.10', '3.11', '3.12', '3.13', '3.14'];
const LATEST = { torch: '2.14.1', torchvision: '0.29.1' };

/**
 * PyTorch wheel channels on download.pytorch.org.
 * - `cuda`: toolkit the wheels were built with; the NVIDIA driver must support at least this.
 * - `compute`: GPU compute capabilities the channel ships kernels for (major.minor).
 * - `auto`: whether automatic selection may pick it. Others are explicit `--torch` choices.
 */
export const TORCH_CHANNELS = [
  {
    id: 'cu132',
    kind: 'cuda',
    cuda: '13.2',
    ...LATEST,
    python: ['3.13', '3.14'],
    platforms: ['win32', 'linux'],
    compute: { min: 7.5, max: 12.9 },
    auto: false,
  },
  {
    id: 'cu130',
    kind: 'cuda',
    cuda: '13.0',
    ...LATEST,
    python: ALL_PYTHON,
    platforms: ['win32', 'linux'],
    // CUDA 13 removed Maxwell, Pascal and Volta. Includes Blackwell (sm_100, sm_120).
    compute: { min: 7.5, max: 12.9 },
    auto: true,
  },
  {
    id: 'cu128',
    kind: 'cuda',
    cuda: '12.8',
    torch: '2.11.0',
    torchvision: '0.26.0',
    python: ALL_PYTHON,
    platforms: ['win32', 'linux'],
    // First CUDA 12 channel with Blackwell kernels; for drivers older than CUDA 13.
    compute: { min: 7.0, max: 12.9 },
    auto: true,
  },
  {
    id: 'cu126',
    kind: 'cuda',
    cuda: '12.6',
    ...LATEST,
    python: ALL_PYTHON,
    platforms: ['win32', 'linux'],
    // Older GPUs. No Blackwell kernels: an RTX 50-series card fails at runtime here.
    compute: { min: 5.0, max: 9.0 },
    auto: true,
  },
  {
    id: 'rocm7.2',
    kind: 'rocm',
    ...LATEST,
    python: ALL_PYTHON,
    platforms: ['linux'],
    auto: false,
  },
  {
    id: 'cpu',
    kind: 'cpu',
    ...LATEST,
    python: ALL_PYTHON,
    platforms: ['win32', 'linux'],
    auto: true,
  },
  // macOS wheels come from PyPI. The services run on CPU there (MPS is not implemented).
  { id: 'pypi', kind: 'cpu', ...LATEST, python: ALL_PYTHON, platforms: ['darwin'], auto: true },
];

export const channelById = (id) => TORCH_CHANNELS.find((channel) => channel.id === id);

export function indexUrl(channel) {
  return channel.id === 'pypi' ? null : `https://download.pytorch.org/whl/${channel.id}`;
}

/** The exact versions pip should end up with, including the local build label. */
export function torchPins(channel) {
  const label = channel.id === 'pypi' ? '' : `+${channel.id}`;
  return {
    torch: `torch==${channel.torch}${label}`,
    torchvision: `torchvision==${channel.torchvision}${label}`,
  };
}

const versionNumber = (value) => {
  const [major = 0, minor = 0] = String(value).split('.').map(Number);
  return major * 100 + minor;
};

/** Parse `nvidia-smi` output: the CUDA version the driver supports and each GPU. */
export function parseNvidiaSmi(summary = '', query = '') {
  const match = summary.match(/CUDA (?:UMD )?Version:\s*([\d.]+)/i);
  const gpus = query
    .split(/\r?\n/)
    .map((line) => line.split(',').map((part) => part.trim()))
    .filter((parts) => parts.length >= 5 && /^\d+$/.test(parts[0]))
    .map(([index, name, compute, memory, driver]) => ({
      index: Number(index),
      name,
      compute: Number.parseFloat(compute),
      memoryMiB: Number.parseFloat(memory),
      driver,
    }))
    .filter((gpu) => Number.isFinite(gpu.compute));
  return { driverCuda: match ? match[1] : null, gpus };
}

/**
 * Pick a PyTorch channel. Returns `{ channel, reason, warnings, gpu }` or `{ error }`.
 * `requested` (from `--torch`) always wins but is still checked for compatibility.
 */
export function chooseTorchChannel({ platform, python, gpus = [], driverCuda = null, requested }) {
  const warnings = [];
  const gpu = [...gpus].sort((a, b) => b.memoryMiB - a.memoryMiB)[0] || null;
  const fits = (channel) =>
    channel.platforms.includes(platform) && (!python || channel.python.includes(python));
  const supportsGpu = (channel) =>
    gpu &&
    channel.compute &&
    gpu.compute >= channel.compute.min &&
    gpu.compute <= channel.compute.max;
  const driverOk = (channel) =>
    driverCuda && versionNumber(driverCuda) >= versionNumber(channel.cuda);

  if (requested) {
    const channel = channelById(requested);
    if (!channel)
      return {
        error: `Unknown PyTorch channel "${requested}". Use one of: ${TORCH_CHANNELS.map((c) => c.id).join(', ')}.`,
      };
    if (!fits(channel))
      return { error: `${channel.id} has no wheels for ${platform} with Python ${python}.` };
    if (channel.kind === 'cuda' && gpu && !supportsGpu(channel))
      warnings.push(`${channel.id} has no kernels for ${gpu.name} (compute ${gpu.compute}).`);
    if (channel.kind === 'cuda' && !driverOk(channel))
      warnings.push(`The NVIDIA driver does not report CUDA ${channel.cuda} support.`);
    return { channel, reason: 'requested with --torch', warnings, gpu };
  }

  if (platform === 'darwin')
    return { channel: channelById('pypi'), reason: 'macOS uses PyPI wheels', warnings, gpu: null };

  if (gpu) {
    const cuda = TORCH_CHANNELS.filter((c) => c.kind === 'cuda' && c.auto && fits(c));
    const channel = cuda.find((c) => supportsGpu(c) && driverOk(c));
    if (channel)
      return {
        channel,
        reason: `${gpu.name} (compute ${gpu.compute.toFixed(1)}) with driver CUDA ${driverCuda}`,
        warnings,
        gpu,
      };
    // Name the oldest CUDA version that would work: the smallest driver update.
    const wanted = cuda
      .filter(supportsGpu)
      .sort((a, b) => versionNumber(a.cuda) - versionNumber(b.cuda))[0];
    warnings.push(
      wanted
        ? `${gpu.name} needs an NVIDIA driver supporting CUDA ${wanted.cuda} or newer (found ${driverCuda || 'unknown'}). Update the driver, then rerun setup.`
        : `No PyTorch CUDA channel here supports ${gpu.name} (compute ${gpu.compute}).`,
    );
  }
  return {
    channel: channelById('cpu'),
    reason: gpu ? 'GPU not usable; CPU fallback' : 'no NVIDIA GPU detected',
    warnings,
    gpu,
  };
}

/** Pick the most preferred interpreter from `[{ version: '3.13', executable }]`. */
export function choosePython(candidates) {
  for (const version of PYTHON_PREFERENCE) {
    const found = candidates.find((candidate) => candidate.version === version);
    if (found) return found;
  }
  return null;
}
