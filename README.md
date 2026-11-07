# Deploy and Host Moli with Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/moli-v11-headless-browser-for-ai-agents-?referralCode=20H68q)

Moli is an open-source headless browser for AI agents, written in Rust by Lexmount. One endpoint speaks CDP, WebDriver Classic and WebDriver BiDi, so Playwright, Puppeteer, Selenium and browser-use connect to it like a remote Chrome. This template runs Moli 1.1.22 always on, behind a token.

## About Hosting Moli

Moli has no login of its own, and its automation server only accepts local connections. An exposed browser is a free proxy for anyone who finds it. This community template keeps Moli on loopback and puts a small gate on the Railway domain. The gate requires a token generated at deploy on every request and WebSocket. It rewrites CDP discovery so clients get your public `wss://` address. It also caps open sessions, closes idle ones and restarts Moli if it exits. Pages cannot reach your Railway private network by default. One service, no database, no volume.

## Common Use Cases

- A remote browser for AI agents (browser-use, Stagehand, LangChain tools, your own Playwright code) without running Chrome locally
- Scraping and extraction of JavaScript-heavy pages: DOM, text, HTML, screenshots and PDFs
- Link previews, screenshots and page monitoring for apps hosted on Railway, over the private network
- A drop-in for code that reads `BROWSER_WS_ENDPOINT` from a Browserless service, for CDP clients

## Dependencies for Moli Hosting

- Moli 1.1.22, the official Linux release binary, checksum-verified (included)
- A token gate built from this repository on Node.js 24 LTS (included)
- A CDP or WebDriver client: Playwright, Puppeteer, Selenium, browser-use, chromedp or raw WebSockets

### Deployment Dependencies

- Moli source and releases: https://github.com/lexmount/moli
- Playwright `connectOverCDP`: https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- Puppeteer `connect`: https://pptr.dev/api/puppeteer.puppeteer.connect
- Selenium Remote WebDriver: https://www.selenium.dev/documentation/webdriver/drivers/remote_webdriver/
- Railway private networking: https://docs.railway.com/guides/private-networking
- Railway Fair Use Policy: https://railway.com/legal/fair-use

### Implementation Details

| Service | Source | Purpose |
|---|---|---|
| Moli | Dockerfile in `services/moli` (Debian trixie slim, Moli 1.1.22, Node.js 24.22.2) | Gate on `PORT` 8080 (public domain, `/health` healthcheck); `moli serve` on 127.0.0.1:9222 |

**Connect.** Copy `BROWSER_WS_ENDPOINT` from the service's Variables tab. It looks like `wss://{your-domain}?token={MOLI_TOKEN}`. From another service in the same project, reference `${{Moli.BROWSER_WS_ENDPOINT_PRIVATE}}`: it uses the private network, which is faster and adds no egress.

Playwright (Node.js). Use one context per job; contexts keep cookies and storage apart:

```js
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP(process.env.BROWSER_WS_ENDPOINT);
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://example.com");
console.log(await page.title());
await context.close();
await browser.close();
```

Playwright (Python) works the same way: `await p.chromium.connect_over_cdp(os.environ["BROWSER_WS_ENDPOINT"])`. To keep the token out of the URL, connect to `https://{your-domain}` and pass `headers={"Authorization": "Bearer {MOLI_TOKEN}"}`.

Puppeteer:

```js
import puppeteer from "puppeteer-core";

const browser = await puppeteer.connect({ browserWSEndpoint: process.env.BROWSER_WS_ENDPOINT });
```

browser-use and other CDP tools: pass the same `wss://` URL as the CDP URL. Prefer it over the `https://` form for clients that append paths to the URL you give them.

Selenium (Python 4.26 or later). Moli's browser name is `moli`, so use plain options rather than `ChromeOptions`:

```python
import os
from selenium import webdriver
from selenium.webdriver.common.options import ArgOptions
from selenium.webdriver.remote.client_config import ClientConfig

url = os.environ["BROWSER_WEBDRIVER_ENDPOINT"]
options = ArgOptions()
options.set_capability("browserName", "moli")
driver = webdriver.Remote(
    command_executor=url,
    options=options,
    client_config=ClientConfig(remote_server_addr=url, username="moli", password=os.environ["MOLI_TOKEN"]),
)
```

Add `options.set_capability("webSocketUrl", True)` for WebDriver BiDi; the returned BiDi URL already points to your domain.

**Authentication.** Every path except `/health` and `/robots.txt` needs `MOLI_TOKEN`, sent as `?token=`, as `Authorization: Bearer`, or as the Basic auth password (any user name). The gate removes the token before the request reaches Moli. Requests from a browser page on another site are refused; list trusted origins in `MOLI_ALLOWED_ORIGINS` if you need that. To rotate the token, change `MOLI_TOKEN` and redeploy. Discovery URLs (`/json/version`, `/json/list`) include the token, so treat their output like the token itself.

**Modes.** `MOLI_MODE` picks what Moli computes:

- `layout` (default): real layout, screenshots, PDFs and coordinate input, built only when a request needs them. Best for Playwright and browser-use.
- `dom`: DOM, JavaScript and network only. Uses the least CPU, but screenshots and element boxes are not real.
- `full`: layout plus images, fonts, audio, video and other media. Closest to Chrome for screenshots, uses the most bandwidth.

`MOLI_EXTRA_ARGS` passes more flags to `moli serve`, such as `--user-agent "MyAgent/1.0"` or `--http-proxy socks5://host:1080`.

**Limits.** `MOLI_MAX_SESSIONS` (default 10) caps open WebSocket connections; extra ones get HTTP 429. `MOLI_IDLE_TIMEOUT` (default 1800 s) closes connections with no traffic. `MOLI_SESSION_TIMEOUT` (default off) caps a connection's lifetime. One Playwright or Puppeteer connection can hold many pages, and WebDriver Classic sessions are not counted.

**Private networks.** `MOLI_BLOCK_PRIVATE_NETWORKS=true` (default) stops pages from reaching private, loopback and link-local addresses, including `*.railway.internal` and cloud metadata. Set it to `false` only to browse your own internal services. Traffic sent through `--http-proxy` is filtered by the proxy, not by Moli.

**Scaling and cost.** Keep one replica: each replica is a separate browser, and discovery and WebDriver sessions are not shared between replicas. Raise CPU and memory instead, or deploy a second service. Moli is light: upstream's public-web crawl benchmark reports a median RSS of 73 MiB, and the gate adds roughly 50 to 60 MB. Estimates at Railway prices, not measurements: about $1/month idle, $5 to $10/month for an agent working a few hours a day, $30 to $60/month for around ten busy sessions. Responses sent over the public domain count as egress. Trial works for light use; Hobby is the practical plan.

**Persistence.** None: cookies and site storage are temporary, like an incognito window, and reset when Moli restarts. Log in from your script or set cookies per run.

**Pinning and upgrades.** Moli and Node.js versions and their SHA-256 checksums are build arguments at the top of `services/moli/Dockerfile`. Change them to a newer release and redeploy. Moli is young and changes quickly; read its release notes before upgrading.

**Compatibility.** Moli is its own engine, not Chromium. Most automation works, but some complex web apps, Canvas/WebGL and media playback behave differently. Unsupported protocol calls return explicit errors.

**Fair use.** Respect the terms of service and robots.txt of the sites you visit, keep request rates reasonable, and do not use this browser for abuse, spam, credential stuffing or to get around access controls. Railway's Fair Use Policy applies to your deployment. This is a community template, not affiliated with or endorsed by Lexmount.

### Why Deploy Moli on Railway?

Railway gives Moli an HTTPS domain, private networking to your other services and usage-based billing, with nothing to administer. Your agents get a browser that is always on and protected by a token, and costs little while it waits.
