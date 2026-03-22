require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

// ── Security: fail-fast if JWT_SECRET is not set or is the default ────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'change-this-secret' || JWT_SECRET.length < 32) {
  console.error('❌ ERRO FATAL: JWT_SECRET não definido ou inseguro.');
  console.error('   Defina JWT_SECRET no docker-compose.yml com: openssl rand -hex 32');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security Headers (helmet) ─────────────────────────────────────────────────
try {
  const helmet = require('helmet');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'cdn.jsdelivr.net', 'fonts.googleapis.com'],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
} catch {
  // helmet not yet installed — run npm install
  console.warn('[security] helmet not available — run npm install');
}

// ── CORS — restrict to same origin ───────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null; // null = same-origin only (handled by helmet)

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin, mobile, Zabbix webhook, curl)
    if (!origin) return cb(null, true);
    if (!allowedOrigins) return cb(null, true); // no restriction configured
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin not allowed — ${origin}`));
  },
  credentials: true,
}));

// ── Rate limiting on login ────────────────────────────────────────────────────
try {
  const rateLimit = require('express-rate-limit');
  app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  }));
} catch {
  console.warn('[security] express-rate-limit not available');
}

app.use(express.json({ limit: '1mb' })); // reduced from 10mb
app.use(express.static(path.join(__dirname, 'public')));

// ── Public: server timezone info ─────────────────────────────────────────────
app.get('/api/server-info', (req, res) => {
  try {
    const db = require('./database');
    const tz = db.prepare("SELECT value FROM settings WHERE key='timezone'").get()?.value || 'UTC';
    res.json({ timezone: tz, now: new Date().toISOString() });
  } catch { res.json({ timezone: 'UTC', now: new Date().toISOString() }); }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/waha-sessions', require('./routes/waha'));
app.use('/api/destinations', require('./routes/destinations'));
app.use('/api/tag-mappings', require('./routes/tagMappings'));
app.use('/api/global-tags', require('./routes/globalTags'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api', require('./routes/misc'));

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error handler — never leak internal details in production ─────────────────
app.use((err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  console.error('[error]', err.message);
  res.status(500).json({
    error: 'Internal server error',
    ...(isDev && { detail: err.message }),
  });
});

require('./services/queueService').start();
require('./services/logCleanupService').start();

app.listen(PORT, () => {
  console.log(`🚀 ZabbixWA v1.4.1 running on port ${PORT}`);
  console.log(`📊 Admin Panel: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/api/webhook/zabbix`);
});
