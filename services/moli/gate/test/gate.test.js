// Integration tests: the real gate (startApp) in front of the fake Moli server.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startApp } from '../src/app.js';
import { createFakeMoli } from './fake-moli.js';
import { TOKEN, captureLog, delay, freePort, request, stubSpawn, wsConnect } from './helpers.js';

const bearer = { authorization: `Bearer ${TOKEN}` };
const publicHeaders = { host: 'moli.up.railway.app', 'x-forwarded-proto': 'https' };

async function startGate(fake, extraEnv = {}) {
  const internalPort = await fake.listen();
  const port = await freePort();
  const { log, lines } = captureLog();
  const app = await startApp(
    { MOLI_TOKEN: TOKEN, PORT: String(port), MOLI_INTERNAL_PORT: String(internalPort), ...extraEnv },
    { log, spawnImpl: stubSpawn() },
  );
  return { app, port, lines };
}

describe('gate in front of fake Moli', () => {
  const fake = createFakeMoli();
  let gate;

  before(async () => {
    gate = await startGate(fake);
  });
  after(async () => {
    await gate.app.stop();
    await fake.close();
  });

  test('health and robots are public; health reflects Moli', async () => {
    const health = await request(gate.port, { path: '/health' });
    assert.equal(health.status, 200);
    assert.deepEqual(health.json, { status: 'ok' });
    assert.equal((await request(gate.port, { path: '/health', method: 'HEAD' })).status, 200);
    assert.equal((await request(gate.port, { path: '/robots.txt' })).text, 'User-agent: *\nDisallow: /\n');
    assert.equal((await request(gate.port, { path: '/health', method: 'POST' })).status, 405);
  });

  test('everything else needs the token', async () => {
    for (const path of ['/', '/json/version', '/status', '/session', `/json/version?token=wrong-${TOKEN}`]) {
      const res = await request(gate.port, { path });
      assert.equal(res.status, 401, path);
      assert.equal(res.json.error, 'unauthorized');
      assert.equal(res.headers['www-authenticate'], undefined);
    }
    assert.equal((await request(gate.port, { path: '/json/version', headers: { authorization: 'Bearer nope' } })).status, 401);
  });

  test('token accepted as query, Bearer and Basic', async () => {
    const basic = `Basic ${Buffer.from(`moli:${TOKEN}`).toString('base64')}`;
    assert.equal((await request(gate.port, { path: `/status?token=${TOKEN}` })).status, 200);
    assert.equal((await request(gate.port, { path: '/status', headers: bearer })).status, 200);
    assert.equal((await request(gate.port, { path: '/status', headers: { authorization: basic } })).status, 200);
  });

  test('upstream sees loopback Host, no token, no credentials, no Origin', async () => {
    fake.requests.length = 0;
    await request(gate.port, {
      path: `/status?a=1&token=${TOKEN}`,
      headers: { ...publicHeaders, ...bearer, origin: 'https://moli.up.railway.app' },
    });
    const seen = fake.requests.at(-1);
    assert.equal(seen.url, '/status?a=1');
    assert.match(seen.headers.host, /^127\.0\.0\.1:\d+$/);
    assert.equal(seen.headers.authorization, undefined);
    assert.equal(seen.headers.origin, undefined);
    assert.ok(!JSON.stringify(seen).includes(TOKEN));
  });

  test('cross-site Origin is refused before auth', async () => {
    const res = await request(gate.port, {
      path: `/json/version?token=${TOKEN}`,
      headers: { ...publicHeaders, origin: 'https://evil.example' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.error, 'origin_not_allowed');
  });

  test('/json/version advertises the public wss URL with the token', async () => {
    const res = await request(gate.port, { path: `/json/version/?token=${TOKEN}`, headers: publicHeaders });
    assert.equal(res.status, 200);
    assert.equal(
      res.json.webSocketDebuggerUrl,
      `wss://moli.up.railway.app/devtools/browser/${fake.browserId}?token=${TOKEN}`,
    );
    assert.equal(res.json['Moli-Version'], '1.1.22');
    assert.equal(res.headers['content-length'], String(Buffer.byteLength(res.text)));
  });

  test('private network clients get ws:// with their host and port', async () => {
    const res = await request(gate.port, {
      path: '/json/version',
      headers: { host: 'moli.railway.internal:8080', ...bearer },
    });
    assert.equal(
      res.json.webSocketDebuggerUrl,
      `ws://moli.railway.internal:8080/devtools/browser/${fake.browserId}?token=${TOKEN}`,
    );
  });

  test('/json/list and PUT /json/new are rewritten; other query params pass unchanged', async () => {
    const list = await request(gate.port, { path: `/json/list?token=${TOKEN}`, headers: publicHeaders });
    assert.equal(list.json[0].webSocketDebuggerUrl, `wss://moli.up.railway.app/devtools/page/PAGE1?token=${TOKEN}`);
    assert.ok(list.json[0].devtoolsFrontendUrl.startsWith('devtools://devtools/bundled/inspector.html?wss='));
    fake.requests.length = 0;
    const created = await request(gate.port, {
      method: 'PUT',
      path: `/json/new?url=https%3A%2F%2Fexample.com%2F%3Fq%3D1&token=${TOKEN}`,
      headers: publicHeaders,
    });
    assert.equal(fake.requests.at(-1).url, '/json/new?url=https%3A%2F%2Fexample.com%2F%3Fq%3D1');
    assert.match(created.json.webSocketDebuggerUrl, /^wss:\/\/moli\.up\.railway\.app\/devtools\/page\/PAGE\d+\?token=/);
  });

  test('WebDriver new session: BiDi webSocketUrl is rewritten, body passes through', async () => {
    const res = await request(gate.port, {
      method: 'POST',
      path: '/session',
      headers: { ...publicHeaders, ...bearer, 'content-type': 'application/json' },
      body: JSON.stringify({ capabilities: { alwaysMatch: { webSocketUrl: true } } }),
    });
    assert.equal(res.json.value.capabilities.webSocketUrl, `wss://moli.up.railway.app/session/S1?token=${TOKEN}`);
    const echo = await request(gate.port, {
      method: 'POST',
      path: '/echo-body',
      headers: { ...bearer, 'content-type': 'text/plain', 'transfer-encoding': 'chunked' },
      body: 'x'.repeat(100_000),
    });
    assert.equal(echo.json.body.length, 100_000);
  });

  test('authorized GET / shows connection info without the token', async () => {
    const res = await request(gate.port, { path: '/', headers: { ...publicHeaders, ...bearer } });
    assert.equal(res.status, 200);
    assert.equal(res.json.service, 'moli-gate');
    assert.equal(res.json.moli.mode, 'layout');
    assert.equal(res.json.connect.cdp, 'wss://moli.up.railway.app?token={MOLI_TOKEN}');
    assert.ok(!res.text.includes(TOKEN));
  });

  test('root WebSocket maps to the browser endpoint (Browserless-style URL)', async () => {
    fake.requests.length = 0;
    const ws = await wsConnect(gate.port, `/?token=${TOKEN}`, publicHeaders);
    assert.equal(ws.status, 101);
    const upstream = fake.requests.find((r) => r.upgrade);
    assert.equal(upstream.url, `/devtools/browser/${fake.browserId}`);
    assert.match(upstream.headers.host, /^127\.0\.0\.1:\d+$/);
    ws.send('{"id":1,"method":"Browser.getVersion"}');
    assert.equal(await ws.next(), '{"id":1,"method":"Browser.getVersion"}');
    const big = 'y'.repeat(5000);
    ws.send(big);
    assert.equal(await ws.next(), big);
    ws.socket.destroy();
  });

  test('page, bare browser and BiDi WebSocket paths; Bearer on the upgrade', async () => {
    for (const path of ['/devtools/page/PAGE1', '/devtools/browser', '/session', `/devtools/browser/${fake.browserId}`]) {
      const ws = await wsConnect(gate.port, path, bearer);
      assert.equal(ws.status, 101, path);
      ws.socket.destroy();
    }
  });

  test('WebSocket without token, with wrong Origin, or to unknown target', async () => {
    const noToken = await wsConnect(gate.port, '/');
    assert.equal(noToken.status, 401);
    const evil = await wsConnect(gate.port, `/?token=${TOKEN}`, { ...publicHeaders, origin: 'https://evil.example' });
    assert.equal(evil.status, 403);
    const sameSite = await wsConnect(gate.port, `/?token=${TOKEN}`, { ...publicHeaders, origin: 'https://moli.up.railway.app' });
    assert.equal(sameSite.status, 101);
    sameSite.socket.destroy();
    const stale = await wsConnect(gate.port, `/devtools/browser/00000000-dead?token=${TOKEN}`);
    assert.equal(stale.status, 404);
  });

  test('non-WebSocket upgrade is refused', async () => {
    const res = await wsConnect(gate.port, `/?token=${TOKEN}`, { upgrade: 'h2c' });
    assert.equal(res.status, 400);
  });

  test('session count drops back after clients disconnect', async () => {
    await delay(50);
    assert.equal(gate.app.sessions.active, 0);
    assert.ok(gate.lines.some((l) => l.message === 'session closed'));
    assert.ok(!JSON.stringify(gate.lines).includes(TOKEN));
  });
});

describe('limits and timeouts', () => {
  test('MOLI_MAX_SESSIONS refuses extra WebSockets with 429', async () => {
    const fake = createFakeMoli();
    const gate = await startGate(fake, { MOLI_MAX_SESSIONS: '1' });
    try {
      const first = await wsConnect(gate.port, '/', bearer);
      assert.equal(first.status, 101);
      const second = await wsConnect(gate.port, '/', bearer);
      assert.equal(second.status, 429);
      assert.equal(second.headers['retry-after'], '5');
      first.socket.destroy();
      await delay(50);
      const third = await wsConnect(gate.port, '/', bearer);
      assert.equal(third.status, 101);
      third.socket.destroy();
    } finally {
      await gate.app.stop();
      await fake.close();
    }
  });

  test('idle and session timeouts close the socket', async () => {
    const fake = createFakeMoli();
    const gate = await startGate(fake, { MOLI_IDLE_TIMEOUT: '1' });
    try {
      const ws = await wsConnect(gate.port, '/', bearer);
      const started = Date.now();
      await ws.closed();
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 900 && elapsed < 3000, `closed after ${elapsed} ms`);
      assert.ok(gate.lines.some((l) => l.fields?.reason === 'idle_timeout'));
    } finally {
      await gate.app.stop();
      await fake.close();
    }
    const fake2 = createFakeMoli();
    const gate2 = await startGate(fake2, { MOLI_IDLE_TIMEOUT: '0', MOLI_SESSION_TIMEOUT: '1' });
    try {
      const ws = await wsConnect(gate2.port, '/', bearer);
      const keepBusy = setInterval(() => ws.send('ping'), 100);
      await ws.closed();
      clearInterval(keepBusy);
      assert.ok(gate2.lines.some((l) => l.fields?.reason === 'session_timeout'));
    } finally {
      await gate2.app.stop();
      await fake2.close();
    }
  });

  test('Moli down: health 503, requests 502, upgrades 502', async () => {
    const fake = createFakeMoli();
    const gate = await startGate(fake);
    await fake.close();
    try {
      await delay(2100);
      assert.equal((await request(gate.port, { path: '/health' })).status, 503);
      const res = await request(gate.port, { path: '/status', headers: bearer });
      assert.equal(res.status, 502);
      assert.equal(res.json.error, 'moli_unavailable');
      assert.equal((await wsConnect(gate.port, '/', bearer)).status, 502);
      assert.equal((await wsConnect(gate.port, '/devtools/page/PAGE1', bearer)).status, 502);
      assert.equal(gate.app.sessions.active, 0);
    } finally {
      await gate.app.stop();
    }
  });

  test('slow Moli responses hit MOLI_HTTP_TIMEOUT with 504', async () => {
    const fake = createFakeMoli();
    const gate = await startGate(fake, { MOLI_HTTP_TIMEOUT: '1' });
    try {
      const res = await request(gate.port, { path: '/slow', headers: bearer });
      assert.equal(res.status, 504);
      assert.equal(res.json.error, 'moli_timeout');
    } finally {
      await gate.app.stop();
      await fake.close();
    }
  });

  test('shutdown closes open sessions', async () => {
    const fake = createFakeMoli();
    const gate = await startGate(fake);
    const ws = await wsConnect(gate.port, '/', bearer);
    await gate.app.stop();
    await ws.closed();
    assert.equal(gate.app.sessions.active, 0);
    await fake.close();
  });
});
