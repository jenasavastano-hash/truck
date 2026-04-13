/**
 * Утилиты для работы с московским временем (МСК, UTC+3)
 * ВАЖНО: Весь бот работает с временем по МСК!
 */

/**
 * Получить текущую дату в формате YYYY-MM-DD по МСК
 * @returns {string} Дата в формате YYYY-MM-DD
 */
export function getMoscowDate() {
  const now = new Date();
  // МСК = UTC+3
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

/**
 * Получить текущее время в формате HH:MM по МСК
 * @returns {string} Время в формате HH:MM
 */
export function getMoscowTime() {
  const now = new Date();
  const moscowTime = now.toLocaleTimeString('en-US', { 
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  return moscowTime;
}

/**
 * Получить текущий час по МСК
 * @returns {number} Час (0-23)
 */
export function getMoscowHour() {
  const now = new Date();
  return parseInt(now.toLocaleTimeString('en-US', { 
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit'
  }), 10);
}

/**
 * Получить приветствие по времени суток МСК
 * @returns {string} Приветствие
 */
export function getMoscowGreeting() {
  const hour = getMoscowHour();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 22) return 'Добрый вечер';
  return 'Доброй ночи';
}

export default {
  getMoscowDate,
  getMoscowTime,
  getMoscowHour,
  getMoscowGreeting
};
