/** Automatic port recovery is only for a direct, local desktop session.
 * Hosted URLs and OAuth callbacks have fixed addresses and must not move.
 */
export function allowsLocalPortFallback(config) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(config.host) ||
      config.authMode === 'oauth' || config.nodeEnv === 'production') return false;
  try {
    const url = new URL(config.publicBaseUrl);
    return url.protocol === 'http:' &&
      url.hostname.replace(/^\[|\]$/g, '') === config.host &&
      Number(url.port || 80) === config.port && url.pathname === '/' &&
      !url.search && !url.hash && !url.username && !url.password;
  } catch { return false; }
}

export function listenWithLocalFallback(server, config, { onFallback = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let retried = false;
    const onError = (error) => {
      if (!retried && error.code === 'EADDRINUSE' && allowsLocalPortFallback(config)) {
        retried = true;
        onFallback();
        server.listen(0, config.host);
        return;
      }
      server.removeListener('listening', onListening);
      server.removeListener('error', onError);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address());
    };
    server.once('listening', onListening);
    server.on('error', onError);
    server.listen(config.port, config.host);
  });
}
