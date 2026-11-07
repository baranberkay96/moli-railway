// Reads and validates the gate's configuration from environment variables.
// Everything is checked once at startup; a bad value stops the container with
// a clear message instead of serving an unprotected or half-working browser.

import { splitArgs } from './args.js';

export const MODES = Object.freeze({
  dom: Object.freeze({ layout: false, resource: false }),
  layout: Object.freeze({ layout: true, resource: false }),
  full: Object.freeze({ layout: true, resource: true }),
});

const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/;
const MOLI_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const GATE_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const TRUE_WORDS = new Set(['1', 'true', 'yes', 'on', 'y', 't']);
const FALSE_WORDS = new Set(['0', 'false', 'no', 'off', 'n', 'f']);
// Flags the gate owns: the internal listener must stay on loopback.
const RESERVED_FLAGS = ['--host', '--port', '-p', '--remote-allow-origins'];

export class ConfigError extends Error {}

function text(env, name, fallback = '') {
  const value = env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function parseBool(env, name, fallback) {
  const raw = text(env, name).toLowerCase();
  if (raw === '') return fallback;
  if (TRUE_WORDS.has(raw)) return true;
  if (FALSE_WORDS.has(raw)) return false;
  throw new ConfigError(`${name} must be true or false (got '${env[name]}')`);
}

/**
 * @param {Record<string, string|undefined>} env
 * @param {string} name
 * @param {{ fallback: number, min: number, max: number }} range
 * @returns {number}
 */
export function parseInteger(env, name, { fallback, min, max }) {
  const raw = text(env, name);
  if (raw === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError(`${name} must be a whole number (got '${raw}')`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

function parseToken(env) {
  const token = text(env, 'MOLI_TOKEN');
  if (token === '') {
    throw new ConfigError(
      'MOLI_TOKEN is empty. It protects the browser; set at least 16 characters of A-Z a-z 0-9 . _ ~ -',
    );
  }
  if (!TOKEN_PATTERN.test(token)) {
    throw new ConfigError(
      'MOLI_TOKEN must be 16-512 characters of A-Z a-z 0-9 . _ ~ - (URL-safe, so it works in ?token=)',
    );
  }
  return token;
}

function parseMode(env) {
  const mode = text(env, 'MOLI_MODE', 'layout').toLowerCase() || 'layout';
  if (!Object.hasOwn(MODES, mode)) {
    throw new ConfigError(`MOLI_MODE must be dom, layout or full (got '${mode}')`);
  }
  return mode;
}

function parseChoice(env, name, allowed, fallback) {
  const value = text(env, name, fallback).toLowerCase() || fallback;
  if (!allowed.has(value)) {
    throw new ConfigError(`${name} must be one of ${[...allowed].join(', ')} (got '${value}')`);
  }
  return value;
}

function isReservedFlag(arg) {
  return RESERVED_FLAGS.some(
    (flag) => arg === flag || arg.startsWith(`${flag}=`) || (flag === '-p' && /^-p\d/.test(arg)),
  );
}

function parseExtraArgs(env) {
  let args;
  try {
    args = splitArgs(text(env, 'MOLI_EXTRA_ARGS'));
  } catch (error) {
    throw new ConfigError(`MOLI_EXTRA_ARGS: ${error.message}`);
  }
  const reserved = args.find(isReservedFlag);
  if (reserved !== undefined) {
    throw new ConfigError(
      `MOLI_EXTRA_ARGS must not set ${reserved}: the gate keeps Moli on 127.0.0.1 and handles origins itself`,
    );
  }
  if (args.length > 0 && !args[0].startsWith('-')) {
    throw new ConfigError('MOLI_EXTRA_ARGS must contain only flags for `moli serve` (start with -)');
  }
  return Object.freeze(args);
}

function parseOrigins(env) {
  return Object.freeze(
    text(env, 'MOLI_ALLOWED_ORIGINS')
      .split(',')
      .map((origin) => origin.trim().toLowerCase().replace(/\/+$/, ''))
      .filter((origin) => origin !== ''),
  );
}

/**
 * Builds the immutable gate configuration.
 * @param {Record<string, string|undefined>} env
 * @returns {Readonly<object>}
 */
export function loadConfig(env) {
  const port = parseInteger(env, 'PORT', { fallback: 8080, min: 1, max: 65535 });
  const internalPort = parseInteger(env, 'MOLI_INTERNAL_PORT', { fallback: 9222, min: 1, max: 65535 });
  if (port === internalPort) {
    throw new ConfigError(`PORT (${port}) must differ from the internal Moli port (${internalPort})`);
  }
  const mode = parseMode(env);
  return Object.freeze({
    port,
    internalHost: '127.0.0.1',
    internalPort,
    token: parseToken(env),
    mode,
    layout: MODES[mode].layout,
    resource: MODES[mode].resource,
    blockPrivateNetworks: parseBool(env, 'MOLI_BLOCK_PRIVATE_NETWORKS', true),
    maxSessions: parseInteger(env, 'MOLI_MAX_SESSIONS', { fallback: 10, min: 0, max: 10000 }),
    sessionTimeoutMs:
      parseInteger(env, 'MOLI_SESSION_TIMEOUT', { fallback: 0, min: 0, max: 7 * 24 * 3600 }) * 1000,
    idleTimeoutMs:
      parseInteger(env, 'MOLI_IDLE_TIMEOUT', { fallback: 1800, min: 0, max: 7 * 24 * 3600 }) * 1000,
    httpTimeoutMs:
      parseInteger(env, 'MOLI_HTTP_TIMEOUT', { fallback: 600, min: 1, max: 3600 }) * 1000,
    moliLogLevel: parseChoice(env, 'MOLI_LOG_LEVEL', MOLI_LOG_LEVELS, 'warn'),
    gateLogLevel: parseChoice(env, 'MOLI_GATE_LOG_LEVEL', GATE_LOG_LEVELS, 'info'),
    extraArgs: parseExtraArgs(env),
    allowedOrigins: parseOrigins(env),
    moliBin: text(env, 'MOLI_BIN', '/usr/local/bin/moli') || '/usr/local/bin/moli',
    publicDomain: text(env, 'RAILWAY_PUBLIC_DOMAIN'),
  });
}
