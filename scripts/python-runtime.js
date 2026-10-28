import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';

// Per-machine settings (device, Qwen variant, model cache) live in a gitignored .env.
// Variables already set in the shell take precedence. See .env.example.
const localEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

export const venvDir = fileURLToPath(new URL('../.venv-sam3', import.meta.url));
export const venvPython = fileURLToPath(
  new URL(
    windows ? '../.venv-sam3/Scripts/python.exe' : '../.venv-sam3/bin/python',
    import.meta.url,
  ),
);
export const python =
  process.env.BANNERFLOW_PYTHON ||
  (existsSync(venvPython) ? venvPython : windows ? 'python' : 'python3');
