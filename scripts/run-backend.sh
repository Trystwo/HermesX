#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/bianxd/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /home/bianxd/hermesx/backend
set -a
# shellcheck disable=SC1091
source /home/bianxd/hermesx/.env
set +a
exec npm run start
