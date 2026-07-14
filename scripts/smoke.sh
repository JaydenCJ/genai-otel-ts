#!/usr/bin/env bash
# Smoke test: build the package, then exercise the built ESM/CJS artifacts
# end-to-end (spans + metrics) with an in-memory OTel exporter.
# Self-asserting, idempotent, no network access.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "[smoke] node_modules missing — run 'npm install' first" >&2
  exit 1
fi

echo "[smoke] building dist/ ..."
npm run --silent build >/dev/null

node scripts/smoke.mjs

echo "SMOKE OK"
