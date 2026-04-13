/**
 * Единый корень API (должен совпадать с frontend/src/api.js).
 * Если в .env указали только хост:порт без /api — добавляем /api, иначе запросы уходят на /manager/... и дают 404.
 */
export function getResolvedApiRoot() {
  const raw =
    import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api');
  let s = String(raw).replace(/\/$/, '');
  if (!s.endsWith('/api')) {
    s = `${s}/api`;
  }
  return s;
}
