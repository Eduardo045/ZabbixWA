const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || './data/zabbix-whatsapp.db';
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'operator',
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS waha_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      api_url TEXT NOT NULL,
      api_key TEXT DEFAULT '',
      session_name TEXT NOT NULL DEFAULT 'default',
      status TEXT DEFAULT 'unknown',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS global_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      color TEXT DEFAULT '#00d4ff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS destinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'group',
      chat_id TEXT NOT NULL,
      waha_session_id INTEGER REFERENCES waha_sessions(id) ON DELETE SET NULL,
      active INTEGER DEFAULT 1,
      notify_all_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS destination_severity_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      severity TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS destination_tag_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      tag_name TEXT NOT NULL,
      tag_value TEXT DEFAULT '',
      negate_severity INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tag_phone_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_name TEXT NOT NULL,
      tag_value TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedule_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
      severity TEXT NOT NULL,
      days_of_week TEXT NOT NULL DEFAULT '1,2,3,4,5',
      start_time TEXT NOT NULL DEFAULT '08:00',
      end_time TEXT NOT NULL DEFAULT '18:00',
      action TEXT NOT NULL DEFAULT 'hold',
      tag_filter_name TEXT DEFAULT '',
      tag_filter_value TEXT DEFAULT '',
      tag_filter_negate INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alert_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT,
      alert_data TEXT NOT NULL,
      destination_id INTEGER REFERENCES destinations(id) ON DELETE CASCADE,
      status TEXT DEFAULT 'pending',
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS alert_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      alert_id TEXT,
      event_id TEXT,
      hostname TEXT,
      severity TEXT,
      message TEXT,
      destination_id INTEGER,
      destination_name TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_queue_status ON alert_queue(status);
    CREATE INDEX IF NOT EXISTS idx_queue_destination ON alert_queue(destination_id);
    CREATE INDEX IF NOT EXISTS idx_queue_scheduled ON alert_queue(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_logs_created ON alert_logs(created_at);
  `);

  // Migrations for existing installations
  const migrations = [
    `ALTER TABLE destinations ADD COLUMN notify_all_enabled INTEGER DEFAULT 0`,
    `ALTER TABLE destination_tag_filters ADD COLUMN negate_severity INTEGER DEFAULT 0`,
    `ALTER TABLE schedule_rules ADD COLUMN tag_filter_name TEXT DEFAULT ''`,
    `ALTER TABLE schedule_rules ADD COLUMN tag_filter_value TEXT DEFAULT ''`,
    `ALTER TABLE schedule_rules ADD COLUMN tag_filter_negate INTEGER DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }

  // Default settings
  const defaults = {
    queue_paused: '0',
    queue_rate_limit: '10',
    queue_rate_window_ms: '60000',
    queue_interval_ms: '5000',
    max_retries: '3',
    dedup_window_minutes: '5',
    webhook_token: process.env.WEBHOOK_TOKEN || '',
    log_max_rows: '50000',
    log_retention_days: '30',
    queue_max_sent_rows: '10000',
  };
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaults)) insertSetting.run(k, v);

  // Default admin user
  const adminExists = db.prepare(`SELECT id FROM users WHERE username = 'admin'`).get();
  if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare(`INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')`).run(hash);
    console.log('✅ Default admin user created: admin / admin123 — CHANGE THE PASSWORD!');
  }
}

initDB();

module.exports = db;
