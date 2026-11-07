import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMoliArgs, buildMoliEnv, redactArgs, splitArgs } from '../src/args.js';
import {
  createTokenMatcher,
  isAuthorized,
  isOriginAllowed,
  splitTarget,
  stripTokenFromQuery,
  tokenFromAuthorization,
  tokenFromQuery,
} from '../src/auth.js';
import { loadConfig } from '../src/config.js';

const TOKEN = 'abcdefghijklmnop0123456789';
const basic = (user, pass) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

test('splitArgs handles quotes and escapes', () => {
  assert.deepEqual(splitArgs(''), []);
  assert.deepEqual(splitArgs('  --a  b\t--c '), ['--a', 'b', '--c']);
  assert.deepEqual(splitArgs(`--ua "a \\"b\\" c" --x 'single $HOME' --y a\\ b`), [
    '--ua',
    'a "b" c',
    '--x',
    'single $HOME',
    '--y',
    'a b',
  ]);
  assert.deepEqual(splitArgs(`--empty ""`), ['--empty', '']);
  assert.throws(() => splitArgs(`'open`), /unterminated ' quote/);
});

test('buildMoliArgs per mode and without duplicate flags', () => {
  const base = ['serve', '--host', '127.0.0.1', '--port', '9222'];
  assert.deepEqual(buildMoliArgs(loadConfig({ MOLI_TOKEN: TOKEN, MOLI_MODE: 'dom' })), [
    ...base,
    '--log-level',
    'warn',
    '--block-private-networks',
  ]);
  assert.deepEqual(
    buildMoliArgs(loadConfig({ MOLI_TOKEN: TOKEN, MOLI_MODE: 'full', MOLI_BLOCK_PRIVATE_NETWORKS: 'false' })),
    [...base, '--log-level', 'warn', '--layout', '--resource'],
  );
  assert.deepEqual(
    buildMoliArgs(
      loadConfig({ MOLI_TOKEN: TOKEN, MOLI_MODE: 'full', MOLI_EXTRA_ARGS: '-l --resource -L debug --scrollbars' }),
    ),
    [...base, '--block-private-networks', '-l', '--resource', '-L', 'debug', '--scrollbars'],
  );
});

test('buildMoliEnv passes only an allowlist and never the token', () => {
  const env = buildMoliEnv({
    MOLI_TOKEN: TOKEN,
    BROWSER_WS_ENDPOINT: `wss://x?token=${TOKEN}`,
    MOLI_LAYOUT: 'maybe',
    PATH: '/usr/bin',
    HOME: '/home/moli',
    HTTPS_PROXY: '',
    RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app',
  });
  assert.deepEqual(env, { NO_COLOR: '1', PATH: '/usr/bin', HOME: '/home/moli' });
});

test('redactArgs hides credential-bearing values', () => {
  assert.deepEqual(
    redactArgs(['serve', '--http-proxy', 'http://u:p@proxy:8080', '--proxy-bearer-token=abc', '--layout', '--cookie', 'a=b']),
    ['serve', '--http-proxy', '***', '--proxy-bearer-token=***', '--layout', '--cookie', '***'],
  );
});

test('splitTarget and token query handling keep other parameters byte for byte', () => {
  assert.deepEqual(splitTarget('/json/version?token=x#frag'), { pathname: '/json/version', query: 'token=x' });
  assert.deepEqual(splitTarget(''), { pathname: '/', query: '' });
  assert.deepEqual(splitTarget('?token=x'), { pathname: '/', query: 'token=x' });
  const query = `url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%2Bb&token=${TOKEN}&for_tab&tok%65n=2`;
  assert.equal(tokenFromQuery(query), TOKEN);
  assert.equal(stripTokenFromQuery(query), 'url=https%3A%2F%2Fexample.com%2F%3Fa%3D1%2Bb&for_tab');
  assert.equal(tokenFromQuery('a=1'), null);
  assert.equal(tokenFromQuery('token'), '');
  assert.equal(tokenFromQuery('token=%E0%A4%A'), null);
  assert.equal(stripTokenFromQuery(''), '');
});

test('Authorization header forms', () => {
  assert.equal(tokenFromAuthorization(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(tokenFromAuthorization(`bearer   ${TOKEN} `), TOKEN);
  assert.equal(tokenFromAuthorization(basic('moli', TOKEN)), TOKEN);
  assert.equal(tokenFromAuthorization(basic('anyone', TOKEN)), TOKEN);
  assert.equal(tokenFromAuthorization(basic(TOKEN, '')), TOKEN);
  assert.equal(tokenFromAuthorization(`Basic ${Buffer.from(TOKEN).toString('base64')}`), TOKEN);
  assert.equal(tokenFromAuthorization('Digest abc'), null);
  assert.equal(tokenFromAuthorization(undefined), null);
});

test('token matcher is exact', () => {
  const matches = createTokenMatcher(TOKEN);
  assert.equal(matches(TOKEN), true);
  assert.equal(matches(`${TOKEN}x`), false);
  assert.equal(matches(TOKEN.slice(1)), false);
  assert.equal(matches(''), false);
  assert.equal(matches(null), false);
  const req = (authorization) => ({ headers: authorization ? { authorization } : {} });
  assert.equal(isAuthorized(req(), `token=${TOKEN}`, matches), true);
  assert.equal(isAuthorized(req(`Bearer ${TOKEN}`), '', matches), true);
  assert.equal(isAuthorized(req('Bearer wrong-token-000000000'), 'token=nope', matches), false);
  assert.equal(isAuthorized(req(), '', matches), false);
});

test('origin policy: none, same site or allowlisted', () => {
  const headers = (origin) => ({ host: 'moli.up.railway.app', ...(origin === undefined ? {} : { origin }) });
  assert.equal(isOriginAllowed(headers(undefined), []), true);
  assert.equal(isOriginAllowed(headers('https://moli.up.railway.app'), []), true);
  assert.equal(isOriginAllowed(headers('http://moli.up.railway.app'), []), true);
  assert.equal(isOriginAllowed(headers('https://evil.example'), []), false);
  assert.equal(isOriginAllowed(headers('null'), []), false);
  assert.equal(isOriginAllowed(headers('https://evil.example'), ['https://evil.example']), true);
  assert.equal(isOriginAllowed(headers('https://evil.example'), ['*']), true);
  assert.equal(isOriginAllowed({ origin: 'https://a.example' }, []), false);
  assert.equal(isOriginAllowed({ origin: ['a', 'b'] }, ['*']), false);
});
