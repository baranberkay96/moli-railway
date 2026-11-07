// Plain HTTP proxying to Moli: CDP discovery (/json/*), WebDriver Classic
// (/session/*, /status). Bodies stream through, except discovery and
// new-session responses, which are buffered and rewritten (rewrite.js).

import http from 'node:http';
import { downstreamResponseHeaders, upstreamRequestHeaders } from './headers.js';
import { MAX_REWRITE_BYTES, rewriteBody, shouldRewrite } from './rewrite.js';
import { upstreamHostHeader } from './upstream.js';

/**
 * Sends a small JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} body
 * @param {Record<string, string>} headers
 */
export function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function bufferAndRewrite(upstreamRes, res, rewriteContext) {
  const chunks = [];
  let size = 0;
  let overflow = false;
  upstreamRes.on('data', (chunk) => {
    if (overflow) return;
    size += chunk.length;
    if (size > MAX_REWRITE_BYTES) {
      overflow = true;
      upstreamRes.destroy();
      if (!res.headersSent) sendJson(res, 502, { error: 'upstream_response_too_large' });
      return;
    }
    chunks.push(chunk);
  });
  upstreamRes.on('end', () => {
    if (overflow) return;
    const original = Buffer.concat(chunks);
    const body = rewriteBody(original, rewriteContext) ?? original;
    res.writeHead(
      upstreamRes.statusCode ?? 502,
      downstreamResponseHeaders(upstreamRes.headers, {
        'content-length': String(body.length),
        'cache-control': 'no-store',
      }),
    );
    res.end(body);
  });
}

/**
 * Creates the HTTP proxy handler.
 * @param {{ config: object, log: object, agent?: import('node:http').Agent }} deps
 * @returns {(req: object, res: object, route: { pathname: string, upstreamTarget: string, rewriteContext: object }) => void}
 */
export function createHttpProxy({ config, log, agent }) {
  const keepAliveAgent = agent ?? new http.Agent({ keepAlive: true, maxSockets: 256 });
  const host = upstreamHostHeader(config);

  return (req, res, { pathname, upstreamTarget, rewriteContext }) => {
    const rewrite = shouldRewrite(req.method ?? 'GET', pathname);
    const upstreamReq = http.request({
      host: config.internalHost,
      port: config.internalPort,
      method: req.method,
      path: upstreamTarget,
      agent: keepAliveAgent,
      headers: upstreamRequestHeaders(req.headers, { host, identityEncoding: rewrite }),
    });

    upstreamReq.setTimeout(config.httpTimeoutMs, () => {
      upstreamReq.destroy(new Error('upstream timeout'));
    });

    upstreamReq.on('error', (error) => {
      log.warn('request to Moli failed', { method: req.method, path: pathname, error: error.message });
      if (!res.headersSent) {
        const timedOut = error.message === 'upstream timeout';
        sendJson(res, timedOut ? 504 : 502, {
          error: timedOut ? 'moli_timeout' : 'moli_unavailable',
          message: timedOut ? 'Moli did not answer in time' : 'Moli is starting or restarting; retry shortly',
        });
      } else {
        res.destroy();
      }
    });

    upstreamReq.on('response', (upstreamRes) => {
      upstreamRes.on('error', () => res.destroy());
      if (rewrite) {
        bufferAndRewrite(upstreamRes, res, rewriteContext);
        return;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, downstreamResponseHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    });

    res.on('close', () => {
      if (!res.writableFinished) upstreamReq.destroy();
    });
    req.on('error', () => upstreamReq.destroy());
    req.pipe(upstreamReq);
  };
}
