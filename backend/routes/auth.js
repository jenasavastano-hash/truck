const express = require('express');
const router = express.Router();
const db = require('../database');
const { generateToken, comparePassword, hashPassword } = require('../auth');

// Регистрация (только водитель). Админов/менеджеров создают через админку: POST /auth/admin/register и /admin/*
router.post('/register', (req, res) => {
  const disabled = process.env.ALLOW_PUBLIC_REGISTER === '0' || process.env.ALLOW_PUBLIC_REGISTER === 'false';
  if (disabled) {
    return res.status(403).json({ error: 'Публичная регистрация отключена' });
  }

  const { username, password, phone, role, mustChangePassword } = req.body;

  if (!username || !password || !phone) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (role !== 'driver') {
    return res.status(403).json({
      error: 'Регистрация доступна только для роли водитель. Учётные записи администратора и менеджера выдаёт администратор.',
    });
  }

  const hashedPassword = hashPassword(password);

  // Проверяем уникальность username и phone
  db.get(
    'SELECT id FROM users WHERE username = ? OR phone = ?',
    [username, phone],
    (checkErr, existing) => {
      if (checkErr) {
        return res.status(500).json({ error: checkErr.message });
      }
      if (existing) {
        return res.status(400).json({ error: 'Пользователь с таким логином или телефоном уже существует' });
      }

      db.run(
        'INSERT INTO users (username, password, phone, role, mustChangePassword) VALUES (?, ?, ?, ?, ?)',
        [username, hashedPassword, phone, 'driver', mustChangePassword ? 1 : 0],
        function (err) {
          if (err) {
            return res.status(500).json({ error: 'Ошибка при создании пользователя' });
          }
          const token = generateToken(this.lastID, 'driver', { mustChangePassword: mustChangePassword ? 1 : 0 });
          res.status(201).json({
            id: this.lastID,
            username,
            phone,
            role: 'driver',
            mustChangePassword: mustChangePassword ? 1 : 0,
            token
          });
        }
      );
    }
  );
});

// Нормализация логина/телефона в только цифры (для входа эвакуаторов и др.)
function loginToDigits(val) {
  if (val == null || typeof val !== 'string') return '';
  return val.replace(/\D/g, '').trim();
}

// Вход (логин = username или номер телефона; для эвакуаторов часто логин/пароль = телефон в цифрах)
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const tryLogin = (user, passwordToTry = password) => {
    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });
    const ok = comparePassword(passwordToTry, user.password) || (loginToDigits(passwordToTry) && comparePassword(loginToDigits(passwordToTry), user.password));
    if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });
    const token = generateToken(user.id, user.role, {
      mustChangePassword: user.mustChangePassword || 0,
      firstLogin: user.firstLogin || 0
    });
    res.json({
      id: user.id,
      username: user.username,
      phone: user.phone,
      role: user.role,
      parkId: user.parkId,
      fullName: user.fullName || null,
      mustChangePassword: user.mustChangePassword || 0,
      firstLogin: user.firstLogin || 0,
      token
    });
  };

  db.get('SELECT * FROM users WHERE username = ?', [String(username).trim()], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (user) return tryLogin(user);
    const digits = loginToDigits(username);
    if (!digits) return res.status(401).json({ error: 'Неверный логин или пароль' });
    db.get('SELECT * FROM users WHERE username = ? OR phone = ?', [digits, digits], (e2, user2) => {
      if (e2) return res.status(500).json({ error: e2.message });
      tryLogin(user2 || null);
    });
  });
});

// Получить текущего пользователя
router.get('/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    db.get(
      'SELECT id, username, phone, role, balance, mustChangePassword, firstLogin FROM users WHERE id = ?',
      [user.userId],
      (err, row) => {
        if (err || !row) {
          return res.status(404).json({ error: 'User not found' });
        }
        // Скользящая сессия: возвращаем свежий токен с актуальными флагами
        const extras = {
          mustChangePassword: row.mustChangePassword || 0,
          firstLogin: row.firstLogin || 0
        };
        // Сохраняем parkId из старого JWT (важно для директора с несколькими парками и impersonate)
        if (user.parkId != null && user.parkId !== '') {
          const pid = parseInt(user.parkId, 10);
          if (!Number.isNaN(pid)) extras.parkId = pid;
        }
        // Роль из подписанного JWT не затираем строкой users.role: при «входе от имени» и при устаревшем role в БД иначе сломается кабинет директора/менеджера после первого /auth/me
        const effectiveRole =
          user.role != null && user.role !== '' ? user.role : row.role;
        const token2 = generateToken(row.id, effectiveRole, extras);
        const out = {
          ...row,
          role: effectiveRole,
          mustChangePassword: row.mustChangePassword || 0,
          firstLogin: row.firstLogin || 0,
          token: token2
        };
        if (extras.parkId != null) out.parkId = extras.parkId;
        res.json(out);
      }
    );
  });
});

// Изменить свои учетные данные (username/password)
router.put('/me/credentials', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });

    const { currentPassword, newPassword } = req.body;
    // Только пароль может быть изменён! Username (логин) не меняется
    if (!newPassword) return res.status(400).json({ error: 'newPassword is required' });

    db.get('SELECT * FROM users WHERE id = ?', [user.userId], (e, row) => {
      if (e || !row) return res.status(404).json({ error: 'User not found' });
      // Разрешаем сменить пароль без старого: при первом входе (firstLogin) или при флаге mustChangePassword
      const allowWithoutCurrent = !!row.firstLogin || !!row.mustChangePassword;
      if (!allowWithoutCurrent && !comparePassword(currentPassword || '', row.password)) {
        return res.status(401).json({ error: 'Current password required to change password' });
      }

      // Хешируем новый пароль
      const hashedPassword = require('../auth').hashPassword(newPassword);
      
      // UPDATE: пароль + очистка флагов (БЕЗ изменения username!)
      db.run(
        'UPDATE users SET password = ?, mustChangePassword = 0, firstLogin = 0 WHERE id = ?',
        [hashedPassword, user.userId],
        function (upErr) {
          if (upErr) return res.status(500).json({ error: upErr.message });
          
          db.get('SELECT id, username, phone, role, mustChangePassword, firstLogin FROM users WHERE id = ?', [user.userId], (gerr, updated) => {
            if (gerr) return res.status(500).json({ error: gerr.message });
            // generate new token with updated flags
            const token2 = generateToken(updated.id, updated.role, { mustChangePassword: updated.mustChangePassword || 0, firstLogin: updated.firstLogin || 0 });
            res.json({ ...updated, token: token2 });
          });
        }
      );
    });
  });
});

// Admin: change other user's credentials
router.put('/users/:id/credentials', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  jwt.verify(token, JWT_SECRET, (err, caller) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    if (caller.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const targetId = parseInt(req.params.id, 10);
    const { newUsername, newPassword, mustChangePassword } = req.body;
    if (!newUsername && !newPassword && typeof mustChangePassword === 'undefined') return res.status(400).json({ error: 'No changes provided' });

    const updates = [];
    const params = [];
    if (newUsername) { updates.push('username = ?'); params.push(newUsername); }
    if (newPassword) { updates.push('password = ?'); params.push(require('../auth').hashPassword(newPassword)); }
    if (typeof mustChangePassword !== 'undefined') { updates.push('mustChangePassword = ?'); params.push(mustChangePassword ? 1 : 0); }
    params.push(targetId);

    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function (upErr) {
      if (upErr) return res.status(500).json({ error: upErr.message });
      db.get('SELECT id, username, phone, role, mustChangePassword FROM users WHERE id = ?', [targetId], (gerr, updated) => {
        if (gerr) return res.status(500).json({ error: gerr.message });
        res.json({ ...updated });
      });
    });
  });
});

// Admin: регистрация нового администратора (только админ может регать админов)
router.post('/admin/register', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });

  const jwt = require('jsonwebtoken');
  const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

  jwt.verify(token, JWT_SECRET, (err, caller) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    if (caller.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

    const { username, password, phone, email } = req.body;
    if (!username || !password || !phone) {
      return res.status(400).json({ error: 'Missing required fields: username, password, phone' });
    }

    const hashedPassword = hashPassword(password);

    // Проверяем уникальность username и phone
    db.get(
      'SELECT id FROM users WHERE username = ? OR phone = ?',
      [username, phone],
      (checkErr, existing) => {
        if (checkErr) {
          return res.status(500).json({ error: checkErr.message });
        }
        if (existing) {
          return res.status(400).json({ error: 'Пользователь с таким логином или телефоном уже существует' });
        }

        db.run(
          `INSERT INTO users (username, password, phone, email, role, mustChangePassword, firstLogin) 
           VALUES (?, ?, ?, ?, 'admin', 1, 1)`,
          [username, hashedPassword, phone, email || null],
          function (err) {
            if (err) {
              return res.status(500).json({ error: 'Ошибка при создании администратора' });
            }
            res.status(201).json({
              id: this.lastID,
              username,
              phone,
              email,
              role: 'admin',
              mustChangePassword: 1,
              firstLogin: 1,
              message: 'Admin registered successfully. Must change password on first login.'
            });
          }
        );
      }
    );
  });
});

module.exports = router;

