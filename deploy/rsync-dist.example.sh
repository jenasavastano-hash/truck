#!/usr/bin/env bash
# Пример: выкладка frontend/dist на VPS. Скопируй в rsync-dist.sh, заполни переменные, chmod +x, запускай из frontend/ после npm run build.
set -euo pipefail

REMOTE_USER_HOST="deploy@YOUR_SERVER_IP"
REMOTE_DIST_PATH="/root/dist"

cd "$(dirname "$0")/../frontend"
npm ci
npm run build
rsync -avz --delete ./dist/ "${REMOTE_USER_HOST}:${REMOTE_DIST_PATH}/"
echo "OK. На сервере: ssh ${REMOTE_USER_HOST} 'sudo nginx -t && sudo systemctl reload nginx'"
