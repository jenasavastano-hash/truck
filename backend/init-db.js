/**
 * Инициализация БД: создаёт app.db, таблицы и тестовых пользователей (admin, manager, driver).
 * Запускай один раз перед первым запуском сайта или если видишь "базы нету".
 *
 * Из папки backend: node init-db.js
 * Или из корня: node backend/init-db.js
 */
const path = require('path');

// Запуск из корня проекта или из backend
const backendDir = __dirname;
process.chdir(backendDir);

const db = require('./database');

console.log('Инициализация базы данных...');

db.initializeDB(() => {
  console.log('Миграции применены.');
  db.runSeed();
  // Даём время на асинхронную вставку пользователей и создание тестового парка/водителя
  setTimeout(() => {
    console.log('Готово. Можно запускать сервер (node server.js или start-backend.bat).');
    console.log('Логин: admin / admin, manager / manager, driver / driver');
    console.log('В админке будет 1 парк «Тестовый парк» и водитель driver.');
    process.exit(0);
  }, 4500);
});
