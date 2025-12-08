/**
 * License server
 * endpoints:
 *  GET  /generate?tier=S|G|A&email=...         (ADMIN only)  -> generate a new license
 *  POST /activate                              (ADMIN)        -> activate license (mark active, set expiresAt)
 *  POST /renew                                 (ADMIN)        -> renew/update license
 *  POST /deactivate                            (ADMIN)        -> deactivate license
 *  GET  /validate?license=KEY                  (PUBLIC)       -> validate license (bot calls on startup)
 *
 * Security:
 *  - ADMIN endpoints require header `x-admin-token: <ADMIN_TOKEN>`
 *  - IP-binding optionally enabled (binds to request IP on first successful validate)
 *
 * DB: better-sqlite3 (file licenses.db by default)
 */

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-token-placeholder';
const DB_PATH = process.env.DB_PATH || './licenses.db';
const BIND_IP_ON_FIRST_VALIDATE = (process.env.BIND_IP_ON_FIRST_VALIDATE || 'true') === 'true';

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(bodyParser.json());

// DB init
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables if not exist
db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  key TEXT UNIQUE,
  tier TEXT,
  owner_email TEXT,
  created_at TEXT,
  expires_at TEXT,
  active INTEGER DEFAULT 1,
  bound_ip TEXT,
  last_seen_ip TEXT,
  last_validated TEXT,
  meta JSON
);

CREATE INDEX IF NOT EXISTS idx_key ON licenses(key);
`);

// helper: require admin header
function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token');
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// helper: make license key strings S-, G-, A- with random hex suffix
function makeKey(tierChar) {
  // tierChar: 'S'|'G'|'A'
  const rand = crypto.randomBytes(12).toString('hex').toUpperCase(); // 24 hex chars
  return `${tierChar}-${rand}`;
}

// helper: canonicalize incoming IP
function getRequestIP(req) {
  // Prefer X-Client-IP if provided, otherwise use remote address
  const forwarded = req.get('x-client-ip') || req.get('x-forwarded-for');
  if (forwarded) {
    // x-forwarded-for may contain comma list
    return forwarded.split(',')[0].trim();
  }
  // req.ip includes ::ffff: prefix sometimes
  let ip = req.ip || req.connection.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  return ip;
}

// CREATE /generate
// ADMIN only. Example: GET /generate?tier=A&email=user@example.com&days=30
app.get('/generate', requireAdmin, (req, res) => {
  try {
    const tier = (req.query.tier || 'S').toUpperCase();
    if (!['S', 'G', 'A'].includes(tier)) return res.status(400).json({ error: 'invalid tier' });

    const email = req.query.email || null;
    const days = parseInt(req.query.days || '30', 10);
    const expiresAt = new Date(Date.now() + (days * 86400000)).toISOString();

    const key = makeKey(tier);
    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`INSERT INTO licenses (id, key, tier, owner_email, created_at, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)`);
    stmt.run(id, key, tier, email, createdAt, expiresAt);

    return res.json({ license: key, tier: tier === 'A' ? 'Aegis' : tier === 'G' ? 'Guardian' : 'Sentinel', expiresAt, generatedAt: createdAt, owner_email: email });
  } catch (e) {
    console.error('generate error', e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /activate
// ADMIN only. { license: "...", days: 30, owner_email: "..." }
app.post('/activate', requireAdmin, (req, res) => {
  try {
    const { license, days = 30, owner_email = null } = req.body || {};
    if (!license) return res.status(400).json({ error: 'license required' });

    const expiresAt = new Date(Date.now() + (parseInt(days,10) * 86400000)).toISOString();
    const now = new Date().toISOString();

    const row = db.prepare('SELECT * FROM licenses WHERE key = ?').get(license);
    if (!row) {
      // create if doesn't exist
      const id = uuidv4();
      db.prepare('INSERT INTO licenses (id, key, tier, owner_email, created_at, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)')
        .run(id, license, 'S', owner_email, now, expiresAt);
      return res.json({ ok: true, license, created: true, expiresAt });
    }

    db.prepare('UPDATE licenses SET active = 1, expires_at = ?, owner_email = ? WHERE key = ?').run(expiresAt, owner_email, license);
    return res.json({ ok: true, license, expiresAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /renew
// ADMIN only. { license: "...", days: 30 }
app.post('/renew', requireAdmin, (req, res) => {
  try {
    const { license, days = 30 } = req.body || {};
    if (!license) return res.status(400).json({ error: 'license required' });
    const row = db.prepare('SELECT * FROM licenses WHERE key = ?').get(license);
    if (!row) return res.status(404).json({ error: 'not_found' });

    const expiresAt = new Date(Date.now() + (parseInt(days,10) * 86400000)).toISOString();
    db.prepare('UPDATE licenses SET expires_at = ?, active = 1 WHERE key = ?').run(expiresAt, license);
    return res.json({ ok: true, license, expiresAt });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// POST /deactivate
// ADMIN only. { license: "..." }
app.post('/deactivate', requireAdmin, (req, res) => {
  try {
    const { license } = req.body || {};
    if (!license) return res.status(400).json({ error: 'license required' });
    db.prepare('UPDATE licenses SET active = 0 WHERE key = ?').run(license);
    return res.json({ ok: true, license });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'server_error' });
  }
});

// GET /info?license=...
// PUBLIC but non-sensitive. returns license row
app.get('/info', (req, res) => {
  const license = req.query.license;
  if (!license) return res.status(400).json({ error: 'license required' });
  const row = db.prepare('SELECT id, key, tier, owner_email, created_at, expires_at, active, bound_ip, last_seen_ip, last_validated FROM licenses WHERE key = ?').get(license);
  if (!row) return res.status(404).json({ error: 'not_found' });
  return res.json(row);
});

// GET /validate?license=KEY
// BOT calls this on start. server will detect requester IP and optionally bind on first validate.
app.get('/validate', (req, res) => {
  try {
    const license = req.query.license;
    if (!license) return res.status(400).json({ valid: false, reason: 'license required' });

    const incomingIp = getRequestIP(req);
    const now = new Date().toISOString();

    const row = db.prepare('SELECT * FROM licenses WHERE key = ?').get(license);
    if (!row) return res.status(404).json({ valid: false, reason: 'not_found' });

    // check active flag
    if (!row.active) return res.json({ valid: false, reason: 'deactivated' });

    // check expiry
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      // mark inactive
      db.prepare('UPDATE licenses SET active = 0 WHERE key = ?').run(license);
      return res.json({ valid: false, reason: 'expired' });
    }

    // IP-binding logic:
    if (row.bound_ip) {
      // if bound, require matching
      if (row.bound_ip !== incomingIp) {
        return res.json({ valid: false, reason: 'ip_mismatch', bound_ip: row.bound_ip, incomingIp });
      }
    } else {
      // not bound: optionally bind on first validate
      if (BIND_IP_ON_FIRST_VALIDATE) {
        db.prepare('UPDATE licenses SET bound_ip = ? WHERE key = ?').run(incomingIp, license);
      }
    }

    // update last_seen_ip/last_validated
    db.prepare('UPDATE licenses SET last_seen_ip = ?, last_validated = ? WHERE key = ?').run(incomingIp, now, license);

    return res.json({
      valid: true,
      license: row.key,
      tier: row.tier,
      owner_email: row.owner_email,
      expires_at: row.expires_at,
      bound_ip: row.bound_ip || incomingIp
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ valid: false, reason: 'server_error' });
  }
});

app.get('/', (req, res) => {
  res.json({ ok: true, message: 'License server running' });
});
// POST /wix/order
// Public endpoint called by Wix Automations after a purchase
// Expects: { email: "...", productName: "Sentinel|Guardian|Aegis" }
app.post('/wix/order', (req, res) => {
  try {
    const { email, productName } = req.body || {};
    // at top of /wix/order handler:
const SHARED_SECRET = process.env.WIX_SHARED_SECRET || 'changeme';
const reqSecret = req.get('x-webhook-secret') || '';
if (reqSecret !== SHARED_SECRET) {
  return res.status(401).json({ error: 'unauthorized' });
}


    if (!email || !productName) {
      return res.status(400).json({ error: 'email and productName required' });
    }

    // Map Wix product names → internal tiers
    let tier = null;
    if (productName === "Sentinel") tier = "S";
    if (productName === "Guardian") tier = "G";
    if (productName === "Aegis") tier = "A";

    if (!tier) {
      return res.status(400).json({ error: "unknown productName" });
    }

    // Generate license
    const key = makeKey(tier);
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (30 * 86400000)).toISOString(); // default 30 days

    db.prepare(`
      INSERT INTO licenses (id, key, tier, owner_email, created_at, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(id, key, tier, email, createdAt, expiresAt);

    return res.json({
      ok: true,
      license: key,
      email,
      tier: productName,
      expiresAt
    });

  } catch (err) {
    console.error("Wix order error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

app.listen(PORT, () => {
  console.log(`License server listening on ${PORT}`);
});
