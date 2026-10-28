/** Do not expose the loopback-only model service through Vite's LAN listener. */
export function localSubjectProxy() {
  const configure = (server) => {
    server.middlewares.use('/api/subjects', (request, response, next) => {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
        response.statusCode = 403;
        response.end('Subject service is available on localhost only.');
        return;
      }
      next();
    });
  };
  return {
    name: 'local-subject-service',
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
export const subjectProxy = {
  '/api/subjects': {
    target: 'http://127.0.0.1:5181',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/subjects/, ''),
  },
};
