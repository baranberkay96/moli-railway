# syntax=docker/dockerfile:1
#
# Moli headless browser for Railway, behind a token gate.
#   - Moli 1.1.22 (Lexmount, Apache-2.0 OR MIT): prebuilt release binary,
#     SHA-256 pinned. `moli serve` listens on 127.0.0.1:9222 only.
#   - moli-gate (this repo, Node.js standard library only): the public
#     listener on $PORT. Checks the token, rewrites CDP discovery URLs to the
#     public address, limits and times out sessions, and supervises Moli.
#   - Node.js LTS: official nodejs.org tarball, SHA-256 pinned (binary only).
#   - Fonts for screenshots and layout geometry (Liberation = Arial/Times/
#     Courier metrics, Noto for other scripts, CJK and emoji).
# No volume: browser profiles are temporary, as in a fresh incognito session.
#
# Base image pinned by dated tag and digest (Docker Hub library/debian,
# trixie-20261104-slim, checked 2026-11-07). Moli's Linux build needs
# glibc >= 2.35 (it is built on Debian bookworm); trixie ships 2.41.
FROM debian:trixie-20261104-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2

# Pinned versions. Bump deliberately; checksums must match the new release.
# (PIN_ prefix keeps build args from colliding with tools' env variables.)
ARG PIN_MOLI=1.1.22
ARG PIN_MOLI_SHA256_AMD64=7e10f9a5b62371da56203b21ac0172bbe3c3626de189fc3742b91b2e2b8cdd39
ARG PIN_MOLI_SHA256_ARM64=a199802d237fff981cb5a72ac075813af2510f5a4b51ce182d8fc18b5520210b
ARG PIN_NODE=24.22.2
ARG PIN_NODE_SHA256_AMD64=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
ARG PIN_NODE_SHA256_ARM64=eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TZ=UTC

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Runtime libraries Moli links against (libstdc++, libgcc_s, zlib,
# fontconfig), CA certificates for HTTPS, tini, and fonts. Debian archive
# packages, not version-pinned: the base image digest fixes the release.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates tini \
      libstdc++6 libgcc-s1 zlib1g libfontconfig1 fontconfig \
      fonts-dejavu-core fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && fc-cache -f > /dev/null \
 && rm -rf /var/lib/apt/lists/*

# Moli and Node.js release downloads, checksum-verified. curl and xz are
# only needed here and are removed again. Every download retries: a dropped
# connection would fail the whole build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl xz-utils \
 && case "$(dpkg --print-architecture)" in \
      amd64) moli_target=x86_64-unknown-linux-gnu;  moli_sha="${PIN_MOLI_SHA256_AMD64}"; node_arch=x64;   node_sha="${PIN_NODE_SHA256_AMD64}" ;; \
      arm64) moli_target=aarch64-unknown-linux-gnu; moli_sha="${PIN_MOLI_SHA256_ARM64}"; node_arch=arm64; node_sha="${PIN_NODE_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --retry 5 --retry-all-errors -o /tmp/moli.tar.gz \
      "https://github.com/lexmount/moli/releases/download/v${PIN_MOLI}/moli-${moli_target}.tar.gz" \
 && echo "${moli_sha}  /tmp/moli.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/moli.tar.gz -C /tmp --no-same-owner \
 && moli_dir="/tmp/moli-v${PIN_MOLI}-${moli_target}" \
 && test "$(cat "${moli_dir}/VERSION")" = "${PIN_MOLI}" \
 && install -m 0755 "${moli_dir}/moli" /usr/local/bin/moli \
 && install -d -m 0755 /usr/local/share/doc/moli/licenses \
 && install -m 0644 "${moli_dir}/LICENSE-APACHE" "${moli_dir}/LICENSE-MIT" "${moli_dir}/license-metadata.json" "${moli_dir}/VERSION" /usr/local/share/doc/moli/ \
 && install -m 0644 "${moli_dir}"/licenses/* /usr/local/share/doc/moli/licenses/ \
 && rm -rf /tmp/moli.tar.gz "${moli_dir}" \
 && curl -fsSL --retry 5 --retry-all-errors -o /tmp/node.tar.xz \
      "https://nodejs.org/dist/v${PIN_NODE}/node-v${PIN_NODE}-linux-${node_arch}.tar.xz" \
 && echo "${node_sha}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /tmp --no-same-owner \
      "node-v${PIN_NODE}-linux-${node_arch}/bin/node" "node-v${PIN_NODE}-linux-${node_arch}/LICENSE" \
 && install -m 0755 "/tmp/node-v${PIN_NODE}-linux-${node_arch}/bin/node" /usr/local/bin/node \
 && install -d -m 0755 /usr/local/share/doc/nodejs \
 && install -m 0644 "/tmp/node-v${PIN_NODE}-linux-${node_arch}/LICENSE" /usr/local/share/doc/nodejs/LICENSE \
 && rm -rf /tmp/node.tar.xz "/tmp/node-v${PIN_NODE}-linux-${node_arch}" \
 && apt-get purge -y --auto-remove curl xz-utils \
 && rm -rf /var/lib/apt/lists/* \
 && moli --version | grep -F "${PIN_MOLI}" \
 && node --version | grep -Fx "v${PIN_NODE}"

# Unprivileged runtime user; nothing in this image needs root at run time.
RUN groupadd --system --gid 10001 moli \
 && useradd --system --uid 10001 --gid 10001 --home-dir /home/moli --create-home --shell /usr/sbin/nologin moli

# The gate. COPY without --chmod: the new directories stay 0755.
COPY gate/package.json /opt/moli-gate/package.json
COPY gate/src/ /opt/moli-gate/src/
RUN chmod -R a+rX,go-w /opt/moli-gate \
 && node /opt/moli-gate/src/selftest.js

ENV PORT=8080 \
    HOME=/home/moli \
    NO_COLOR=1 \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

USER 10001:10001
WORKDIR /home/moli
EXPOSE 8080

# Railway runs its own init as PID 1, so tini runs as a subreaper (-s).
# The gate (node) listens on $PORT, starts `moli serve` on loopback and
# restarts it if it exits; SIGTERM stops both.
ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/usr/local/bin/node", "/opt/moli-gate/src/main.js"]
