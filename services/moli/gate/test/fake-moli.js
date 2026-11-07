#!/usr/bin/env node
// Test double for `moli serve`. It reproduces the parts of Moli 1.1.22's
// protocol server that the gate depends on (moli-protocol-server/src/
// protocol_server/{mod,cdp,request_guard}.rs):
//   - Host must be an IP literal or localhost, Origin must be absent (403 else)
//   - /json/version with ws://{bound addr}/devtools/browser/{random uuid}
//   - /json, /json/list, PUT /json/new with ws:// target URLs
//   - POST /session returning webSocketUrl when requested, GET /status
//   - WebSocket upgrade on the browser and page paths (text echo)
// Every request is recorded for assertions.
// Run directly (`fake-moli.js serve --host 127.0.0.1 --port 9222 ...`) it acts
// as the Moli binary for supervisor tests.

import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function hostAllowed(host) {
  if (typeof host !== 'string') return false;
  const name = host.replace(/:\d*$/, '');
  return name === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(name) || /^\[[0-9a-f:]+\]$/i.test(name);
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

// Minimal server side of RFC 6455 for small text frames: unmask and echo.
function echoFrames(socket) {
  let buffer = Buffer.alloc(0);
  // Like Moli (hyper/tungstenite), close the connection when the peer does.
  socket.on('end', () => socket.end());
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      }
      const masked = (buffer[1] & 0x80) !== 0;
      const total = offset + (masked ? 4 : 0) + length;
      if (buffer.length < total) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(buffer.subarray(total - length, total));
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      buffer = buffer.subarray(total);
      if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      const header =
        payload.length < 126
          ? Buffer.from([0x80 | opcode, payload.length])
          : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 0xff]);
      socket.write(Buffer.concat([header, payload]));
    }
  });
}

export function createFakeMoli() {
  const browserId = randomUUID();
  const requests = [];
  const upgraded = new Set();
  let addr = '';
  const targets = [{ id: 'PAGE1', title: 'about:blank', url: 'about:blank' }];

  const target = (t) => ({
    description: '',
    devtoolsFrontendUrl: `/devtools/inspector.html?ws=${addr}/devtools/page/${t.id}`,
    id: t.id,
    title: t.title,
    type: 'page',
    url: t.url,
    webSocketDebuggerUrl: `ws://${addr}/devtools/page/${t.id}`,
  });

  const guard = (req) => {
    if (!hostAllowed(req.headers.host)) return 'Forbidden: Host must be an IP literal or localhost';
    if (req.headers.origin !== undefined) return 'Forbidden: Origin is not allowed';
    return null;
  };

  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    const denied = guard(req);
    if (denied) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end(denied);
      return;
    }
    const path = req.url.split('?', 1)[0].replace(/(.)\/$/, '$1');
    if (path === '/status') return json(res, 200, { value: { ready: true, message: '' } });
    if (path === '/json/version') {
      return json(res, 200, {
        Browser: 'Chrome/156.0.8078.74',
        'Moli-Version': '1.1.22',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://${addr}/devtools/browser/${browserId}`,
      });
    }
    if (path === '/json' || path === '/json/list') return json(res, 200, targets.map(target));
    if (path === '/json/new' && req.method === 'PUT') {
      const created = { id: `PAGE${targets.length + 1}`, title: '', url: 'about:blank' };
      targets.push(created);
      return json(res, 200, target(created));
    }
    if (path === '/session' && req.method === 'POST') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        const wantsBidi = body?.capabilities?.alwaysMatch?.webSocketUrl === true;
        const capabilities = { browserName: 'moli', ...(wantsBidi ? { webSocketUrl: `ws://${addr}/session/S1` } : {}) };
        json(res, 200, { value: { sessionId: 'S1', capabilities } });
      });
      return undefined;
    }
    if (path === '/slow') {
      setTimeout(() => json(res, 200, { slow: true }), 2000);
      return undefined;
    }
    if (path === '/echo-body') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => json(res, 200, { body: Buffer.concat(chunks).toString(), method: req.method }));
      return undefined;
    }
    return json(res, 404, { error: 'not found' });
  });

  server.on('upgrade', (req, socket) => {
    requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, upgrade: true });
    const denied = guard(req);
    const path = req.url.split('?', 1)[0];
    const known =
      path === `/devtools/browser/${browserId}` ||
      /^\/devtools\/page\/PAGE\d+$/.test(path) ||
      path === '/session' ||
      path === '/session/S1';
    if (denied || !known) {
      socket.end(`HTTP/1.1 ${denied ? 403 : 404} ${denied ? 'Forbidden' : 'Not Found'}\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    upgraded.add(socket);
    socket.on('close', () => upgraded.delete(socket));
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}${WS_GUID}`).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    echoFrames(socket);
  });

  return {
    browserId,
    requests,
    server,
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise((resolve) => server.listen(port, host, resolve));
      const address = server.address();
      addr = `${address.address}:${address.port}`;
      return address.port;
    },
    close() {
      for (const socket of upgraded) socket.destroy();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function parseServeArgs(argv) {
  const value = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index === -1 ? fallback : argv[index + 1];
  };
  return { host: value('--host', '127.0.0.1'), port: Number(value('--port', '9222')) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv[0] !== 'serve') {
    process.stderr.write('error: unexpected subcommand\n');
    process.exit(2);
  }
  if (argv.includes('--fail-fast')) {
    process.stderr.write("error: unexpected argument '--fail-fast' found\n");
    process.exit(2);
  }
  const { host, port } = parseServeArgs(argv);
  const fake = createFakeMoli();
  fake.listen(port, host).then(() => {
    process.stdout.write(`fake moli listening on ${host}:${port} args=${argv.join(' ')}\n`);
  });
  process.on('SIGTERM', () => process.exit(0));
}
