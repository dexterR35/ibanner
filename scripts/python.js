import { spawn } from 'node:child_process';
import { python, projectRoot } from './python-runtime.js';

const child = spawn(python, process.argv.slice(2), { cwd: projectRoot, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
