/**
 * Обновление пароля администратора
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcryptjs = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);

const adminPassword = 'admin';
const hashedPassword = bcryptjs.hashSync(adminPassword, 10);

// Обновляем пароль админа
db.run(
  'UPDATE users SET password = ? WHERE username = ?',
  [hashedPassword, 'admin'],
  function(err) {
    if (err) {
      console.error('❌ Ошибка при обновлении пароля:', err);
    } else {
      console.log('✅ Пароль администратора обновлён!');
      console.log(`   Username: admin`);
      console.log(`   Password: ${adminPassword}`);
    }
    db.close();
  }
);
