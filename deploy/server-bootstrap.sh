#!/bin/bash
# Первичная настройка VPS (Ubuntu/Debian) под грузовые ЭПЛ.
# Запуск на сервере под root:  bash server-bootstrap.sh
# Опционально: DOMAIN и IP  —  bash server-bootstrap.sh truckdriver.online 212.119.42.239
set -euo pipefail

DOMAIN="${1:-truckdriver.online}"
SERVER_IP="${2:-212.119.42.239}"

echo "==> apt update"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

echo "==> nginx + curl"
apt-get install -y -qq nginx curl ca-certificates

echo "==> Node.js 20.x (NodeSource)"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
elif [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
node -v
npm -v

echo "==> pm2"
npm install -g pm2

echo "==> nginx: сайт taxi, фронт /root/dist, API :5000"
rm -f /etc/nginx/sites-enabled/default

cat > /etc/nginx/sites-available/taxi << NGINX_EOF
server {
    listen 80;
    server_name ${DOMAIN} www.${DOMAIN} ${SERVER_IP};
    root /root/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX_EOF

ln -sf /etc/nginx/sites-available/taxi /etc/nginx/sites-enabled/taxi
nginx -t
systemctl reload nginx

echo "==> Python + PyMuPDF (fast EPL PDF)"
apt-get install -y -qq python3 python3-pip fonts-liberation 2>/dev/null || true
pip3 install PyMuPDF 2>/dev/null || pip install PyMuPDF 2>/dev/null || true

echo ""
echo "Готово. Дальше с Windows в корне проекта:"
echo "  deploy-full.cmd <пароль_SSH>"
echo "Потом на сервере проверьте /root/backend/.env — PUBLIC_APP_URL и FRONTEND_URL с доменом."
echo "HTTPS: certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo ""
