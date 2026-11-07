import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, loadConfig, parseBool, parseInteger } from '../src/config.js';

const TOKEN = 'abcdefghijklmnop0123456789';

test('defaults: layout mode, private networks blocked, 10 sessions, 30 min idle', () => {
  const config = loadConfig({ MOLI_TOKEN: TOKEN });
  assert.equal(config.port, 8080);
  assert.equal(config.internalHost, '127.0.0.1');
  assert.equal(config.internalPort, 9222);
  assert.equal(config.mode, 'layout');
  assert.equal(config.layout, true);
  assert.equal(config.resource, false);
  assert.equal(config.blockPrivateNetworks, true);
  assert.equal(config.maxSessions, 10);
  assert.equal(config.idleTimeoutMs, 1_800_000);
  assert.equal(config.sessionTimeoutMs, 0);
  assert.equal(config.httpTimeoutMs, 600_000);
  assert.equal(config.moliLogLevel, 'warn');
  assert.deepEqual(config.extraArgs, []);
  assert.deepEqual(config.allowedOrigins, []);
  assert.ok(Object.isFrozen(config));
});

test('modes map to layout and resource flags', () => {
  assert.deepEqual(
    ['dom', 'layout', 'full', 'FULL'].map((mode) => {
      const c = loadConfig({ MOLI_TOKEN: TOKEN, MOLI_MODE: mode });
      return [c.layout, c.resource];
    }),
    [
      [false, false],
      [true, false],
      [true, true],
      [true, true],
    ],
  );
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_MODE: 'turbo' }), ConfigError);
});

test('token is required, URL-safe and at least 16 characters', () => {
  assert.throws(() => loadConfig({}), /MOLI_TOKEN is empty/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: '   ' }), /MOLI_TOKEN is empty/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: 'short' }), /16-512 characters/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: 'has spaces in the token ok?' }), /16-512/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: 'abc/def+ghi=jklmnop' }), /16-512/);
  assert.equal(loadConfig({ MOLI_TOKEN: ` ${TOKEN} ` }).token, TOKEN);
});

test('port validation', () => {
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, PORT: '9222' }), /must differ/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, PORT: '0' }), /between 1 and 65535/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, PORT: '80a' }), /whole number/);
  assert.equal(loadConfig({ MOLI_TOKEN: TOKEN, PORT: '3000' }).port, 3000);
});

test('numeric limits and timeouts', () => {
  const c = loadConfig({
    MOLI_TOKEN: TOKEN,
    MOLI_MAX_SESSIONS: '0',
    MOLI_SESSION_TIMEOUT: '600',
    MOLI_IDLE_TIMEOUT: '0',
    MOLI_HTTP_TIMEOUT: '30',
  });
  assert.equal(c.maxSessions, 0);
  assert.equal(c.sessionTimeoutMs, 600_000);
  assert.equal(c.idleTimeoutMs, 0);
  assert.equal(c.httpTimeoutMs, 30_000);
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_MAX_SESSIONS: '-1' }), /whole number/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_HTTP_TIMEOUT: '0' }), /between 1 and 3600/);
});

test('booleans accept common spellings and reject others', () => {
  assert.equal(parseBool({ X: 'YES' }, 'X', false), true);
  assert.equal(parseBool({ X: 'off' }, 'X', true), false);
  assert.equal(parseBool({ X: '' }, 'X', true), true);
  assert.equal(parseBool({}, 'X', false), false);
  assert.throws(() => parseBool({ X: 'enabled' }, 'X', true), /true or false/);
  assert.equal(loadConfig({ MOLI_TOKEN: TOKEN, MOLI_BLOCK_PRIVATE_NETWORKS: 'false' }).blockPrivateNetworks, false);
});

test('parseInteger fallback and range', () => {
  assert.equal(parseInteger({}, 'N', { fallback: 5, min: 0, max: 10 }), 5);
  assert.throws(() => parseInteger({ N: '11' }, 'N', { fallback: 5, min: 0, max: 10 }), ConfigError);
});

test('log levels are validated', () => {
  assert.equal(loadConfig({ MOLI_TOKEN: TOKEN, MOLI_LOG_LEVEL: 'INFO' }).moliLogLevel, 'info');
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_LOG_LEVEL: 'trace' }), /MOLI_LOG_LEVEL/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_GATE_LOG_LEVEL: 'fatal' }), /MOLI_GATE_LOG_LEVEL/);
});

test('extra args are split and reserved flags are refused', () => {
  const c = loadConfig({ MOLI_TOKEN: TOKEN, MOLI_EXTRA_ARGS: `--user-agent "Agent 1.0" --http-proxy 'socks5://p:1080'` });
  assert.deepEqual(c.extraArgs, ['--user-agent', 'Agent 1.0', '--http-proxy', 'socks5://p:1080']);
  for (const bad of ['--host 0.0.0.0', '--port=1', '-p 1', '-p9000', '--remote-allow-origins *']) {
    assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_EXTRA_ARGS: bad }), /must not set/, bad);
  }
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_EXTRA_ARGS: 'fetch https://x' }), /only flags/);
  assert.throws(() => loadConfig({ MOLI_TOKEN: TOKEN, MOLI_EXTRA_ARGS: '--user-agent "oops' }), /unterminated/);
  // -P (profile dir) is not -p (port).
  assert.deepEqual(loadConfig({ MOLI_TOKEN: TOKEN, MOLI_EXTRA_ARGS: '-P /data/p' }).extraArgs, ['-P', '/data/p']);
});

test('allowed origins are normalized', () => {
  const c = loadConfig({ MOLI_TOKEN: TOKEN, MOLI_ALLOWED_ORIGINS: ' https://App.Example.com/ , ,http://localhost:3000' });
  assert.deepEqual(c.allowedOrigins, ['https://app.example.com', 'http://localhost:3000']);
});
