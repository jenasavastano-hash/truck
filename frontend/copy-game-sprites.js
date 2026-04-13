/**
 * Копирует спрайты игры из папки Cursor assets в frontend/public/game/
 * Запуск: из папки frontend выполни:  node copy-game-sprites.js
 *
 * Папка-источник по умолчанию (Windows):
 *   C:\Users\<USER>\.cursor\projects\c-Users-Desktop-1\assets
 * Можно задать свою:  set CURSOR_ASSETS=D:\path\to\assets  и снова запустить.
 */

const fs = require('fs');
const path = require('path');

const userHome = process.env.USERPROFILE || process.env.HOME || '';
const defaultSource = path.join(userHome, '.cursor', 'projects', 'c-Users-Desktop-1', 'assets');
const sourceDir = process.env.CURSOR_ASSETS || defaultSource;

const destDir = path.join(__dirname, 'public', 'game');

// Имя в папке assets → имя в public/game (если отличается)
const files = [
  'truck.png',
  'taxi.png',
  'taxi_sprite.png',  // альтернатива / запасной спрайт
  'coin.png',
  'coin_sprite.png',
  'obstacle.png',
  'obstacle_sprite.png',
  'obstacle_bus.png',
  'obstacle_truck.png',
  'obstacle_car_red.png',
  'obstacle_car_blue.png',
  'road_edge_left.png',
  'road_edge_right.png',
];

const nameMap = {
  taxi_sprite: 'taxi',
  coin_sprite: 'coin',
  obstacle_sprite: 'obstacle',
};

if (!fs.existsSync(sourceDir)) {
  console.log('Папка-источник не найдена:', sourceDir);
  console.log('Задай путь: set CURSOR_ASSETS=путь\\к\\папке\\assets');
  process.exit(1);
}

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

let copied = 0;
for (const file of files) {
  const srcPath = path.join(sourceDir, file);
  let destName = file;
  if (nameMap[file.replace('.png', '')]) destName = nameMap[file.replace('.png', '')] + '.png';
  const destPath = path.join(destDir, destName);

  if (fs.existsSync(srcPath)) {
    try {
      fs.copyFileSync(srcPath, destPath);
      console.log('OK:', file, '->', destName);
      copied++;
    } catch (e) {
      console.error('Ошибка при копировании', file, e.message);
    }
  }
}

// Если есть taxi.png, но нет truck.png — дублируем для грузового спрайта игрока
const truckDest = path.join(destDir, 'truck.png');
const taxiDest = path.join(destDir, 'taxi.png');
if (!fs.existsSync(truckDest) && fs.existsSync(taxiDest)) {
  try {
    fs.copyFileSync(taxiDest, truckDest);
    console.log('OK: taxi.png -> truck.png (дубликат для демо грузовика)');
  } catch (e) {
    console.error('Не удалось создать truck.png из taxi.png:', e.message);
  }
}

console.log('');
console.log('Скопировано файлов:', copied);
console.log('Папка назначения:', destDir);
console.log('Обнови страницу игры (F5), чтобы увидеть спрайты.');
