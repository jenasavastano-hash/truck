/**
 * Уведомление водителю при создании смены: «Ваша смена закроется в [ВРЕМЯ] (МСК). …»
 * Время = shiftStart + 12 часов, формат МСК. documentPdfReceivedAt/approvedAt из БД считаем UTC (без Z).
 */
function parseUtc(createdAt) {
  if (!createdAt) return null;
  const s = String(createdAt).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  const withZ = s.includes('T') ? s.replace(/\.\d{3}$/, '') + 'Z' : s.replace(' ', 'T') + 'Z';
  return new Date(withZ);
}

function formatTimeMsk(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }) + ' (МСК)';
}

function insertShiftWillCloseNotification(db, userId, eplId, eplCreatedAt, callback) {
  const created = parseUtc(eplCreatedAt);
  if (!created || isNaN(created.getTime())) {
    if (typeof callback === 'function') callback();
    return;
  }
  const closeAt = new Date(created.getTime() + 12 * 60 * 60 * 1000);
  const closeAtStr = formatTimeMsk(closeAt);
  const nowStr = formatTimeMsk(new Date());
  const body = `Ваша смена закроется в ${closeAtStr}. Закройте её раньше сами — иначе автозакрытие и списание 10₽ с баланса. Уведомление: ${nowStr}.`;
  db.run(
    'INSERT INTO notifications (userId, type, title, body, eplId) VALUES (?, ?, ?, ?, ?)',
    [userId, 'shift_will_close', 'Смена', body, eplId],
    callback || (() => {})
  );
}

module.exports = { insertShiftWillCloseNotification };
