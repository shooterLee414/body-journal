#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  exec node server.mjs
fi
runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ -x "$runtime" ]; then
  exec "$runtime" server.mjs
fi
echo '需要 Node.js 22.13 或更新版本（推荐 Node.js 24）。' >&2
exit 1
