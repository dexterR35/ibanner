import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { python } from './python-runtime.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
};
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => {
  for (const child of children) child.kill('SIGTERM');
});

let connected = false;
try {
  const response = await fetch('http://127.0.0.1:5181/health', {
    signal: AbortSignal.timeout(4000),
  });
  const health = await response.json();
  connected = health.service === 'bannerflow-sam3' && health.schemaVersion === 1;
} catch {
  /* Rendering and manual focus work without the optional local AI service. */
}

if (!connected && !stopping) {
  const bridge = spawn(python, ['-m', 'services.sam3_server'], {
    cwd: root,
    stdio: 'inherit',
  });
  children.push(bridge);
  bridge.on('error', () =>
    console.warn('Local image analysis service could not start. Manual subject focus remains available.'),
  );
  bridge.on('exit', (code) => {
    if (!stopping && code)
      console.warn(
        'Local image analysis service unavailable. See services/README.md; manual subject focus remains available.',
      );
  });
}
if (!stopping) {
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  children.push(vite);
  vite.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  vite.on('exit', (code) => stop(code ?? 0));
}
