// Build-time self-test (run by the Dockerfile): loads every module and checks
// the pure parts with a throwaway token, so a broken gate fails the build
// instead of the deploy. Does not start servers or Moli.

import assert from 'node:assert/strict';
import { buildMoliArgs, buildMoliEnv } from './args.js';
import { createTokenMatcher, stripTokenFromQuery, tokenFromAuthorization } from './auth.js';
import { loadConfig } from './config.js';
import { rewriteJson } from './rewrite.js';
import './app.js';

const token = 'selftest-token-0123456789';
const config = loadConfig({ MOLI_TOKEN: token });

assert.deepEqual(buildMoliArgs(config), [
  'serve',
  '--host',
  '127.0.0.1',
  '--port',
  '9222',
  '--log-level',
  'warn',
  '--layout',
  '--block-private-networks',
]);
assert.equal(buildMoliEnv({ MOLI_TOKEN: token, PATH: '/bin' }).MOLI_TOKEN, undefined);
assert.equal(createTokenMatcher(token)(token), true);
assert.equal(tokenFromAuthorization(`Bearer ${token}`), token);
assert.equal(stripTokenFromQuery(`url=a&token=${token}`), 'url=a');
assert.deepEqual(
  rewriteJson(
    { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' },
    { prefixes: ['ws://127.0.0.1:9222'], secure: true, host: 'moli.example.com', token },
  ),
  { webSocketDebuggerUrl: `wss://moli.example.com/devtools/browser/abc?token=${token}` },
);

process.stdout.write('moli-gate self-test ok\n');
