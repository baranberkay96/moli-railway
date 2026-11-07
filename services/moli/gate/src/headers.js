// Header handling between the client, the gate and Moli.
//
// Moli refuses requests whose Host is not an IP literal or localhost, and any
// Origin other than its own loopback address. The gate has already checked
// the token and the Origin, so it sends Moli a loopback Host, drops Origin,
// and never forwards the client's credentials.

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const NEVER_FORWARD = new Set([
  'host',
  'origin',
  'authorization',
  'expect',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
]);

function connectionTokens(headers) {
  const value = headers.connection;
  const text = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
  return new Set(
    text
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token !== ''),
  );
}

/**
 * Request headers for a plain HTTP request to Moli.
 * @param {Record<string, string|string[]|undefined>} headers incoming (lower-case keys)
 * @param {{ host: string, identityEncoding: boolean }} options
 * @returns {Record<string, string|string[]>}
 */
export function upstreamRequestHeaders(headers, { host, identityEncoding }) {
  const listed = connectionTokens(headers);
  const kept = Object.entries(headers).filter(
    ([name, value]) =>
      value !== undefined && !HOP_BY_HOP.has(name) && !NEVER_FORWARD.has(name) && !listed.has(name),
  );
  const encoding = identityEncoding ? { 'accept-encoding': 'identity' } : {};
  return { ...Object.fromEntries(kept), ...encoding, host };
}

/**
 * Response headers to send back to the client.
 * @param {Record<string, string|string[]|undefined>} headers from Moli
 * @param {Record<string, string>} overrides
 * @returns {Record<string, string|string[]>}
 */
export function downstreamResponseHeaders(headers, overrides = {}) {
  const listed = connectionTokens(headers);
  const kept = Object.entries(headers).filter(
    ([name, value]) => value !== undefined && !HOP_BY_HOP.has(name) && !listed.has(name),
  );
  return { ...Object.fromEntries(kept), ...overrides };
}

/**
 * Raw HTTP/1.1 request head for a WebSocket upgrade to Moli. Keeps the
 * client's header order and the Upgrade/Connection/Sec-WebSocket-* headers.
 * @param {string[]} rawHeaders req.rawHeaders (name, value, name, value, ...)
 * @param {string} target path and query for Moli
 * @param {string} host loopback Host header
 * @returns {string}
 */
export function upgradeRequestHead(rawHeaders, target, host) {
  const lines = [`GET ${target} HTTP/1.1`, `Host: ${host}`];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    if (!NEVER_FORWARD.has(name.toLowerCase())) lines.push(`${name}: ${rawHeaders[i + 1]}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/**
 * True for a WebSocket upgrade request.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isWebSocketUpgrade(req) {
  const upgrade = typeof req.headers.upgrade === 'string' ? req.headers.upgrade.toLowerCase() : '';
  return req.method === 'GET' && upgrade === 'websocket' && connectionTokens(req.headers).has('upgrade');
}
