/**
 * Утилиты для работы с московским временем (МСК, UTC+3)
 * ВАЖНО: Весь бот работает с временем по МСК!
 */

/**
 * Получить текущую дату в формате YYYY-MM-DD по МСК
 * @returns {string} Дата в формате YYYY-MM-DD
 */
function getMoscowDate() {
  const now = new Date();
  // МСК = UTC+3, используем toLocaleDateString для правильной конвертации
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' }); // en-CA дает формат YYYY-MM-DD
}

/**
 * Получить текущее время в формате HH:MM по МСК
 * @returns {string} Время в формате HH:MM
 */
function getMoscowTime() {
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
 * Получить текущее время в формате HH:MM:SS по МСК
 * @returns {string} Время в формате HH:MM:SS
 */
function getMoscowTimeFull() {
  const now = new Date();
  const moscowTime = now.toLocaleTimeString('en-US', { 
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return moscowTime;
}

/**
 * Получить текущую дату и время в формате ISO по МСК
 * @returns {string} Дата и время в формате ISO
 */
function getMoscowISOString() {
  const now = new Date();
  // Получаем компоненты МСК времени
  const moscowDate = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
  const moscowTime = now.toLocaleTimeString('en-US', { 
    timeZone: 'Europe/Moscow',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `${moscowDate}T${moscowTime}.000Z`;
}

/**
 * Получить начало дня по МСК для указанной даты
 * @param {string} date - Дата в формате YYYY-MM-DD (опционально, по умолчанию сегодня)
 * @returns {Date} Дата начала дня по МСК
 */
function getMoscowDayStart(date = null) {
  const targetDate = date || getMoscowDate();
  const [year, month, day] = targetDate.split('-').map(Number);
  // Создаем дату в МСК (UTC+3)
  const moscowDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // Вычитаем 3 часа чтобы получить UTC
  moscowDate.setUTCHours(moscowDate.getUTCHours() - 3);
  return moscowDate;
}

/**
 * Получить конец дня по МСК для указанной даты
 * @param {string} date - Дата в формате YYYY-MM-DD (опционально, по умолчанию сегодня)
 * @returns {Date} Дата конца дня по МСК
 */
function getMoscowDayEnd(date = null) {
  const targetDate = date || getMoscowDate();
  const [year, month, day] = targetDate.split('-').map(Number);
  // Создаем дату конца дня в МСК (UTC+3)
  const moscowDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  // Вычитаем 3 часа чтобы получить UTC
  moscowDate.setUTCHours(moscowDate.getUTCHours() - 3);
  return moscowDate;
}

/**
 * Конвертировать дату в МСК время
 * @param {Date|string} date - Дата для конвертации
 * @returns {Date} Дата в МСК
 */
function toMoscowTime(date) {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
}

/**
 * Получить SQL фильтр для даты по МСК
 * SQLite хранит даты в UTC, поэтому нужно конвертировать
 * @param {string} date - Дата в формате YYYY-MM-DD
 * @param {string} columnName - Имя колонки в БД
 * @returns {string} SQL условие
 */
function getMoscowDateFilter(columnName, date = null) {
  const targetDate = date || getMoscowDate();
  // МСК = UTC+3, поэтому начало дня МСК = 21:00 предыдущего дня UTC
  // Конец дня МСК = 20:59:59 текущего дня UTC
  const [year, month, day] = targetDate.split('-').map(Number);
  
  // Начало дня МСК: YYYY-MM-DD 00:00:00 МСК = YYYY-MM-DD-1 21:00:00 UTC (если день > 1)
  const startUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  startUTC.setUTCHours(startUTC.getUTCHours() - 3);
  
  // Конец дня МСК: YYYY-MM-DD 23:59:59 МСК = YYYY-MM-DD 20:59:59 UTC
  const endUTC = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  endUTC.setUTCHours(endUTC.getUTCHours() - 3);
  
  const startStr = startUTC.toISOString().replace('T', ' ').substring(0, 19);
  const endStr = endUTC.toISOString().replace('T', ' ').substring(0, 19);
  
  return `${columnName} >= '${startStr}' AND ${columnName} <= '${endStr}'`;
}

/**
 * Получить SQL фильтр для периода по МСК
 * @param {string} columnName - Имя колонки в БД
 * @param {string} startDate - Начальная дата YYYY-MM-DD
 * @param {string} endDate - Конечная дата YYYY-MM-DD
 * @returns {string} SQL условие
 */
function getMoscowPeriodFilter(columnName, startDate, endDate) {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const startUTC = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0));
  startUTC.setUTCHours(startUTC.getUTCHours() - 3);
  
  const [ey, em, ed] = endDate.split('-').map(Number);
  const endUTC = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999));
  endUTC.setUTCHours(endUTC.getUTCHours() - 3);
  
  const startStr = startUTC.toISOString().replace('T', ' ').substring(0, 19);
  const endStr = endUTC.toISOString().replace('T', ' ').substring(0, 19);
  
  return `${columnName} >= '${startStr}' AND ${columnName} <= '${endStr}'`;
}

/**
 * Дата последней пятницы по МСК (включительно). Если сегодня пятница — возвращаем сегодня.
 * @param {string} moscowDateStr - Дата в формате YYYY-MM-DD (по МСК), обычно «сегодня»
 * @returns {string} YYYY-MM-DD последней пятницы
 */
function getLastFriday(moscowDateStr) {
  const [y, m, d] = moscowDateStr.split('-').map(Number);
  // 00:00 МСК на дату (y,m,d) = 21:00 UTC предыдущего дня
  const utcMidnightMoscow = new Date(Date.UTC(y, m - 1, d - 1, 21, 0, 0, 0));
  const dow = utcMidnightMoscow.getUTCDay(); // 0=Вс, 5=Пт, 6=Сб
  const back = dow === 5 ? 0 : dow === 6 ? 1 : dow + 2;
  const lastFri = new Date(Date.UTC(y, m - 1, d - back));
  return lastFri.toISOString().split('T')[0];
}

module.exports = {
  getMoscowDate,
  getMoscowTime,
  getMoscowTimeFull,
  getMoscowISOString,
  getMoscowDayStart,
  getMoscowDayEnd,
  toMoscowTime,
  getMoscowDateFilter,
  getMoscowPeriodFilter,
  getLastFriday
};
