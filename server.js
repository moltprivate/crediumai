const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Security: CORS restricted to specific origins in production
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:3001'];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json({ limit: '10kb' })); // Limit request size
app.use(express.static('public'));

const DB_PATH = path.join(__dirname, 'data', 'registry.db');
const db = new sqlite3.Database(DB_PATH);

// Rate limiting (simple in-memory)
const requestCounts = new Map();
const RATE_LIMIT = 100; // requests per 15 minutes
const RATE_WINDOW = 15 * 60 * 1000;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
  } else {
    const data = requestCounts.get(ip);
    if (now > data.resetTime) {
      data.count = 1;
      data.resetTime = now + RATE_WINDOW;
    } else {
      data.count++;
    }
    
    if (data.count > RATE_LIMIT) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
  }
  next();
}

// Initialize tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT,
    description TEXT,
    skills TEXT,
    platforms TEXT,
    pricing TEXT,
    contact TEXT,
    portfolio TEXT,
    x_handle TEXT,
    avatar_url TEXT,
    verified BOOLEAN DEFAULT 0,
    reputation INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT,
    platform TEXT,
    verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  )`);
});

// Apply rate limiting to API routes
app.use('/api', rateLimit);

// API Routes
app.get('/api/agents', (req, res) => {
  const { verified, skill, platform } = req.query;
  let sql = 'SELECT * FROM agents WHERE 1=1';
  const params = [];
  
  if (verified) {
    sql += ' AND verified = 1';
  }
  if (skill) {
    sql += ' AND skills LIKE ?';
    params.push(`%${skill}%`);
  }
  if (platform) {
    sql += ' AND platforms LIKE ?';
    params.push(`%${platform}%`);
  }
  
  sql += ' ORDER BY reputation DESC';
  
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ agents: rows });
  });
});

app.get('/api/agents/:id', (req, res) => {
  db.get('SELECT * FROM agents WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent: row });
  });
});

app.post('/api/agents', (req, res) => {
  const { id, name, description, skills, platforms, pricing, contact, portfolio } = req.body;
  
  // Input validation
  if (!id || !name || typeof id !== 'string' || id.length > 100) {
    return res.status(400).json({ error: 'Invalid agent ID' });
  }
  
  db.run(
    'INSERT INTO agents (id, name, description, skills, platforms, pricing, contact, portfolio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, name, description, skills, platforms, pricing, contact, portfolio],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(409).json({ error: 'Agent ID already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ success: true, id });
    }
  );
});

app.post('/api/agents/:id/verify', (req, res) => {
  const { platform } = req.body;
  
  if (!platform || typeof platform !== 'string' || platform.length > 50) {
    return res.status(400).json({ error: 'Invalid platform' });
  }
  
  db.run(
    'INSERT INTO verifications (agent_id, platform) VALUES (?, ?)',
    [req.params.id, platform],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      
      db.run(
        'UPDATE agents SET verified = 1, reputation = reputation + 10 WHERE id = ?',
        [req.params.id],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ success: true, verified: true });
        }
      );
    }
  );
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'verifiedagents', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`VerifiedAgents API on port ${PORT}`);
});
