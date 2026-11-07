# NOTICE: Moli v1.1 Headless Browser for AI Agents (CDP) template

## Software in the image

| Component | Version | Source | Licence | How it is used |
|---|---|---|---|---|
| Moli | 1.1.22 (tag `v1.1.22`, commit `2353bc83`, released 2026-11-06) | https://github.com/lexmount/moli release archives `moli-{x86_64,aarch64}-unknown-linux-gnu.tar.gz`, SHA-256 `7e10f9a5…b8cdd39` (x86_64) and `a199802d…20210b` (aarch64) | Apache-2.0 OR MIT, at the user's option (`license-metadata.json`). Separately licensed third-party components keep their own licences; the archive's notices (`LICENSE-APACHE`, `LICENSE-MIT`, `licenses/Chromium-BSD-3-Clause.txt`, `licenses/Selenium-NOTICE.txt`) are installed in `/usr/local/share/doc/moli/`. | Unmodified binary, run as `moli serve` |
| Node.js | 24.22.2 LTS | https://nodejs.org/dist/v24.22.2/ `node-v24.22.2-linux-{x64,arm64}.tar.xz`, SHA-256 `48cc0e21…7aaf75` (x64) and `eb187837…d9ba8` (arm64) | MIT, with the bundled third-party licences in `/usr/local/share/doc/nodejs/LICENSE` | Unmodified `node` binary that runs the gate (npm and headers are not installed) |
| Debian 13 (trixie) base | `debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2` | Docker Hub official image | Various (Debian archive; per-package copyright files in `/usr/share/doc`) | Base OS |
| tini | 0.19.0 | Debian archive | MIT | Init/subreaper in front of the gate |
| libstdc++6, libgcc-s1 | 14.2.0 | Debian archive | GPL-3.0 with GCC Runtime Library Exception | Runtime libraries Moli links against |
| zlib1g | 1.3.1 | Debian archive | Zlib | Runtime library |
| libfontconfig1, fontconfig | 2.15.0 | Debian archive | fontconfig licence (MIT-style) | Font discovery for layout and screenshots |
| ca-certificates | 20250419 | Debian archive | MPL-2.0 (Mozilla CA list), GPL-2.0+ (scripts) | HTTPS trust store |
| fonts-dejavu-core | 2.37 | Debian archive | Bitstream Vera licence with DejaVu public-domain changes | Fallback fonts |
| fonts-liberation | 2.1.5 | Debian archive | SIL OFL 1.1 | Arial/Times New Roman/Courier New metric-compatible fonts |
| fonts-noto-core, fonts-noto-cjk, fonts-noto-color-emoji | trixie versions | Debian archive | SIL OFL 1.1 | Non-Latin scripts, CJK and emoji |

Debian packages are installed unmodified from the archive. Their exact versions follow the pinned base image's release (trixie) and are not pinned individually.

## Written for this template

All files in this package were written for this template: `services/moli/Dockerfile`, the `moli-gate` sources and tests in `services/moli/gate/`, and `template.json`, `TEMPLATE.md`, `README.md` and this file. No code or text was copied from Moli, from the market template or from other templates. The gate's test double (`gate/test/fake-moli.js`) reimplements the observable HTTP behaviour of Moli's protocol server (Host and Origin checks, discovery JSON shape); it contains no Moli source code.

The icon is Lucide's `app-window` (https://lucide.dev, ISC licence), referenced by URL from `lucide-static@1.59.0` on jsDelivr.

## Upstream sources and docs checked (2026-11-07)

- `gh api repos/lexmount/moli/releases/tags/v1.1.22`: assets, sizes and SHA-256 digests; both Linux archives downloaded and hashed locally (match). Archive layout `moli-v1.1.22-{target}/` with `moli`, `VERSION` (`1.1.22`), licence files.
- ELF headers of both Linux binaries read (not executed): `NEEDED` libstdc++.so.6, libfontconfig.so.1, libz.so.1, libgcc_s.so.1, libm.so.6, libc.so.6; highest symbol version GLIBC_2.35. The release workflow builds them in `rust:1.96.1-bookworm` (`.github/workflows/release.yml`).
- Local `_upstream/lexmount__moli` copy (version 1.1.22 in `moli/Cargo.toml`): `README.md`, `docs/RELEASING.md`, `moli/src/{cli,config,app,main}.rs` (serve flags, defaults `--host 127.0.0.1 --port 9222`, env flags `MOLI_LAYOUT`, `MOLI_RESOURCE`, `MOLI_SCROLLBARS`, `MOLI_BLOCK_PRIVATE_NETWORKS`, log levels, `--obey-robots` is fetch-only), `moli-protocol-server/src/protocol_server/{mod,cdp,request_guard,trailing_slash,tcp_options}.rs` (routes, random browser id, advertised `ws://{addr}` URLs, Host/Origin guard), `moli-protocol-server/src/{config,runtime_thread_budget}.rs` (unused `timeout_secs`, thread caps), `moli-v8-platform/src/lib.rs` and `moli-dns-resolver/src/service.rs` (thread caps), `moli-curl/src/{network_policy,tls}.rs` (private-network policy, CA handling), `moli-system-fonts` (fontconfig), `moli-protocol-webdriver-classic/src/capabilities.rs` (`browserName` must be `moli` or absent), `moli-cdp-smoke` and `moli-webdriver-smoke` (client usage patterns).
- `gh api repos/lexmount/moli/contents/moli-protocol-server/src/protocol_server/mod.rs?ref=v1.1.17` and `compare/v1.1.17...v1.1.22` (1,089 commits): 1.1.17 used the fixed browser id `moli-browser` and had no `request_guard.rs`.
- nodejs.org `dist/index.json` and `dist/v24.22.2/SHASUMS256.txt`; both tarballs downloaded and hashed locally.
- Docker Hub `library/debian` tags and the registry index for `trixie-20261104-slim` (amd64 and arm64 manifests present).
- Debian `madison` API (trixie) for every apt package in the Dockerfile.

## Market template and repositories reviewed

| Template / repo | Licence | Use |
|---|---|---|
| `moli` / `two-workspaces/moli` | none (all rights reserved) | Read for feature expectations only. Nothing copied. |

## Names and affiliation

Moli and Lexmount are names of their respective owners. This is a community template; it is not affiliated with, sponsored or endorsed by Lexmount or Railway. Users are responsible for complying with the terms of the sites they automate and with Railway's Fair Use Policy.
