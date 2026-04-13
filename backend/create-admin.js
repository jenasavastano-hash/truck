/**
 * Создание администратора в БД
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcryptjs = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'app.db');
const db = new sqlite3.Database(DB_PATH);

const adminPassword = 'admin';
const hashedPassword = bcryptjs.hashSync(adminPassword, 10);

// Проверим есть ли уже админ
db.get('SELECT id, username FROM users WHERE role = ?', ['admin'], (err, row) => {
  if (err) {
    console.error('Ошибка при проверке:', err);
    db.close();
    return;
  }

  if (row) {
    console.log('✅ Администратор уже существует:');
    console.log(`   Username: ${row.username}`);
    console.log(`   ID: ${row.id}`);
    db.close();
    return;
  }

  // Создаём админа
  db.run(
    `INSERT INTO users (username, password, role, fullName, mustChangePassword, firstLogin) 
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['admin', hashedPassword, 'admin', 'Администратор', 0, 0],
    function(err) {
      if (err) {
        console.error('❌ Ошибка при создании администратора:', err);
      } else {
        console.log('✅ Администратор создан успешно!');
        console.log(`   Username: admin`);
        console.log(`   Password: ${adminPassword}`);
        console.log(`   ID: ${this.lastID}`);
      }
      db.close();
    }
  );
});
