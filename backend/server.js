const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./database');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const adminStatsRoutes = require('./routes/admin-stats');
const adminEvacuatorRoutes = require('./routes/admin-evacuator');
const adminCommissionerRoutes = require('./routes/admin-commissioner');
const adminDriversMonitoringRoutes = require('./routes/admin-drivers-monitoring');
const adminFinanceRoutes = require('./routes/admin-finance');
const workerRoutes = require('./routes/worker');
const managerRoutes = require('./routes/manager');
const driverRoutes = require('./routes/driver');
const evacuatorRoutes = require('./routes/evacuator');
const commissionerRoutes = require('./routes/commissioner');
const signerRoutes = require('./routes/signer');
const clinicRoutes = require('./routes/clinic');
const directorRoutes = require('./routes/director');
const crmLeadsRoutes = require('./routes/crm-leads');

const app = express();
const PORT = process.env.PORT || 5000;

const corsAllowList = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'https://astounding-mooncake-f09034.netlify.app',
]);
if (process.env.CORS_ORIGINS) {
  process.env.CORS_ORIGINS.split(',').forEach((s) => {
    const t = s.trim();
    if (t) corsAllowList.add(t);
  });
}
function corsOriginValidator(origin, callback) {
  if (!origin) return callback(null, true);
  if (corsAllowList.has(origin)) return callback(null, true);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return callback(null, true);
  return callback(null, false);
}

const DEFAULT_JWT = 'your-secret-key-change-in-production';
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT) {
    console.error('[FATAL] В production задайте уникальный JWT_SECRET в .env (не используйте значение по умолчанию).');
    process.exit(1);
  }
} else if (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEFAULT_JWT) {
  console.warn('[WARN] JWT_SECRET не задан — токены предсказуемы. Только для локальной разработки.');
}

// Middleware
// CORS: localhost (любой порт), Netlify preview, плюс CORS_ORIGINS из .env (ваш будущий домен)
app.use(cors({
  origin: corsOriginValidator,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// Лимит 10mb — для POST /api/clinic/epl-created с documentPdf (base64 PDF)
app.use(express.json({ limit: '10mb' }));

// Логирование запросов
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', adminStatsRoutes);
app.use('/api/admin', adminEvacuatorRoutes);
app.use('/api/admin', adminCommissionerRoutes);
app.use('/api/admin', adminDriversMonitoringRoutes);
app.use('/api/admin', adminFinanceRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/evacuator', evacuatorRoutes);
app.use('/api/commissioner', commissionerRoutes);
app.use('/api/signer', signerRoutes);
app.use('/api/worker', workerRoutes);
app.use('/api/clinic', clinicRoutes);
app.use('/api/director', directorRoutes);
app.use('/api/crm', crmLeadsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Публичная отдача PDF по токену (для QR «открыть документ»)
app.get('/api/public/epl-document/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const token = (req.query.token || '').trim();
  if (!id || !token) {
    return res.status(400).send('Не указан id или token');
  }
  db.get('SELECT documentPdf, documentToken, waybillNumber FROM epl WHERE id = ?', [id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).send('Документ не найден');
    if (row.documentToken !== token) return res.status(403).send('Неверная ссылка');
    if (!row.documentPdf) return res.status(404).send('Документ ещё не загружен');
    const pdfBuffer = Buffer.from(row.documentPdf, 'base64');
    const filename = (row.waybillNumber || `waybill-${id}`).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Джоб: уведомление за 1 ч до истечения ЭПЛ и авто-закрытие смены через 12 ч
const eplExpiryJob = require('./services/epl-expiry-job');
// Джоб: раз в 10 мин запрос QR по API Такском для ЭПЛ без QR (не блокирует создание ЭПЛ)
const qrFetchJob = require('./services/qr-fetch-job');
// Джоб: уведомление водителю за N ч до окончания фотоконтроля
const fcExpiryJob = require('./services/fc-expiry-job');
// Джоб: раз в 5 мин генерация QR на PDF для ЭПЛ с PDF без documentQr
const documentQrJob = require('./services/document-qr-job');
const { CANCELABLE_BEFORE_TAXCOM, sqlQuoteList } = require('./utils/epl-status');

// Периодическая очистка зависших ЭПЛ (каждые 5 мин).
// ВАЖНО: здесь мы больше не трогаем таблицу shifts, чтобы не закрывать смены
// автоматически только из-за статуса failed/rejected ЭПЛ. Смена закрывается
// либо вручную водителем, либо джобом epl-expiry-job по истечению 12 часов.
function cleanupStuckEpls() {
  if (!db || !db.run) return;
  db.run(
    `UPDATE epl SET status = 'failed', errorMessage = 'Заявка не была создана (истекло время)' 
     WHERE status IN (${sqlQuoteList(CANCELABLE_BEFORE_TAXCOM)}) AND (mintransId IS NULL OR mintransId = '') 
     -- В режиме taxcom_only нет fast-PDF, поэтому создание может занять дольше. Не автозакрываем такие заявки таймаутом 30 мин.
     AND (SELECT COALESCE(eplPrintMode, 'our_then_taxcom') FROM parks p WHERE p.id = epl.parkId) != 'taxcom_only'
     AND createdAt < datetime('now', '-30 minutes')`,
    function(err) {
      if (err) return console.error('[Cleanup] EPL cleanup error:', err.message);
      if (this.changes > 0) console.log(`[Cleanup] Закрыто зависших ЭПЛ: ${this.changes}`);
    }
  );
}

// Старт только после завершения миграций БД
db.initializeDB(() => {
  db.runSeed();
  eplExpiryJob.start();
  qrFetchJob.start();
  fcExpiryJob.start();
  documentQrJob.start();
  // Первая очистка сразу при старте, потом каждые 5 мин
  cleanupStuckEpls();
  setInterval(cleanupStuckEpls, 5 * 60 * 1000);
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Порт ${PORT} занят. Закройте другое приложение на этом порту или задайте PORT в .env`);
    } else {
      console.error('Ошибка сервера:', err.message);
    }
    process.exit(1);
  });
});
