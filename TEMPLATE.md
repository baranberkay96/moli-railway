# Moli v1.1 Headless Browser for AI Agents (CDP): Railway template spec

## Listing

| Field | Value |
|---|---|
| Name | **Moli v1.1 Headless Browser for AI Agents (CDP)** (46 chars, version label from the pinned 1.1.22 release) |
| Description | Token-protected Rust headless browser for AI agents: CDP and WebDriver. (71 chars) |
| Category | Automation (next to Railway's Browserless templates, which share the audience) |
| Tags | moli, headless-browser, cdp, playwright, puppeteer, selenium, webdriver, browser-automation, ai-agents, web-scraping |
| Icon | `https://cdn.jsdelivr.net/npm/lucide-static@1.59.0/icons/app-window.svg` (200, image/svg+xml). Moli has no logo file in its repository, so a neutral icon is used instead of the Lexmount avatar. |
| Repo | `baranberkay96/moli-railway`, service root `/services/moli` |
| Expected template code | `moli-v11-headless-browser-for-ai-agents` (guessed from the name, 40-char slug; the README button is rewritten after publishing) |

The description is delivered as written: the gate requires the token on every request and WebSocket upgrade, and Moli serves CDP, WebDriver Classic and WebDriver BiDi on one endpoint.

## Base market template

One market template exists: `moli` ("Moli | Headless Browser for AI Agents (CDP, WebDriver, Playwright)" by two-workspaces, 0 active projects, 1 project in total, created 2026-10-16). Its repository has **no licence**, so it was read for ideas only and nothing was copied. What it does and where this package differs:

- Same shape (kept): one service, `moli serve` on loopback, a token gate on the public domain, token from `secret()`, `/health` without the token, private networks blocked, `--layout` by default.
- It pins Moli **v1.1.17** (2026-10-12), 1,089 commits behind 1.1.22. It downloads the archive with `curl | tar` and checks no checksum. This package pins 1.1.22 with SHA-256 for both architectures and retries every download (STANDARD lesson 27).
- Its Caddyfile answers `/json/version` with a static body for `/devtools/browser/moli-browser`. That id was a constant in 1.1.17. Since then Moli uses a random id per process (`mod.rs`: `/devtools/browser/{browser_id}`, `Uuid::new_v4()`), so a static answer gives clients a dead URL. The 1.1.22 server also refuses any `Host` that is not an IP literal or `localhost`, and any foreign `Origin` (`request_guard.rs`). A pass-through proxy therefore gets HTTP 403 for every request. Our gate sends a loopback Host, drops Origin after checking it itself, and rewrites the live discovery responses.
- It rewrites only `/json/version`. Ours also rewrites `/json`, `/json/list`, `PUT /json/new` and the BiDi `webSocketUrl` in `POST /session`, and maps the bare `wss://{domain}` URL to the browser endpoint (Browserless style).
- It compares tokens with a Caddy expression (not constant-time) and has no Origin check, so a browser that holds Basic credentials for the domain could be driven cross-site. It has no session limit or timeouts, uses restart policy `ON_FAILURE` with 10 retries, and does not supervise Moli (the container exits when Moli exits).

## Pinned versions

| Component | Source | Version | Released | Checked |
|---|---|---|---|---|
| Moli | GitHub release `lexmount/moli` `v1.1.22`, `moli-x86_64-unknown-linux-gnu.tar.gz` / `moli-aarch64-unknown-linux-gnu.tar.gz` | 1.1.22 (commit `2353bc83`) | 2026-11-06 | 2026-11-07 |
| Node.js | nodejs.org `node-v24.22.2-linux-{x64,arm64}.tar.xz` (binary and LICENSE only) | 24.22.2 LTS "Krypton" | 2026-10-27 | 2026-11-07 |
| Base image | `debian:trixie-20261104-slim@sha256:a72b4433…0d63b6b2` (multi-arch index) | Debian 13 | 2026-11-05 | 2026-11-07 |
| Debian packages | ca-certificates, tini 0.19.0, libstdc++6, libgcc-s1, zlib1g, libfontconfig1/fontconfig 2.15.0, fonts-dejavu-core, fonts-liberation 2.1.5, fonts-noto-core, fonts-noto-cjk, fonts-noto-color-emoji | trixie stable | — | 2026-11-07 |

SHA-256 (verified by downloading each file and hashing it locally; the Moli values also match GitHub's asset digests):

- Moli x86_64: `7e10f9a5b62371da56203b21ac0172bbe3c3626de189fc3742b91b2e2b8cdd39`
- Moli aarch64: `a199802d237fff981cb5a72ac075813af2510f5a4b51ce182d8fc18b5520210b`
- Node.js x64: `48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75`
- Node.js arm64: `eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8`

All pins are `PIN_*` build args at the top of `services/moli/Dockerfile`. Release archives stay downloadable, unlike vendor apt pins (lesson 27). Node 26 is the new Active LTS (2026-10-28); 24.x is kept because the gate's test suite ran on Node 24, and 24 receives fixes until 2028-04.

## Architecture

```
Client (Playwright, Puppeteer, Selenium, browser-use)
  │  wss://{domain}?token=…  |  https://{domain}/json/version  |  WebDriver /session
  ▼
Railway edge (TLS) ──► :8080 moli-gate (Node.js, [::], user 10001)
                          │ /health, /robots.txt         public
                          │ Origin check → token check   (?token= | Bearer | Basic)
                          │ strips token, Authorization, Origin; Host → 127.0.0.1:9222
                          │ rewrites ws://127.0.0.1:9222/… in discovery JSON
                          │ WebSocket: session limit, idle/session timeouts, byte pipe
                          ▼
                      127.0.0.1:9222 moli serve [--layout] [--resource] --block-private-networks
                          (child of the gate; restarted with backoff if it exits)
tini -s (subreaper) ─► node /opt/moli-gate/src/main.js ─► moli serve
```

**Why a small Node.js gate instead of Caddy.** Stock Caddy can check tokens and fix the Host header, but it cannot rewrite JSON bodies, and Moli's browser endpoint id changes on every start, so a static Caddyfile cannot route `wss://{domain}` to it either. The gate uses only Node's standard library (no npm dependencies), runs on the pinned Node binary, and has 58 tests (unit, integration against a Moli double that copies 1.1.22's Host/Origin guard and discovery format, and an end-to-end run of `main.js`).

## Services

### Moli

| Setting | Value |
|---|---|
| Source | repo `baranberkay96/moli-railway`, root `/services/moli` (Dockerfile) |
| Start command | none (image entrypoint) |
| Healthcheck | `/health` on `PORT=8080`, timeout 180 s. 200 only when Moli is running and answers its own `/status`. |
| Public domain | yes, target port 8080 |
| TCP proxy | none |
| Volume | none (Moli keeps profiles in temporary storage; no state to keep) |
| Restart policy | ALWAYS (no max retries) |
| Replicas | 1 (each replica is a separate browser; discovery ids and WebDriver sessions are per process) |

Files in `services/moli/`:

- `Dockerfile`: digest-pinned Debian trixie slim, runtime libraries and fonts from the Debian archive, Moli and Node.js release downloads with SHA-256 checks (curl and xz removed afterwards), Moli licences kept in `/usr/local/share/doc/moli`, unprivileged user 10001, build-time `moli --version`, `node --version` and gate self-test. No `VOLUME`, no `COPY --chmod`.
- `gate/src/`: `main.js` (signals, exit codes), `app.js` (wiring, dual-stack listen with IPv4 fallback), `config.js` (validation), `server.js` (routing, origin and token checks), `auth.js`, `headers.js`, `http-proxy.js`, `ws-proxy.js`, `rewrite.js`, `sessions.js`, `supervisor.js`, `upstream.js`, `args.js`, `log.js`, `selftest.js`.
- `gate/test/`: `node --test "test/*.test.js"` (not copied into the image).

### Variables

| Variable | Default | Notes |
|---|---|---|
| `MOLI_TOKEN` | `${{secret(48, "a-zA-Z0-9")}}` | Required. 16–512 chars of `A-Z a-z 0-9 . _ ~ -`; the gate refuses to start otherwise. |
| `PORT` | `8080` | Gate port = healthcheck port = domain target (lesson 8.1). Must differ from 9222. |
| `MOLI_MODE` | `layout` | `dom` = `moli serve`; `layout` = `--layout`; `full` = `--layout --resource`. |
| `MOLI_BLOCK_PRIVATE_NETWORKS` | `true` | Adds `--block-private-networks`: RFC 1918, loopback, link-local (metadata), CGNAT and IPv6 unique-local addresses, which covers Railway's private network (`network_policy.rs`). |
| `MOLI_MAX_SESSIONS` | `10` | Open WebSocket connections; extra upgrades get 429 + `Retry-After: 5`. 0 = unlimited. |
| `MOLI_IDLE_TIMEOUT` | `1800` | Seconds without traffic before a WebSocket is closed. 0 = off. |
| `MOLI_SESSION_TIMEOUT` | `0` | Maximum WebSocket lifetime in seconds. 0 = off. |
| `MOLI_LOG_LEVEL` | `warn` | Moli `--log-level` (debug, info, warn, error, fatal). |
| `MOLI_EXTRA_ARGS` | empty | Extra `moli serve` flags, split like a shell (no shell evaluation). `--host`, `--port`, `-p`, `--remote-allow-origins` are refused; mode flags are not duplicated (Moli rejects repeated flags). |
| `BROWSER_TOKEN` | `${{MOLI_TOKEN}}` | Alias (Railway Browserless naming). |
| `BROWSER_WS_ENDPOINT` | `wss://${{RAILWAY_PUBLIC_DOMAIN}}?token=${{MOLI_TOKEN}}` | Public CDP URL. |
| `BROWSER_WS_ENDPOINT_PRIVATE` | `ws://${{RAILWAY_PRIVATE_DOMAIN}}:${{PORT}}?token=${{MOLI_TOKEN}}` | Private-network CDP URL. |
| `BROWSER_WEBDRIVER_ENDPOINT` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` | Public WebDriver URL (auth via Basic/Bearer). |
| `BROWSER_WEBDRIVER_ENDPOINT_PRIVATE` | `http://${{RAILWAY_PRIVATE_DOMAIN}}:${{PORT}}` | Private WebDriver URL. |

Advanced, read by the gate but not in the template: `MOLI_ALLOWED_ORIGINS` (comma-separated origins, or `*`, allowed to send cross-site requests, e.g. browser-based WebSocket clients), `MOLI_HTTP_TIMEOUT` (seconds for one proxied HTTP request, default 600), `MOLI_GATE_LOG_LEVEL` (default info), `MOLI_INTERNAL_PORT` (default 9222).

The Moli child gets an allow-listed environment only (`PATH`, `HOME`, locale, `TZ`, CA paths, fontconfig, proxy variables). The token and the `BROWSER_*` URLs never reach the browser process. Moli's own `MOLI_LAYOUT`/`MOLI_RESOURCE`/`MOLI_SCROLLBARS`/`MOLI_BLOCK_PRIVATE_NETWORKS` environment parsing is bypassed in favour of explicit flags, so an unparsable value cannot stop Moli from starting.

No required user input: the token is generated.

## Auth and discovery design

1. `/health`, `/healthz`, `/robots.txt` are public and return no data.
2. A request that carries an `Origin` header must come from the same host (`http(s)://{Host}`) or `MOLI_ALLOWED_ORIGINS`, else 403. Browsers attach cached credentials to cross-site requests and WebSocket handshakes; CDP and WebDriver libraries send no Origin. 401 responses carry no `WWW-Authenticate`, so browsers never prompt for, or cache, Basic credentials.
3. Token from `?token=`, `Authorization: Bearer`, or the Basic password (the user name counts when the password is empty), compared in constant time (SHA-256 then `timingSafeEqual`).
4. Upstream request: `token` query parameters are removed with the rest of the query kept byte for byte (Moli parses `/json/new?url=` itself). `Authorization`, `Origin`, `X-Forwarded-*`, `Expect` and hop-by-hop headers are dropped. `Host` becomes `127.0.0.1:9222`, the only form Moli 1.1.22 accepts.
5. Discovery rewriting: in `/json`, `/json/list`, `/json/version`, `/json/new` and `POST /session` responses (JSON up to 4 MB), every string starting with `ws://127.0.0.1:9222/` becomes `{wss|ws}://{Host the client used}/…?token=…`. `wss` is used when `X-Forwarded-Proto` is https or the host is the Railway public domain (`*.up.railway.app`); private-network clients get `ws://{svc}.railway.internal:8080`. `devtoolsFrontendUrl` becomes a `devtools://devtools/bundled/inspector.html?wss=…` URL with the token encoded. The token is appended so that clients which fetch discovery with a header but open the WebSocket without one still authenticate.
6. WebSocket upgrades on `/`, `/devtools/browser` and `/devtools/browser/` go to Moli's current `/devtools/browser/{uuid}` (read from `/json/version` per connection, so it survives Moli restarts). Other paths (`/devtools/page/{id}`, `/devtools/browser/{id}`, `/session`, `/session/{id}`) pass through. After the handshake the gate pipes bytes, so frames, compression and close codes are untouched.

## Default mode

`layout`. Moli's layout is on demand: DOM-only requests cost the same as `dom` mode, and only screenshots, element boxes and coordinate input trigger a layout pass. Playwright clicks and browser-use screenshots need real geometry, so `dom` would break the most common agent workloads. `full` also downloads images, fonts and media, which costs bandwidth and CPU on every page, so it is opt-in.

## First connection

1. Variables tab: copy `BROWSER_WS_ENDPOINT` (or `MOLI_TOKEN`).
2. `curl -H "Authorization: Bearer {MOLI_TOKEN}" https://{domain}/json/version`: `webSocketDebuggerUrl` must start with `wss://{domain}/devtools/browser/`.
3. `chromium.connectOverCDP(BROWSER_WS_ENDPOINT)`, then `newContext()`, `newPage()`, `goto()`.
4. From another Railway service: `${{Moli.BROWSER_WS_ENDPOINT_PRIVATE}}`.

## Improvements over market templates

1. Works with Moli 1.1.22's Host and Origin guard and its per-process browser id (see above).
2. Root `wss://{domain}?token=` endpoint and Browserless-compatible variable names, so existing `BROWSER_WS_ENDPOINT` code switches with a reference change.
3. Full discovery rewriting (version, list, new, BiDi `webSocketUrl`, DevTools frontend URL), for public and private-network clients.
4. Session limit, idle timeout and optional lifetime cap. Moli itself has none (its `serve --timeout` flag is parsed but not used in 1.1.22).
5. Constant-time token check, three token forms, cross-site Origin refusal, token and credentials stripped before Moli, token never logged, proxy credentials in `MOLI_EXTRA_ARGS` redacted in logs.
6. Moli supervised with exponential backoff (1 s to 30 s). If it fails 10 times in a row within 10 s of starting, the container exits so Railway shows the crash. Restart policy ALWAYS.
7. Pinned and verified downloads (Moli, Node.js, base image digest), unprivileged runtime user, minimal environment for the browser process.
8. Fonts for faithful screenshots and layout geometry: Liberation (Arial, Times New Roman and Courier New metrics), DejaVu, Noto, Noto CJK and Noto Color Emoji.
9. Health that reflects Moli, not just the gate.

## Threads and memory

Moli caps its own pools from the CPU quota it sees (`std::thread::available_parallelism`, which reads the cgroup quota): Tokio workers and blocking threads at most 4 (`runtime_thread_budget.rs`), V8 background workers at most 8 (`moli-v8-platform`), shared DNS workers at most 4. So lesson 15 is handled upstream, and no override is needed. Node's libuv pool stays at its default of 4.

## Resource estimate

Railway prices: RAM $10/GB-month, vCPU $20/vCPU-month. No volume. Estimates, not measurements on Railway.

| Profile | RAM | CPU | $/month |
|---|---|---|---|
| Idle (gate + Moli, no sessions) | ~0.08 GB (gate ≈ 50–60 MB RSS measured locally on Node 24; Moli tens of MB) | ~0.005 vCPU | ≈ $1 |
| Typical (one agent, a few hours a day, layout mode, a few pages at a time) | 0.2–0.4 GB avg | 0.1–0.2 vCPU avg | ≈ $5–10 |
| Heavy (about ten busy sessions with screenshots) | 1–1.5 GB | 1–2 vCPU | ≈ $30–60 |

Upstream's public-web crawl benchmark reports a median RSS of 73 MiB per Moli fetch, against 773 MiB for headless Chrome. Responses that leave through the public domain are egress; the private endpoint avoids it. Minimum plan: **Trial** runs it for light use (well under 1 GB); **Hobby** for agents and scraping; **Pro** for many concurrent sessions.

## Verification checklist

- [ ] Build succeeds; logs show `sha256sum` OK for Moli and Node, `moli 1.1.22`, `v24.22.2`, `moli-gate self-test ok`.
- [ ] Deploy logs: `gate listening address=:: port=8080`, `starting moli … --layout --block-private-networks`, `moli started`; healthcheck `/health` passes.
- [ ] `GET /health` → 200 `{"status":"ok"}`; `GET /` and `GET /json/version` without token → 401 JSON, no `WWW-Authenticate`.
- [ ] `GET /json/version?token=…` → `webSocketDebuggerUrl` = `wss://{domain}/devtools/browser/{uuid}?token=…`; same with `Authorization: Bearer`.
- [ ] Playwright Node: `connectOverCDP(BROWSER_WS_ENDPOINT)`, `newContext()`, `goto('https://example.com')`, `title()` = "Example Domain", `page.screenshot()` returns a non-blank PNG (layout mode).
- [ ] Playwright Python `connect_over_cdp('https://{domain}', headers={'Authorization': 'Bearer …'})` works (discovery path).
- [ ] Puppeteer `connect({browserWSEndpoint})` works; `GET /json/list?token=…` shows `wss://` page URLs and a `devtools://` frontend URL.
- [ ] Selenium Python with `ArgOptions` (`browserName` `moli`) and `ClientConfig(username, password)`: `driver.get`, `driver.title`; with `webSocketUrl: True` the returned URL is `wss://{domain}/session/…?token=…`.
- [ ] From another service: `ws://moli.railway.internal:8080?token=…` connects (IPv4 and IPv6 private networking).
- [ ] With `MOLI_BLOCK_PRIVATE_NETWORKS=true`, `page.goto('http://moli.railway.internal:8080/health')` fails with a blocked-address error.
- [ ] `MOLI_MAX_SESSIONS=1`: a second concurrent connection gets 429. `MOLI_IDLE_TIMEOUT=30`: an idle connection closes after ~30 s (log `reason=idle_timeout`).
- [ ] Cross-site check: `curl -H 'Origin: https://evil.example' …?token=…` → 403.
- [ ] Redeploy: logs show `stopping reason=SIGTERM` and a clean exit; Moli restart test: memory pressure or crash shows `moli exited … restarting moli` and `/health` returns to 200.
- [ ] Idle memory and CPU in Railway metrics after 30 minutes (expected ≈ 80 MB, ~0 CPU).

## Open questions

- **Not built or run** (no Docker by instruction). Static checks only: RUN bodies pass `bash -n`, archive layouts and checksums verified locally, the gate's 58 tests pass on Node 24.3 against a Moli double. The real Moli binary was never executed here, so its behaviour behind the gate (Playwright, Puppeteer, Selenium over the public domain) is first tested on Railway.
- **Railway WebSocket idle limits**: if Railway's edge closes quiet WebSockets sooner than `MOLI_IDLE_TIMEOUT`, long-thinking agents may need to reconnect. Not measured.
- **Moli's handling of a client that half-closes**: the gate closes both sides 2 s after either side ends. Assumed to match hyper/tungstenite closing on EOF.
- **CDP coverage**: Moli is not Chromium; upstream's Lexbench reports 81.9 % task success against Chrome's 99.8 %. Some sites and protocol calls will behave differently.
- **Fonts**: fontconfig's cache is built at image build time; first-screenshot latency with Noto CJK loaded is untested.
- **Persistent profiles** (`--profile-dir` on a volume) are not offered: the image runs as UID 10001 and Railway volumes mount as root.
