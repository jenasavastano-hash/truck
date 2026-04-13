const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SALT_ROUNDS = 10;

// Генерация JWT токена. Допускаем дополнительные поля в payload через `extras`.
const generateToken = (userId, role, extras = {}) => {
  const payload = { userId, role, ...extras };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
};

// Хеширование пароля
const hashPassword = (password) => {
  return bcrypt.hashSync(password, SALT_ROUNDS);
};

// Проверка пароля
const comparePassword = (password, hashedPassword) => {
  return bcrypt.compareSync(password, hashedPassword);
};

// Middleware для проверки токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware для проверки роли
const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};

module.exports = {
  generateToken,
  hashPassword,
  comparePassword,
  authenticateToken,
  authorizeRole
};
