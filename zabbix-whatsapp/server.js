require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/waha-sessions', require('./routes/waha'));
app.use('/api/destinations', require('./routes/destinations'));
app.use('/api/tag-mappings', require('./routes/tagMappings'));
app.use('/api/global-tags', require('./routes/globalTags'));
app.use('/api/queue', require('./routes/queue'));
app.use('/api/webhook', require('./routes/webhook'));
app.use('/api', require('./routes/misc'));

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

require('./services/queueService').start();
require('./services/logCleanupService').start();

app.listen(PORT, () => {
  console.log(`🚀 ZabbixWA v1.3.0 running on port ${PORT}`);
  console.log(`📊 Admin Panel: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/api/webhook/zabbix`);
});
