#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# One-command local run: serves this folder on http://localhost:8000 and opens it.
# Extra args are passed to the server, e.g. ./run.sh --port 8001 --no-open
exec node server.mjs --port 8000 "$@"
