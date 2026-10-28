import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localSubjectProxy, subjectProxy } from './services/local-subject-proxy.js';
export default defineConfig({
  plugins: [react(), localSubjectProxy()],
  server: { port: 5178, strictPort: true, proxy: subjectProxy },
  preview: { proxy: subjectProxy },
});
