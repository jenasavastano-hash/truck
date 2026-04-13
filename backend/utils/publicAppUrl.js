'use strict';

/**
 * Публичный базовый URL приложения (QR, ссылки в PDF).
 * В production задайте PUBLIC_APP_URL или API_URL в .env — без привязки к старому домену.
 */
function publicAppUrl() {
  const fromEnv = process.env.PUBLIC_APP_URL || process.env.API_URL;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).replace(/\/$/, '');
  }
  const port = process.env.PORT || 5000;
  return `http://127.0.0.1:${port}`;
}

module.exports = { publicAppUrl };
