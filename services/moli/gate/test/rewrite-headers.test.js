import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  downstreamResponseHeaders,
  isWebSocketUpgrade,
  upgradeRequestHead,
  upstreamRequestHeaders,
} from '../src/headers.js';
import { createLogger, createRateLimitedCounter } from '../src/log.js';
import {
  appendToken,
  clientOrigin,
  isValidHost,
  rewriteBody,
  rewriteFrontendUrl,
  rewriteJson,
  rewriteWsUrl,
  shouldRewrite,
} from '../src/rewrite.js';
import { createSessionRegistry } from '../src/sessions.js';

const TOKEN = 'abcdefghijklmnop0123456789';
const ctx = (secure, host = 'moli.up.railway.app') => ({
  prefixes: ['ws://127.0.0.1:9222', 'ws://localhost:9222'],
  secure,
  host,
  token: TOKEN,
});

test('which responses are rewritten', () => {
  for (const path of ['/json', '/json/list', '/json/version/', '/json/new']) assert.equal(shouldRewrite('GET', path), true);
  assert.equal(shouldRewrite('POST', '/session'), true);
  assert.equal(shouldRewrite('GET', '/session'), false);
  assert.equal(shouldRewrite('GET', '/session/S1/url'), false);
  assert.equal(shouldRewrite('GET', '/json/protocol'), false);
});

test('client origin from X-Forwarded-Proto and Host', () => {
  const opts = { fallbackHost: 'fb', publicDomain: 'browser.example.com' };
  assert.deepEqual(clientOrigin({ host: 'moli.up.railway.app', 'x-forwarded-proto': 'https' }, opts), {
    secure: true,
    host: 'moli.up.railway.app',
  });
  assert.deepEqual(clientOrigin({ host: 'moli.railway.internal:8080' }, opts), {
    secure: false,
    host: 'moli.railway.internal:8080',
  });
  assert.deepEqual(clientOrigin({ host: 'bad host/x', 'x-forwarded-proto': 'HTTPS, http' }, { fallbackHost: 'fb:1' }), {
    secure: true,
    host: 'fb:1',
  });
  // The Railway domain (and the configured public domain) is HTTPS-only even
  // if the edge did not send X-Forwarded-Proto.
  assert.equal(clientOrigin({ host: 'moli-production-1234.up.railway.app' }, opts).secure, true);
  assert.equal(clientOrigin({ host: 'Browser.Example.com' }, opts).secure, true);
  assert.equal(clientOrigin({ host: 'other.example.com' }, opts).secure, false);
  assert.equal(isValidHost('[fd12::1]:8080'), true);
  assert.equal(isValidHost('a@b'), false);
});

test('ws URLs are rewritten to the public address with the token', () => {
  assert.equal(
    rewriteWsUrl('ws://127.0.0.1:9222/devtools/browser/abc', ctx(true)),
    `wss://moli.up.railway.app/devtools/browser/abc?token=${TOKEN}`,
  );
  assert.equal(
    rewriteWsUrl('ws://localhost:9222/session/S1', ctx(false, 'moli.railway.internal:8080')),
    `ws://moli.railway.internal:8080/session/S1?token=${TOKEN}`,
  );
  assert.equal(rewriteWsUrl('ws://127.0.0.1:9222', ctx(true)), `wss://moli.up.railway.app/?token=${TOKEN}`);
  assert.equal(rewriteWsUrl('ws://127.0.0.1:92220/x', ctx(true)), null);
  assert.equal(rewriteWsUrl('https://example.com/ws://127.0.0.1:9222/', ctx(true)), null);
  assert.equal(appendToken('wss://h/p?a=1', 'x y'), 'wss://h/p?a=1&token=x%20y');
});

test('devtoolsFrontendUrl becomes a DevTools URL with the token encoded', () => {
  const url = rewriteFrontendUrl('/devtools/inspector.html?ws=127.0.0.1:9222/devtools/page/P1', ctx(true));
  assert.equal(
    url,
    `devtools://devtools/bundled/inspector.html?wss=moli.up.railway.app%2Fdevtools%2Fpage%2FP1%3Ftoken%3D${TOKEN}`,
  );
  const param = new URL(url).searchParams.get('wss');
  assert.equal(param, `moli.up.railway.app/devtools/page/P1?token=${TOKEN}`);
  assert.equal(rewriteFrontendUrl('/devtools/inspector.html', ctx(true)), null);
  assert.equal(rewriteFrontendUrl('/x?ws=10.0.0.1:9222/devtools/page/P1', ctx(true)), null);
});

test('rewriteJson walks objects and arrays without mutating the input', () => {
  const input = [
    {
      id: 'P1',
      url: 'ws://127.0.0.1:9222/not-a-target-but-internal',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/P1',
      devtoolsFrontendUrl: '/devtools/inspector.html?ws=127.0.0.1:9222/devtools/page/P1',
      nested: { list: ['ws://127.0.0.1:9222/session/S1', 7, null, true] },
    },
  ];
  const copy = structuredClone(input);
  const out = rewriteJson(input, ctx(true));
  assert.deepEqual(input, copy);
  assert.equal(out[0].webSocketDebuggerUrl, `wss://moli.up.railway.app/devtools/page/P1?token=${TOKEN}`);
  assert.equal(out[0].nested.list[0], `wss://moli.up.railway.app/session/S1?token=${TOKEN}`);
  assert.deepEqual(out[0].nested.list.slice(1), [7, null, true]);
  assert.ok(out[0].devtoolsFrontendUrl.startsWith('devtools://'));
});

test('rewriteBody leaves non-JSON alone', () => {
  assert.equal(rewriteBody(Buffer.from('<html>'), ctx(true)), null);
  const body = rewriteBody(Buffer.from('{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/x"}'), ctx(true));
  assert.equal(JSON.parse(body.toString()).webSocketDebuggerUrl, `wss://moli.up.railway.app/devtools/browser/x?token=${TOKEN}`);
});

test('upstream request headers: loopback Host, no credentials, no Origin, no hop-by-hop', () => {
  const out = upstreamRequestHeaders(
    {
      host: 'moli.up.railway.app',
      origin: 'https://moli.up.railway.app',
      authorization: `Bearer ${TOKEN}`,
      connection: 'keep-alive, x-drop-me',
      'x-drop-me': '1',
      'keep-alive': 'timeout=5',
      'transfer-encoding': 'chunked',
      'x-forwarded-for': '1.2.3.4',
      expect: '100-continue',
      'content-type': 'application/json',
      'accept-encoding': 'gzip',
      cookie: 'a=b',
    },
    { host: '127.0.0.1:9222', identityEncoding: true },
  );
  assert.deepEqual(out, {
    'content-type': 'application/json',
    'accept-encoding': 'identity',
    cookie: 'a=b',
    host: '127.0.0.1:9222',
  });
  const plain = upstreamRequestHeaders({ 'accept-encoding': 'gzip' }, { host: 'h', identityEncoding: false });
  assert.equal(plain['accept-encoding'], 'gzip');
});

test('downstream response headers drop hop-by-hop', () => {
  assert.deepEqual(
    downstreamResponseHeaders(
      { 'content-type': 'x', connection: 'close', 'transfer-encoding': 'chunked', 'content-length': '5' },
      { 'content-length': '9' },
    ),
    { 'content-type': 'x', 'content-length': '9' },
  );
});

test('upgrade request head keeps WebSocket headers and replaces Host', () => {
  const head = upgradeRequestHead(
    [
      'Host', 'moli.up.railway.app',
      'Upgrade', 'websocket',
      'Connection', 'Upgrade',
      'Sec-WebSocket-Key', 'abc==',
      'Sec-WebSocket-Version', '13',
      'Origin', 'https://moli.up.railway.app',
      'Authorization', `Bearer ${TOKEN}`,
      'X-Forwarded-Proto', 'https',
      'User-Agent', 'Playwright',
    ],
    '/devtools/browser/u1',
    '127.0.0.1:9222',
  );
  assert.equal(
    head,
    'GET /devtools/browser/u1 HTTP/1.1\r\nHost: 127.0.0.1:9222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Key: abc==\r\nSec-WebSocket-Version: 13\r\nUser-Agent: Playwright\r\n\r\n',
  );
  assert.ok(!head.includes(TOKEN));
});

test('isWebSocketUpgrade', () => {
  const req = (method, headers) => ({ method, headers });
  assert.equal(isWebSocketUpgrade(req('GET', { upgrade: 'WebSocket', connection: 'keep-alive, Upgrade' })), true);
  assert.equal(isWebSocketUpgrade(req('GET', { upgrade: 'h2c', connection: 'Upgrade' })), false);
  assert.equal(isWebSocketUpgrade(req('POST', { upgrade: 'websocket', connection: 'Upgrade' })), false);
  assert.equal(isWebSocketUpgrade(req('GET', { upgrade: 'websocket' })), false);
});

test('session registry enforces the limit and closes all', () => {
  const sessions = createSessionRegistry({ max: 2 });
  const a = sessions.tryAcquire();
  const b = sessions.tryAcquire();
  assert.equal(sessions.tryAcquire(), null);
  assert.equal(sessions.active, 2);
  a.release();
  a.release();
  assert.equal(sessions.active, 1);
  let closed = 0;
  b.attach(() => {
    closed += 1;
    b.release();
  });
  sessions.closeAll();
  assert.equal(closed, 1);
  assert.equal(sessions.active, 0);
  const unlimited = createSessionRegistry({ max: 0 });
  for (let i = 0; i < 50; i += 1) assert.notEqual(unlimited.tryAcquire(), null);
});

test('logger levels, fields and rate-limited counter', () => {
  const lines = [];
  const log = createLogger({ level: 'info', write: (level, line) => lines.push([level, line]) });
  log.debug('hidden');
  log.info('hello', { a: 1, b: 'two words', c: undefined, d: '' });
  log.error('bad');
  assert.deepEqual(lines, [
    ['info', '[moli-gate] INFO hello a=1 b="two words"'],
    ['error', '[moli-gate] ERROR bad'],
  ]);
  const counter = createRateLimitedCounter({ log, intervalMs: 10_000, message: 'refused' });
  counter.record({ client: '1.1.1.1' });
  counter.record({ client: '2.2.2.2' });
  counter.flush();
  counter.flush();
  assert.deepEqual(lines[2], ['warn', '[moli-gate] WARN refused count=2 client=2.2.2.2']);
  assert.equal(lines.length, 3);
});
