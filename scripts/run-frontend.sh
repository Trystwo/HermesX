#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/bianxd/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /home/bianxd/hermesx/frontend
exec npx vite --host 0.0.0.0 --port 5173
