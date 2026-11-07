// End to end: `node src/main.js` as in the image, with test/fake-moli.js as
// the Moli binary. Covers startup, readiness, a CDP WebSocket through the
// root URL, a Moli crash and restart (new browser id), and SIGTERM.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { TOKEN, delay, freePort, request, wsConnect } from './helpers.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));
const FAKE_MOLI = fileURLToPath(new URL('./fake-moli.js', import.meta.url));

function run(env) {
  const child = spawn(process.execPath, [MAIN], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (c) => output.push(c.toString()));
  child.stderr.on('data', (c) => output.push(c.toString()));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, output, exited };
}

async function waitFor(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    await delay(100);
  }
  throw new Error('condition not met in time');
}

test('main.js supervises Moli and proxies CDP end to end', async () => {
  chmodSync(FAKE_MOLI, 0o755);
  const port = await freePort();
  const internalPort = await freePort();
  const gate = run({
    MOLI_TOKEN: TOKEN,
    PORT: String(port),
    MOLI_INTERNAL_PORT: String(internalPort),
    MOLI_BIN: FAKE_MOLI,
    MOLI_MODE: 'full',
    MOLI_EXTRA_ARGS: '--user-agent "E2E Agent" --http-proxy http://user:secret@proxy:3128',
    RAILWAY_PUBLIC_DOMAIN: 'moli.up.railway.app',
  });
  const moliPids = [];
  try {
    await waitFor(async () => (await request(port, { path: '/health' })).status === 200);
    const logs = gate.output.join('');
    assert.match(logs, /fake moli listening on 127\.0\.0\.1:\d+ args=serve --host 127\.0\.0\.1 --port \d+ --log-level warn --layout --resource --block-private-networks --user-agent E2E Agent --http-proxy http:\/\/user:secret@proxy:3128/);
    assert.match(logs, /starting moli .*--http-proxy \*\*\*/);
    assert.ok(!logs.includes(TOKEN), 'token must not be logged');
    const gateLines = logs.split('\n').filter((line) => line.startsWith('[moli-gate]'));
    assert.ok(!gateLines.join('\n').includes('secret'), 'proxy credentials must not be logged by the gate');

    const version = await request(port, {
      path: `/json/version?token=${TOKEN}`,
      headers: { host: 'moli.up.railway.app', 'x-forwarded-proto': 'https' },
    });
    const firstId = version.json.webSocketDebuggerUrl.match(/browser\/([^?]+)/)[1];
    const ws = await wsConnect(port, `/?token=${TOKEN}`);
    assert.equal(ws.status, 101);
    ws.send('hello');
    assert.equal(await ws.next(), 'hello');

    const info = await request(port, { path: '/', headers: { authorization: `Bearer ${TOKEN}` } });
    const pid = info.json.moli.pid;
    moliPids.push(pid);
    assert.equal(info.json.moli.status, 'running');
    process.kill(pid, 'SIGKILL');
    await ws.closed();
    await waitFor(async () => {
      const again = await request(port, { path: '/', headers: { authorization: `Bearer ${TOKEN}` } });
      moliPids.push(again.json.moli.pid);
      return again.json.moli.status === 'running' && again.json.moli.pid !== pid;
    });
    let after;
    await waitFor(async () => {
      after = await request(port, { path: '/json/version', headers: { authorization: `Bearer ${TOKEN}` } });
      return after.status === 200;
    });
    assert.notEqual(after.json.webSocketDebuggerUrl.match(/browser\/([^?]+)/)[1], firstId);
    const ws2 = await wsConnect(port, '/', { authorization: `Bearer ${TOKEN}` });
    assert.equal(ws2.status, 101);
    ws2.socket.destroy();

    gate.child.kill('SIGTERM');
    const { code } = await gate.exited;
    assert.equal(code, 0);
    assert.match(gate.output.join(''), /shutting down/);
    for (const moliPid of new Set(moliPids.filter(Boolean))) {
      assert.throws(() => process.kill(moliPid, 0), /ESRCH/, `moli ${moliPid} must be stopped with the gate`);
    }
  } finally {
    gate.child.kill('SIGKILL');
    for (const pid of moliPids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  }
});

test('main.js refuses to start without a valid token', async () => {
  const gate = run({ PORT: String(await freePort()), MOLI_BIN: FAKE_MOLI });
  const { code } = await gate.exited;
  assert.equal(code, 1);
  assert.match(gate.output.join(''), /configuration error: MOLI_TOKEN is empty/);
});

test('main.js exits when the Moli binary is missing', async () => {
  const gate = run({ MOLI_TOKEN: TOKEN, PORT: String(await freePort()), MOLI_BIN: '/nonexistent/moli' });
  const { code } = await gate.exited;
  assert.equal(code, 1);
  assert.match(gate.output.join(''), /giving up on moli .*ENOENT/);
});
