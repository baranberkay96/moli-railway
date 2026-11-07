// Builds the `moli serve` command line and the environment Moli runs with.
// MOLI_EXTRA_ARGS is split like a shell would (quotes and backslashes), but
// nothing is ever evaluated by a shell.

/**
 * Splits a command-line string into arguments. Supports single quotes,
 * double quotes (with \" and \\ escapes) and backslash escapes.
 * @param {string} input
 * @returns {string[]}
 */
export function splitArgs(input) {
  const args = [];
  let current = '';
  let inArg = false;
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        current += input[i + 1];
        i += 1;
      } else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inArg = true;
    } else if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      inArg = true;
      i += 1;
    } else if (/\s/.test(ch)) {
      if (inArg) args.push(current);
      current = '';
      inArg = false;
    } else {
      current += ch;
      inArg = true;
    }
  }
  if (quote !== null) throw new Error(`unterminated ${quote} quote`);
  if (inArg) args.push(current);
  return args;
}

function hasFlag(args, names) {
  return args.some((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)));
}

/**
 * Arguments for `moli serve`. Mode flags are only added when MOLI_EXTRA_ARGS
 * does not already contain them, because Moli rejects repeated flags.
 * @param {Readonly<object>} config
 * @returns {string[]}
 */
export function buildMoliArgs(config) {
  const extra = config.extraArgs;
  const optional = [
    [config.layout, ['--layout', '-l'], '--layout'],
    [config.resource, ['--resource', '-r'], '--resource'],
    [config.blockPrivateNetworks, ['--block-private-networks'], '--block-private-networks'],
  ]
    .filter(([enabled, names]) => enabled && !hasFlag(extra, names))
    .map(([, , flag]) => flag);
  const logLevel = hasFlag(extra, ['--log-level', '-L']) ? [] : ['--log-level', config.moliLogLevel];
  return [
    'serve',
    '--host',
    config.internalHost,
    '--port',
    String(config.internalPort),
    ...logLevel,
    ...optional,
    ...extra,
  ];
}

// Flags whose values can hold credentials (proxy URLs with user:password,
// bearer tokens, cookie data, certificate passwords).
const SENSITIVE_FLAGS = new Set([
  '--http-proxy',
  '--proxy-bearer-token',
  '--cookie',
  '--cookie-file',
  '--client-cert',
  '-H',
  '--header',
]);

/**
 * Copy of the argument list that is safe to log.
 * @param {string[]} args
 * @returns {string[]}
 */
export function redactArgs(args) {
  return args.map((arg, index) => {
    const eq = arg.indexOf('=');
    if (arg.startsWith('--') && eq !== -1 && SENSITIVE_FLAGS.has(arg.slice(0, eq))) {
      return `${arg.slice(0, eq)}=***`;
    }
    return index > 0 && SENSITIVE_FLAGS.has(args[index - 1]) ? '***' : arg;
  });
}

// Moli reads MOLI_LAYOUT, MOLI_RESOURCE, MOLI_SCROLLBARS and
// MOLI_BLOCK_PRIVATE_NETWORKS itself. They are not passed through: the gate
// turns MOLI_MODE and MOLI_BLOCK_PRIVATE_NETWORKS into explicit flags, and a
// value Moli cannot parse would otherwise stop it from starting.
const PASSTHROUGH_ENV = Object.freeze([
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NO_COLOR',
  'FONTCONFIG_FILE',
  'FONTCONFIG_PATH',
  'XDG_CACHE_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'RUST_BACKTRACE',
]);

/**
 * Minimal environment for the Moli child: no token, no Railway variables.
 * @param {Record<string, string|undefined>} env
 * @returns {Record<string, string>}
 */
export function buildMoliEnv(env) {
  const entries = PASSTHROUGH_ENV.filter((name) => typeof env[name] === 'string' && env[name] !== '').map(
    (name) => [name, env[name]],
  );
  return Object.freeze({ NO_COLOR: '1', ...Object.fromEntries(entries) });
}
