/**
 * One command to prepare the optional local AI service on any machine.
 *
 *   npm run ai:setup                 detect GPU, create .venv-sam3, install, verify
 *   npm run ai:setup -- --dry-run    show the plan only
 *   npm run ai:setup -- --torch cu128 | cu126 | cpu | rocm7.2 ...
 *   npm run ai:setup -- --python <path-to-python>
 *   npm run ai:setup -- --reinstall-torch
 *
 * Model weights are not downloaded here; see `qwen:download` and `florence:download`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PYTHON_PREFERENCE,
  TORCH_CHANNELS,
  chooseTorchChannel,
  choosePython,
  indexUrl,
  parseNvidiaSmi,
  torchPins,
} from './ai-matrix.js';
import { projectRoot, venvDir, venvPython } from './python-runtime.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const dryRun = flag('--dry-run');
const windows = process.platform === 'win32';

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
  });
  return result.status === 0 ? result.stdout : null;
}

function run(command, commandArgs) {
  console.log(`\n> ${[command, ...commandArgs].join(' ')}`);
  if (dryRun) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: projectRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code ? reject(new Error(`${command} exited with ${code}`)) : resolve(),
    );
  });
}

function probePython(command, prefix = []) {
  const out = capture(command, [
    ...prefix,
    '-c',
    'import sys,json;print(json.dumps([sys.executable,"%d.%d"%sys.version_info[:2]]))',
  ]);
  if (!out) return null;
  try {
    const [executable, version] = JSON.parse(out.trim().split(/\r?\n/).pop());
    return { executable, version };
  } catch {
    return null;
  }
}

function findPythons() {
  const explicit = option('--python') || process.env.BANNERFLOW_SETUP_PYTHON;
  if (explicit) {
    const found = probePython(explicit);
    return found ? [found] : [];
  }
  const found = [];
  for (const version of PYTHON_PREFERENCE) {
    const candidate = windows
      ? probePython('py', [`-${version}`])
      : probePython(`python${version}`);
    if (candidate) found.push(candidate);
  }
  const fallback = probePython(windows ? 'python' : 'python3');
  if (fallback) found.push(fallback);
  return found;
}

function detectGpus() {
  const summary = capture('nvidia-smi', []);
  if (!summary) return { driverCuda: null, gpus: [] };
  const query = capture('nvidia-smi', [
    '--query-gpu=index,name,compute_cap,memory.total,driver_version',
    '--format=csv,noheader,nounits',
  ]);
  return parseNvidiaSmi(summary, query || '');
}

function installedTorch(python) {
  const out = capture(python, ['-c', 'import torch;print(torch.__version__)']);
  return out ? out.trim() : null;
}

async function main() {
  console.log('Bannerflow local AI setup\n');
  const { driverCuda, gpus } = detectGpus();
  if (gpus.length)
    for (const gpu of gpus)
      console.log(
        `GPU ${gpu.index}: ${gpu.name}, compute ${gpu.compute.toFixed(1)}, ${Math.round(gpu.memoryMiB / 1024)} GB, driver ${gpu.driver}`,
      );
  else console.log('No NVIDIA GPU detected (nvidia-smi not found or no devices).');
  if (driverCuda) console.log(`Driver supports CUDA up to ${driverCuda}`);

  let python;
  const venvExists = existsSync(venvPython);
  if (venvExists && !flag('--recreate')) {
    python = probePython(venvPython);
    if (!python)
      throw new Error(`${venvDir} exists but its Python does not start. Rerun with --recreate.`);
    if (!PYTHON_PREFERENCE.includes(python.version))
      throw new Error(
        `${venvDir} uses Python ${python.version}; supported: ${PYTHON_PREFERENCE.join(', ')}. Rerun with --recreate.`,
      );
    console.log(`Reusing ${venvDir} (Python ${python.version})`);
  } else {
    const candidates = findPythons();
    python = choosePython(candidates);
    if (!python) {
      const seen = candidates.map((c) => c.version).join(', ') || 'none';
      throw new Error(
        `No supported Python found (found: ${seen}; need one of ${PYTHON_PREFERENCE.join(', ')}). ` +
          (windows
            ? 'Install one with "py install 3.13" (Python install manager) or from python.org.'
            : 'Install python3.13 or python3.12 with your package manager, or use "uv python install 3.13".'),
      );
    }
    console.log(`Using Python ${python.version} at ${python.executable}`);
  }

  const choice = chooseTorchChannel({
    platform: process.platform,
    python: python.version,
    gpus,
    driverCuda,
    requested: option('--torch') || process.env.BANNERFLOW_TORCH_CHANNEL,
  });
  if (choice.error) throw new Error(choice.error);
  for (const warning of choice.warnings) console.warn(`Warning: ${warning}`);
  const { channel } = choice;
  const pins = torchPins(channel);
  console.log(`PyTorch: ${pins.torch} (${channel.id}; ${choice.reason})`);
  if (dryRun)
    console.log(
      `Other channels: ${TORCH_CHANNELS.filter((c) => c !== channel)
        .map((c) => c.id)
        .join(', ')}`,
    );

  if (!venvExists || flag('--recreate')) {
    if (venvExists && !dryRun) rmSync(venvDir, { recursive: true, force: true });
    await run(python.executable, ['-m', 'venv', venvDir]);
  }
  await run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);

  const expected = pins.torch.split('==')[1];
  const current = dryRun ? null : installedTorch(venvPython);
  if (current === expected && !flag('--reinstall-torch'))
    console.log(`\nPyTorch ${current} already installed.`);
  else {
    // A different build label (+cpu, +cu126, ...) is a different version, so pip replaces it.
    const url = indexUrl(channel);
    await run(venvPython, [
      '-m',
      'pip',
      'install',
      ...(current === expected ? ['--force-reinstall', '--no-deps'] : []),
      pins.torch,
      pins.torchvision,
      ...(url ? ['--index-url', url] : []),
    ]);
  }

  // Constrain torch so no later requirement can swap in a different build.
  const folder = mkdtempSync(join(tmpdir(), 'bannerflow-'));
  const constraints = join(folder, 'torch-constraints.txt');
  writeFileSync(constraints, `${pins.torch}\n${pins.torchvision}\n`);
  try {
    await run(venvPython, [
      '-m',
      'pip',
      'install',
      '-r',
      'services/requirements-tools.txt',
      '-c',
      constraints,
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }

  if (dryRun) return;
  console.log('\nVerifying the runtime on this machine…');
  const doctor = spawnSync(
    venvPython,
    ['-m', 'services.ai_doctor', '--expect-gpu', gpus.length ? 'yes' : 'no'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
    },
  );
  if (doctor.status) {
    process.exitCode = doctor.status;
    return;
  }
  console.log(
    '\nNext, for anything marked FAIL above: npm run florence:download, npm run qwen:download, ' +
      'then npm run qwen:smoke. Start the app with npm run dev.',
  );
}

main().catch((error) => {
  console.error(`\nSetup stopped: ${error.message}`);
  process.exitCode = 1;
});
