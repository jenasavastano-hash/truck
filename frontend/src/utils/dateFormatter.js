/**
 * Date formatting utilities
 * Centralized date formatting to avoid duplication across components
 */

/**
 * Парсит дату от бэкенда: SQLite отдаёт UTC без "Z", браузер иначе считает локальным.
 * @param {string} s - ISO или "YYYY-MM-DD HH:MM:SS"
 * @returns {Date|null}
 */
export function parseUtc(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(str)) return new Date(str);
  const withZ = str.includes('T') ? str + (str.includes('.') ? '' : '.000') + 'Z' : str.replace(' ', 'T') + 'Z';
  return new Date(withZ);
}

/**
 * Формат даты/времени в МСК для отображения (бэкенд отдаёт UTC).
 * @param {string|Date} s
 * @returns {string} "ДД.ММ.ГГГГ, ЧЧ:ММ (МСК)"
 */
export function formatDateMsk(s) {
  const d = parseUtc(s);
  if (!d || isNaN(d.getTime())) return '—';
  const str = d.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `${str} (МСК)`;
}

/**
 * Format date for display in UI
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string (e.g., "12.05.2024 14:30")
 */
export function formatDisplayDate(date) {
  if (!date) return '—';
  
  try {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    
    return `${day}.${month}.${year} ${hours}:${minutes}`;
  } catch (e) {
    return '—';
  }
}

/**
 * Format date for ISO display (YYYY-MM-DD)
 * @param {string|Date} date - The date to format
 * @returns {string} ISO date string
 */
export function formatISODate(date) {
  if (!date) return '—';
  
  try {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  } catch (e) {
    return '—';
  }
}

/**
 * Format date in Russian locale
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string in Russian (e.g., "12 мая 2024")
 */
export function formatRussianDate(date) {
  if (!date) return '—';
  
  try {
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (e) {
    return '—';
  }
}

/**
 * Format time only (HH:MM)
 * @param {string|Date} date - The date to extract time from
 * @returns {string} Time string (e.g., "14:30")
 */
export function formatTime(date) {
  if (!date) return '—';
  
  try {
    const d = new Date(date);
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch (e) {
    return '—';
  }
}

/**
 * Format date and time in full Russian format
 * @param {string|Date} date - The date to format
 * @returns {string} Full formatted string (e.g., "12 мая 2024 в 14:30")
 */
export function formatFullDateTime(date) {
  if (!date) return '—';
  
  try {
    const russianDate = formatRussianDate(date);
    const time = formatTime(date);
    return `${russianDate} в ${time}`;
  } catch (e) {
    return '—';
  }
}

/**
 * Get relative time (e.g., "2 hours ago")
 * @param {string|Date} date - The date to compare
 * @returns {string} Relative time string
 */
export function formatRelativeTime(date) {
  if (!date) return '—';
  
  try {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return formatDisplayDate(date);
  } catch (e) {
    return '—';
  }
}

/**
 * Format date for notification list: "Сегодня, 14:30" / "Вчера, 09:15" / "27.02.2026, 14:30 (МСК)"
 * Uses Europe/Moscow for day comparison.
 */
export function formatNotificationTime(s) {
  const d = parseUtc(s);
  if (!d || isNaN(d.getTime())) return '—';
  const timeStr = d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  if (dateStr === todayStr) return `Сегодня, ${timeStr}`;
  if (dateStr === yesterdayStr) return `Вчера, ${timeStr}`;
  return formatDateMsk(s);
}

export default {
  parseUtc,
  formatDateMsk,
  formatDisplayDate,
  formatISODate,
  formatRussianDate,
  formatTime,
  formatFullDateTime,
  formatRelativeTime,
  formatNotificationTime
};
