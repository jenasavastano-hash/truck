/** Продакшен-кабинеты; переопределяются через VITE_TAXI_LOGIN_URL / VITE_FREIGHT_LOGIN_URL при необходимости */
const taxiLoginDefault = 'https://taxidriver.space/login';
const freightLoginDefault = 'https://truckdriver.online/login';

export const loginDirections = [
  {
    id: 'taxi',
    title: 'Такси',
    description: 'Парк или частник — кабинет такси.',
    url: import.meta.env.VITE_TAXI_LOGIN_URL || taxiLoginDefault,
  },
  {
    id: 'freight',
    title: 'Грузовые ЭПЛ',
    description: 'ЭПЛ и ЭТРН для грузоперевозок.',
    url: import.meta.env.VITE_FREIGHT_LOGIN_URL || freightLoginDefault,
  },
];

export const registrationTypes = [
  {
    id: 'taxi-private',
    title: 'Такси частник',
    shortDescription: 'Самозанятый водитель такси.',
    points: ['Быстрый старт', 'ЭДО и рейсы в одном кабинете', 'Запуск по регламенту'],
  },
  {
    id: 'taxi-park',
    title: 'Такси парк',
    shortDescription: 'Операторы и руководители парка.',
    points: ['Массово водители и статусы', 'Заявки и документы', 'Аналитика для руководства'],
  },
  {
    id: 'freight-park',
    title: 'Грузовые парк',
    shortDescription: 'Логистика и транспортные парки.',
    points: ['ЭПЛ и ЭТРН под рейсы', 'Клиника и ЭДО-оператор', 'Быстрее выдача и закрытие документов'],
  },
  {
    id: 'freight-private',
    title: 'Грузовые частник',
    shortDescription: 'ИП и частный перевозчик.',
    points: ['Вход в цифровой контур', 'Меньше ручной работы', 'Масштаб при росте заказов'],
  },
  {
    id: 'mini-business',
    title: 'Малый бизнес: ЭДО и Честный Знак',
    shortDescription: 'Малый объём — ЭДО и маркировка.',
    points: ['ЭДО и уведомления по регламенту', 'Честный Знак', 'Запуск с поддержкой'],
  },
];

export function isExternalUrl(url) {
  return /^https?:\/\//i.test(url);
}

export function getRegistrationTypeById(typeId) {
  return registrationTypes.find((item) => item.id === typeId) || null;
}
