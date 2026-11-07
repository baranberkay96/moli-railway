// Small requests from the gate to Moli on loopback: readiness probes and the
// current browser WebSocket path (Moli picks a new random id at every start).

import http from 'node:http';

const BROWSER_PATH_PATTERN = /^\/devtools\/browser\/[A-Za-z0-9-]{1,128}$/;
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Host header Moli accepts (it only allows IP literals and localhost).
 * @param {{ internalHost: string, internalPort: number }} config
 * @returns {string}
 */
export function upstreamHostHeader(config) {
  return `${config.internalHost}:${config.internalPort}`;
}

/**
 * GET a small resource from Moli.
 * @param {object} config
 * @param {string} path
 * @param {number} timeoutMs
 * @returns {Promise<{ status: number, body: Buffer }>}
 */
export function getFromMoli(config, path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: config.internalHost,
      port: config.internalPort,
      method: 'GET',
      path,
      agent: false,
      headers: { host: upstreamHostHeader(config), accept: 'application/json', connection: 'close' },
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timed out after ${timeoutMs} ms`)));
    req.on('error', reject);
    req.on('response', (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(new Error('response too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.end();
  });
}

/**
 * Path of Moli's browser-level CDP endpoint, e.g. /devtools/browser/<uuid>.
 * @param {object} config
 * @returns {Promise<string>}
 */
export async function fetchBrowserPath(config) {
  const { status, body } = await getFromMoli(config, '/json/version', 3000);
  if (status !== 200) throw new Error(`Moli /json/version returned HTTP ${status}`);
  let url;
  try {
    url = new URL(JSON.parse(body.toString('utf8')).webSocketDebuggerUrl);
  } catch {
    throw new Error('Moli /json/version has no valid webSocketDebuggerUrl');
  }
  if (!BROWSER_PATH_PATTERN.test(url.pathname)) {
    throw new Error(`unexpected browser endpoint path ${url.pathname}`);
  }
  return url.pathname;
}

/**
 * True when Moli answers its WebDriver /status endpoint.
 * @param {object} config
 * @returns {Promise<boolean>}
 */
export async function probeMoli(config) {
  try {
    const { status } = await getFromMoli(config, '/status', 2000);
    return status === 200;
  } catch {
    return false;
  }
}

/**
 * Caches the probe result briefly so public health checks cannot be used to
 * hammer Moli.
 * @param {() => Promise<boolean>} probe
 * @param {number} ttlMs
 * @returns {() => Promise<boolean>}
 */
export function cachedProbe(probe, ttlMs) {
  let cached = null;
  let inFlight = null;
  return async () => {
    if (cached !== null && Date.now() - cached.at < ttlMs) return cached.ok;
    if (inFlight === null) {
      inFlight = probe()
        .then((ok) => {
          cached = { ok, at: Date.now() };
          return ok;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
}
