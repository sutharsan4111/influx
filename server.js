// server.js
require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const compression = require("compression");
const fs = require("fs");
const multer = require("multer");
const FormData = require("form-data");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

// ===============================
// Middleware
// ===============================
app.use(cors());
app.use(compression()); // 🚀 Enable gzip compression for responses
app.use(express.json());
app.use(bodyParser.json());

// 🚀 Production: Smart caching headers
app.use((req, res, next) => {
  // Static assets: 1 year (immutable)
  if (req.url.match(/\.(js|css|woff|woff2|ttf|eot|svg)$/i)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
  // API responses: use cache-control from individual endpoints
  // HTML: no cache
  else if (!req.url.startsWith('/api/')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// 🏥 Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ------------------------
// DB Connection + Auto Migration
// ------------------------
async function runMigrations() {
  try {
    // Create ticket_assignments table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_assignments (
        id SERIAL PRIMARY KEY,
        zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
        zoho_ticket_number VARCHAR(50),
        zoho_department_id VARCHAR(50),
        assigned_users TEXT[] NOT NULL DEFAULT '{}',
        primary_assignee VARCHAR(255) NOT NULL,
        assigned_by VARCHAR(255) NOT NULL,
        assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        reassigned_user VARCHAR(255),
        reassigned_at TIMESTAMP WITH TIME ZONE,
        reassigned_by VARCHAR(255),
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        closed_at TIMESTAMP WITH TIME ZONE,
        closed_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    
    // Add category column if not exists
    await pool.query(`
      ALTER TABLE ticket_assignments 
      ADD COLUMN IF NOT EXISTS category VARCHAR(255)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ihub_assets (
        id SERIAL PRIMARY KEY,
        client VARCHAR(255) NOT NULL,
        environment VARCHAR(100) NOT NULL,
        hostname VARCHAR(255) NOT NULL,
        ip_address VARCHAR(100) NOT NULL,
        ihub_version VARCHAR(100),
        license_expiry DATE NOT NULL,
        responsible_person_email VARCHAR(255) NOT NULL,
        responsible_person_name VARCHAR(255),
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ihub_alert_tickets (
        id SERIAL PRIMARY KEY,
        ihub_asset_id INTEGER NOT NULL REFERENCES ihub_assets(id) ON DELETE CASCADE,
        milestone_days INTEGER NOT NULL,
        license_expiry_on DATE NOT NULL,
        zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
        zoho_ticket_number VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP WITH TIME ZONE,
        UNIQUE (ihub_asset_id, milestone_days, license_expiry_on)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ssl_assets (
        id SERIAL PRIMARY KEY,
        client VARCHAR(255) NOT NULL,
        environment VARCHAR(100) NOT NULL,
        hostname VARCHAR(255) NOT NULL,
        ip_address VARCHAR(100) NOT NULL,
        application VARCHAR(255) NOT NULL,
        version VARCHAR(100),
        ssl_url TEXT NOT NULL,
        responsible_person_email VARCHAR(255) NOT NULL,
        responsible_person_name VARCHAR(255),
        ssl_expiry DATE NOT NULL,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ssl_expiry_alert_tickets (
        id SERIAL PRIMARY KEY,
        ssl_asset_id INTEGER NOT NULL REFERENCES ssl_assets(id) ON DELETE CASCADE,
        milestone_days INTEGER NOT NULL,
        ssl_expiry_on DATE NOT NULL,
        zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
        zoho_ticket_number VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP WITH TIME ZONE,
        UNIQUE (ssl_asset_id, milestone_days, ssl_expiry_on)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alertmanager_ssl_tickets (
        id SERIAL PRIMARY KEY,
        alert_fingerprint VARCHAR(255) NOT NULL UNIQUE,
        alertname VARCHAR(255),
        milestone_days INTEGER NOT NULL,
        client VARCHAR(255),
        environment VARCHAR(100),
        application VARCHAR(255),
        instance TEXT,
        responsible VARCHAR(255),
        responsible_email VARCHAR(255),
        zoho_ticket_id VARCHAR(50) UNIQUE,
        zoho_ticket_number VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP WITH TIME ZONE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS recycled_tickets (
        id SERIAL PRIMARY KEY,
        zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
        zoho_ticket_number VARCHAR(50),
        subject TEXT,
        email VARCHAR(255),
        priority VARCHAR(100),
        deleted_by VARCHAR(255) NOT NULL,
        deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
        restored_at TIMESTAMP WITH TIME ZONE,
        snapshot JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    // Optional SSL fields should be nullable/optional in API usage.
    await pool.query(`
      ALTER TABLE ssl_assets
      ALTER COLUMN hostname DROP NOT NULL,
      ALTER COLUMN ip_address DROP NOT NULL,
      ALTER COLUMN application DROP NOT NULL
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reply_authors (
        id SERIAL PRIMARY KEY,
        zoho_ticket_id TEXT NOT NULL,
        zoho_conversation_id TEXT NOT NULL UNIQUE,
        user_email TEXT NOT NULL,
        user_name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_reply_authors_ticket ON reply_authors(zoho_ticket_id)`);

    console.log("✅ Database migrations applied");
  } catch (err) {
    console.error("⚠️ Migration warning:", err.message);
  }
}

pool.connect()
  .then(async () => {
    console.log("✅ Connected to Supabase DB");
    await runMigrations();
  })
  .catch(err => console.error("❌ DB Connection Failed:", err));

// =======================================================
// 🔐 AUTH APIs (ADD BEFORE ALL OTHER ROUTES)
// =======================================================
// ---------------------------
// 🔐 JWT AUTH MIDDLEWARE
// ---------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}
// ---------------------------
// 🔐 ADMIN ROLE MIDDLEWARE
// ---------------------------
function authorizeAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only access" });
  }
  next();
}

function getGraphToken(req) {
  return (req.headers["x-graph-token"] || "").toString();
}
app.get("/api/users", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, role FROM users ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// Create User (Admin)
app.post("/api/users", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const existing = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    await pool.query(
      "INSERT INTO users (email, password, role) VALUES ($1, $2, $3)",
      [email.toLowerCase(), hashed, role]
    );

    res.json({ message: "User created successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "User creation failed" });
  }
});


// Login
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // 🔥 ACCESS TOKEN (1 hour)
    const accessToken = jwt.sign(
      { email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 🔥 REFRESH TOKEN (7 days)
    const refreshToken = jwt.sign(
      { email: user.email, role: user.role },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      accessToken,
      refreshToken,
      role: user.role,
      email: user.email
    });

  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});
// 🔄 Refresh Token API
app.post("/api/refresh", (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) return res.sendStatus(401);

  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);

    const newAccessToken = jwt.sign(
      { email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ accessToken: newAccessToken });
  });
});



// ------------------------
// Environment / Tokens
// ------------------------
let ZOHO_OAUTH_TOKEN = '';
const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
const ZOHO_BASE_URL = process.env.ZOHO_BASE_URL || 'https://desk.zoho.in/api/v1';
const ZOHO_DEPARTMENT_ID = process.env.ZOHO_DEPARTMENT_ID;
const ZOHO_ASSIGNEE_ID = process.env.ZOHO_ASSIGNEE_ID;
const IHUB_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const SSL_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const AUTOMATION_SSL_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const ALERTMANAGER_WEBHOOK_SECRET = (process.env.ALERTMANAGER_WEBHOOK_SECRET || '').trim();
const ALERTMANAGER_FALLBACK_EMAIL = (process.env.ALERTMANAGER_FALLBACK_EMAIL || '').trim().toLowerCase();

function priorityForIhubAndSslMilestone(milestoneDays) {
  if (milestoneDays === 3 || milestoneDays === 1) return 'SLA';
  if (milestoneDays === 7) return 'High';
  return 'Medium';
}

function priorityForAutomationSslMilestone(milestoneDays) {
  if (milestoneDays === 3 || milestoneDays === 1) return 'SLA';
  if (milestoneDays === 7) return 'High';
  return 'Medium';
}

// ------------------------
// Serve Angular build
// ------------------------
const angularPath = path.join(__dirname, "dist", "ticket-portal");
const angularBrowserPath = path.join(angularPath, "browser");

app.use(express.static(angularBrowserPath));
app.use(express.static(angularPath));

// ------------------------
// ZOHO TOKEN REFRESH
// ------------------------
async function refreshZohoToken() {
  try {
    const params = new URLSearchParams({
      refresh_token: REFRESH_TOKEN,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token'
    });

    const response = await fetch(
      `https://accounts.zoho.in/oauth/v2/token?${params}`,
      { method: 'POST' }
    );

    const data = await response.json();

    if (data.access_token) {
      ZOHO_OAUTH_TOKEN = `Zoho-oauthtoken ${data.access_token}`;
    }
  } catch (err) {
    // Token refresh failed silently
  }
}

// Refresh token on startup and every 55 minutes
setInterval(refreshZohoToken, 55 * 60 * 1000);
refreshZohoToken();

// IHUB expiry alert processing on startup + every 12 hours
setTimeout(() => {
  processIhubAlerts();
  processSslAlerts();
}, 15 * 1000);
setInterval(processIhubAlerts, 12 * 60 * 60 * 1000);
setInterval(processSslAlerts, 12 * 60 * 60 * 1000);

// ------------------------
// ZOHO API HELPER
// ------------------------
async function zohoFetch(endpoint, options = {}) {
  if (!ZOHO_OAUTH_TOKEN) {
    await refreshZohoToken();
  }

  const headers = {
    Authorization: ZOHO_OAUTH_TOKEN,
    ...(ZOHO_ORG_ID ? { orgId: ZOHO_ORG_ID } : {}),
    ...(options.headers || {})
  };

  const isFormData = options.body instanceof FormData;
  if (!headers['Content-Type'] && !headers['content-type'] && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${ZOHO_BASE_URL}${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    await refreshZohoToken();
    return zohoFetch(endpoint, options);
  }

  return res;
}

async function lookupAgentIdByEmail(email) {
  if (!email) return '';
  const target = email.trim().toLowerCase();
  const limit = 100;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await zohoFetch(`/agents?limit=${limit}&from=${from}`);
    const data = await res.json();
    const agents = Array.isArray(data?.data) ? data.data : [];

    const match = agents.find(a => {
      const agentEmail = (a.email || a.emailId || a.primaryEmail || '').toLowerCase();
      return agentEmail === target;
    });

    if (match?.id) return match.id;

    hasMore = agents.length === limit;
    from += limit;
  }

  return '';
}

function toStartOfDay(dateInput) {
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysUntilDate(dateInput) {
  const today = toStartOfDay(new Date());
  const target = toStartOfDay(dateInput);
  return Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function isValidDateInput(value) {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

function normalizeDateOnly(value) {
  const d = toStartOfDay(value);
  return d.toISOString().slice(0, 10);
}

function isLikelyEmail(value) {
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
}

function safeTokenEqual(a, b) {
  const aa = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function isAlertmanagerAuthorized(req) {
  if (!ALERTMANAGER_WEBHOOK_SECRET) return true;
  const provided = (req.headers['x-alertmanager-secret'] || '').toString().trim();
  return safeTokenEqual(provided, ALERTMANAGER_WEBHOOK_SECRET);
}

function parseMilestoneDays(alert) {
  const labels = alert?.labels || {};
  const annotations = alert?.annotations || {};
  const fromLabel = parseInt(labels.milestone_days || labels.days_left || '', 10);
  if (Number.isInteger(fromLabel)) return fromLabel;

  const sources = [
    labels.alertname || '',
    annotations.summary || '',
    annotations.description || ''
  ];

  for (const text of sources) {
    const match = /(?:^|[^\d])(\d{1,3})\s*[_-]?\s*days?(?=$|[^A-Za-z])/i.exec(text);
    if (match) {
      const value = parseInt(match[1], 10);
      if (Number.isInteger(value)) return value;
    }
  }

  return null;
}

function buildAlertFingerprint(alert, milestoneDays) {
  const labels = alert?.labels || {};
  const raw = [
    labels.alertname || 'SSL_ALERT',
    labels.client || 'unknown-client',
    labels.instance || labels.target || labels.url || 'unknown-instance',
    labels.application || 'unknown-app',
    String(milestoneDays)
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function createAlertmanagerSslTicket(alert, milestoneDays) {
  const labels = alert?.labels || {};
  const annotations = alert?.annotations || {};

  const client = (labels.client || '').trim() || 'Unknown Client';
  const environment = (labels.environment || '').trim() || 'Unknown';
  const application = (labels.application || '').trim() || 'Unknown';
  const instance = (labels.instance || labels.target || labels.url || '').trim() || 'Unknown';
  const alertname = (labels.alertname || 'SSLCert').trim();
  const responsible = (labels.responsible || labels.owner || labels.assignee || '').trim();

  const responsibleCandidates = [
    labels.responsible_email,
    labels.owner_email,
    labels.assignee_email,
    labels.email,
    responsible
  ];
  const responsibleEmail = responsibleCandidates
    .map(v => (v || '').toString().trim().toLowerCase())
    .find(isLikelyEmail) || ALERTMANAGER_FALLBACK_EMAIL;

  if (!responsibleEmail) {
    return {
      status: 'skipped',
      reason: 'missing responsible email label and fallback email'
    };
  }

  const fingerprint = buildAlertFingerprint(alert, milestoneDays);

  // Check if an Open/Pending ticket already exists for this fingerprint.
  // If the previous ticket was Closed, allow a new one to be created.
  const existing = await pool.query(
    `SELECT id, status FROM alertmanager_ssl_tickets 
     WHERE alert_fingerprint = $1
     ORDER BY id DESC LIMIT 1`,
    [fingerprint]
  );
  if (existing.rows.length > 0 && ['Open', 'Pending'].includes(existing.rows[0].status)) {
    return { status: 'duplicate', reason: 'already processed' };
  }

  // Remove old closed row so the unique constraint allows a fresh insert.
  if (existing.rows.length > 0) {
    await pool.query(
      `DELETE FROM alertmanager_ssl_tickets WHERE alert_fingerprint = $1 AND status = 'Closed'`,
      [fingerprint]
    );
  }

  const reservation = await pool.query(
    `INSERT INTO alertmanager_ssl_tickets
      (alert_fingerprint, alertname, milestone_days, client, environment, application, instance, responsible, responsible_email, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
     RETURNING id`,
    [
      fingerprint,
      alertname,
      milestoneDays,
      client,
      environment,
      application,
      instance,
      responsible || null,
      responsibleEmail
    ]
  );

  if (reservation.rows.length === 0) {
    return { status: 'duplicate', reason: 'already processed' };
  }

  const rowId = reservation.rows[0].id;
  const subject = `[SSL][Automation] ${client} - certificate expiry in ${milestoneDays} day(s)`;
  const description = [
    '<p><strong>SSL Expiry Alert (Automation Stack)</strong></p>',
    `<p>Milestone: <strong>${milestoneDays} day(s)</strong></p>`,
    `<p>Client: ${client}</p>`,
    `<p>Environment: ${environment}</p>`,
    `<p>Application: ${application}</p>`,
    `<p>Instance/URL: ${instance}</p>`,
    `<p>Responsible: ${responsible || '-'}</p>`,
    `<p>Responsible Email: ${responsibleEmail}</p>`,
    `<p>Summary: ${(annotations.summary || '').trim() || '-'}</p>`,
    `<p>Description: ${(annotations.description || '').trim() || '-'}</p>`,
    `<p>Source Alert: ${alertname}</p>`,
    `<p>Starts At: ${alert?.startsAt || '-'}</p>`,
    `<p>Generator URL: ${alert?.generatorURL || '-'}</p>`
  ].join('');

  const payload = {
    subject,
    priority: priorityForAutomationSslMilestone(milestoneDays),
    status: 'Open',
    category: 'SSL',
    subCategory: 'SSL Expiry',
    description,
    contact: {
      lastName: responsible || client,
      email: responsibleEmail
    }
  };

  if (ZOHO_DEPARTMENT_ID) {
    payload.departmentId = ZOHO_DEPARTMENT_ID;
  }

  const assigneeId = await lookupAgentIdByEmail(responsibleEmail);
  if (assigneeId) {
    payload.assigneeId = assigneeId;
  }

  // Retry up to 3 times on 429 with exponential backoff before giving up
  let response, data;
  for (let attempt = 1; attempt <= 3; attempt++) {
    response = await zohoFetch('/tickets', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    data = await response.json().catch(() => null);
    if (response.status !== 429) break;
    console.warn(`[Webhook] Zoho 429 on ticket create attempt ${attempt}/3, retrying in ${attempt * 3}s`);
    await new Promise(r => setTimeout(r, attempt * 3000));
  }

  if (!response.ok && payload.assigneeId) {
    const assigneeError = Array.isArray(data?.errors)
      ? data.errors.find((e) => e?.fieldName === '/assigneeId')
      : null;

    if (assigneeError) {
      delete payload.assigneeId;
      for (let attempt = 1; attempt <= 3; attempt++) {
        response = await zohoFetch('/tickets', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        data = await response.json().catch(() => null);
        if (response.status !== 429) break;
        console.warn(`[Webhook] Zoho 429 on ticket create (no assignee) attempt ${attempt}/3, retrying in ${attempt * 3}s`);
        await new Promise(r => setTimeout(r, attempt * 3000));
      }
    }
  }

  if (!response.ok || !data?.id) {
    await pool.query(
      `DELETE FROM alertmanager_ssl_tickets
       WHERE id = $1 AND status = 'Pending'`,
      [rowId]
    );
    throw new Error(data?.message || `Alertmanager SSL ticket creation failed (${response.status})`);
  }

  await pool.query(
    `UPDATE alertmanager_ssl_tickets
     SET zoho_ticket_id = $1,
         zoho_ticket_number = $2,
         status = 'Open',
         updated_at = NOW()
     WHERE id = $3`,
    [data.id, data.ticketNumber || null, rowId]
  );

  await upsertSslAssignment(data.id, data.ticketNumber || null, responsibleEmail);
  return { status: 'created', ticketId: data.id, ticketNumber: data.ticketNumber || null };
}

app.post('/api/webhook/alertmanager', async (req, res) => {
  try {
    if (!isAlertmanagerAuthorized(req)) {
      return res.status(401).json({ message: 'Invalid webhook secret' });
    }

    const payload = req.body || {};
    const incomingAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    const firingAlerts = incomingAlerts.filter(a => (a?.status || '').toLowerCase() === 'firing');

    if (firingAlerts.length === 0) {
      return res.json({ message: 'No firing alerts to process', processed: 0 });
    }

    const results = [];
    for (const alert of firingAlerts) {
      const milestoneDays = parseMilestoneDays(alert);
      if (!Number.isInteger(milestoneDays) || !AUTOMATION_SSL_ALERT_MILESTONES.includes(milestoneDays)) {
        console.warn(
          `[Webhook] Ignored SSL alert: alertname=${alert?.labels?.alertname || 'unknown'} ` +
          `instance=${alert?.labels?.instance || alert?.labels?.target || alert?.labels?.url || 'unknown'} ` +
          `milestone=${Number.isInteger(milestoneDays) ? milestoneDays : 'unparsed'} ` +
          `allowed=[${AUTOMATION_SSL_ALERT_MILESTONES.join(',')}]`
        );
        results.push({
          status: 'ignored',
          reason: 'milestone not in configured automation list',
          alertname: alert?.labels?.alertname || null,
          milestone_days: milestoneDays
        });
        continue;
      }

      try {
        const created = await createAlertmanagerSslTicket(alert, milestoneDays);
        results.push({
          alertname: alert?.labels?.alertname || null,
          milestone_days: milestoneDays,
          ...created
        });
      } catch (err) {
        console.error('Alertmanager webhook ticket creation failed:', err?.message || err);
        results.push({
          alertname: alert?.labels?.alertname || null,
          milestone_days: milestoneDays,
          status: 'error',
          reason: err?.message || String(err)
        });
      }
    }

    return res.json({
      message: 'Alertmanager webhook processed',
      processed: results.length,
      results
    });
  } catch (err) {
    console.error('Alertmanager webhook failed:', err);
    return res.status(500).json({ message: 'Webhook processing failed' });
  }
});

async function closeZohoTicketWithFallback(ticketId) {
  const closeTry = await zohoFetch(`/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Closed' })
  });

  if (closeTry.ok) return true;
  if (closeTry.status !== 422) return false;

  const resolveTry = await zohoFetch(`/tickets/${ticketId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'Resolved' })
  });

  return resolveTry.ok;
}

async function upsertIhubAssignment(ticketId, ticketNumber, assigneeEmail) {
  const normalizedEmail = (assigneeEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  await pool.query(
    `INSERT INTO ticket_assignments
      (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
     VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'IHUB')
     ON CONFLICT (zoho_ticket_id) DO UPDATE SET
       assigned_users = EXCLUDED.assigned_users,
       primary_assignee = EXCLUDED.primary_assignee,
       reassigned_user = ticket_assignments.primary_assignee,
       reassigned_at = NOW(),
       reassigned_by = EXCLUDED.assigned_by,
       category = 'IHUB',
       status = 'Open',
       updated_at = NOW()`,
    [
      ticketId,
      ticketNumber || null,
      [normalizedEmail],
      normalizedEmail,
      'ihub-system',
      ZOHO_DEPARTMENT_ID || null
    ]
  );
}

async function createIhubAlertTicket(asset, milestoneDays) {
  const responsibleEmail = (asset.responsible_person_email || '').trim().toLowerCase();
  console.log(`[IHUB] createIhubAlertTicket: Asset ${asset.id}, email="${responsibleEmail}"`);
  
  if (!responsibleEmail) {
    console.log(`[IHUB] createIhubAlertTicket: No responsible email for asset ${asset.id}, skipping`);
    return;
  }

  const licenseExpiryOn = normalizeDateOnly(asset.license_expiry);
  console.log(`[IHUB] Checking for existing alert: asset=${asset.id}, milestone=${milestoneDays}, expiry=${licenseExpiryOn}`);

  // Reserve the alert row first to prevent concurrent runs from creating duplicate Zoho tickets.
  const reservationTicketId = `IHUB-PENDING-${asset.id}-${milestoneDays}-${licenseExpiryOn}-${Date.now()}`;
  const reservation = await pool.query(
    `INSERT INTO ihub_alert_tickets
      (ihub_asset_id, milestone_days, license_expiry_on, zoho_ticket_id, status)
     VALUES ($1, $2, $3, $4, 'Pending')
     ON CONFLICT (ihub_asset_id, milestone_days, license_expiry_on) DO NOTHING
     RETURNING id`,
    [asset.id, milestoneDays, licenseExpiryOn, reservationTicketId]
  );

  if (reservation.rows.length === 0) {
    console.log(`[IHUB] Alert already exists for asset ${asset.id} at ${milestoneDays} days, skipping`);
    return;
  }

  const alertRowId = reservation.rows[0].id;

  const subject = `[IHUB] License expiry in ${milestoneDays} day(s) - ${asset.client} (${asset.hostname})`;
  const description = [
    '<p><strong>IHUB License Expiry Alert</strong></p>',
    `<p>License is due in <strong>${milestoneDays}</strong> day(s).</p>`,
    `<p>Client: ${asset.client}</p>`,
    `<p>Environment: ${asset.environment}</p>`,
    `<p>Hostname: ${asset.hostname}</p>`,
    `<p>IP Address: ${asset.ip_address}</p>`,
    `<p>IHUB Version: ${asset.ihub_version || 'N/A'}</p>`,
    `<p>License Expiry: ${licenseExpiryOn}</p>`,
    `<p>Responsible Person: ${responsibleEmail}</p>`
  ].join('');

  const payload = {
    subject,
    priority: priorityForIhubAndSslMilestone(milestoneDays),
    status: 'Open',
    category: 'IHUB',
    subCategory: 'License Expiry',
    description,
    contact: {
      lastName: asset.responsible_person_name || asset.client || 'IHUB Owner',
      email: responsibleEmail
    }
  };

  if (ZOHO_DEPARTMENT_ID) {
    payload.departmentId = ZOHO_DEPARTMENT_ID;
  }

  const assigneeId = await lookupAgentIdByEmail(responsibleEmail);
  if (assigneeId) {
    payload.assigneeId = assigneeId;
  }

  console.log(`[IHUB] Creating Zoho ticket for asset ${asset.id}:`, subject);
  let response = await zohoFetch('/tickets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  let data = await response.json().catch(() => null);

  // If Zoho rejects assignee privileges, retry without assigneeId.
  if (!response.ok && payload.assigneeId) {
    const assigneeError = Array.isArray(data?.errors)
      ? data.errors.find((e) => e?.fieldName === '/assigneeId')
      : null;

    if (assigneeError) {
      console.warn(`[IHUB] Zoho rejected assigneeId for asset ${asset.id}, retrying without assigneeId`);
      delete payload.assigneeId;
      response = await zohoFetch('/tickets', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      data = await response.json().catch(() => null);
    }
  }

  if (!response.ok || !data?.id) {
    const errorMsg = data?.message || `IHUB alert ticket creation failed (${response.status})`;
    console.error(`[IHUB] Zoho API error for asset ${asset.id}:`, errorMsg, data);

    // Release reservation on failure so future runs can retry.
    await pool.query(
      `DELETE FROM ihub_alert_tickets
       WHERE id = $1 AND status = 'Pending'`,
      [alertRowId]
    );

    throw new Error(errorMsg);
  }

  console.log(`[IHUB] Zoho ticket created: ${data.id} (${data.ticketNumber})`);
  
  await pool.query(
    `UPDATE ihub_alert_tickets
     SET zoho_ticket_id = $1,
         zoho_ticket_number = $2,
         status = 'Open'
     WHERE id = $3`,
    [data.id, data.ticketNumber || null, alertRowId]
  );

  console.log(`[IHUB] Alert ticket record created in DB for asset ${asset.id}`);
  
  await upsertIhubAssignment(data.id, data.ticketNumber || null, responsibleEmail);
  console.log(`[IHUB] Assignment created for asset ${asset.id}`);
}

async function processIhubAlerts() {
  try {
    const result = await pool.query('SELECT * FROM ihub_assets');
    console.log(`[IHUB] Processing ${result.rows.length} assets for alert generation...`);

    for (const asset of result.rows) {
      const daysLeft = daysUntilDate(asset.license_expiry);
      console.log(`[IHUB] Asset ${asset.id} (${asset.client}): ${daysLeft} days until expiry on ${asset.license_expiry}, email: ${asset.responsible_person_email}`);
      
      if (!IHUB_ALERT_MILESTONES.includes(daysLeft)) {
        console.log(`[IHUB] Asset ${asset.id}: ${daysLeft} days not in milestones [${IHUB_ALERT_MILESTONES.join(',')}], skipping`);
        continue;
      }

      try {
        console.log(`[IHUB] Creating alert ticket for asset ${asset.id} at ${daysLeft} day milestone`);
        await createIhubAlertTicket(asset, daysLeft);
        console.log(`[IHUB] Alert ticket created successfully for asset ${asset.id}`);
      } catch (err) {
        console.error(`IHUB alert generation failed for asset ${asset.id}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('IHUB alert processor failed:', err?.message || err);
  }
}

async function upsertSslAssignment(ticketId, ticketNumber, assigneeEmail) {
  const normalizedEmail = (assigneeEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  await pool.query(
    `INSERT INTO ticket_assignments
      (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
     VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'SSL')
     ON CONFLICT (zoho_ticket_id) DO UPDATE SET
       assigned_users = EXCLUDED.assigned_users,
       primary_assignee = EXCLUDED.primary_assignee,
       reassigned_user = ticket_assignments.primary_assignee,
       reassigned_at = NOW(),
       reassigned_by = EXCLUDED.assigned_by,
       category = 'SSL',
       status = 'Open',
       updated_at = NOW()`,
    [
      ticketId,
      ticketNumber || null,
      [normalizedEmail],
      normalizedEmail,
      'ssl-system',
      ZOHO_DEPARTMENT_ID || null
    ]
  );
}

async function createSslAlertTicket(asset, milestoneDays) {
  const responsibleEmail = (asset.responsible_person_email || '').trim().toLowerCase();
  if (!responsibleEmail) return;

  const sslExpiryOn = normalizeDateOnly(asset.ssl_expiry);

  // Reserve the alert row first to prevent concurrent runs from creating duplicate Zoho tickets.
  const reservationTicketId = `SSL-PENDING-${asset.id}-${milestoneDays}-${sslExpiryOn}-${Date.now()}`;
  const reservation = await pool.query(
    `INSERT INTO ssl_expiry_alert_tickets
      (ssl_asset_id, milestone_days, ssl_expiry_on, zoho_ticket_id, status)
     VALUES ($1, $2, $3, $4, 'Pending')
     ON CONFLICT (ssl_asset_id, milestone_days, ssl_expiry_on) DO NOTHING
     RETURNING id`,
    [asset.id, milestoneDays, sslExpiryOn, reservationTicketId]
  );

  if (reservation.rows.length === 0) return;

  const alertRowId = reservation.rows[0].id;

  const subject = `[SSL] SSL expiry in ${milestoneDays} day(s) - ${asset.client} (${asset.ssl_url || asset.hostname || 'N/A'})`;
  const description = [
    '<p><strong>SSL Expiry Alert</strong></p>',
    `<p>SSL is due in <strong>${milestoneDays}</strong> day(s).</p>`,
    `<p>Client: ${asset.client}</p>`,
    `<p>Environment: ${asset.environment}</p>`,
    `<p>Hostname: ${asset.hostname || '-'}</p>`,
    `<p>IP Address: ${asset.ip_address || '-'}</p>`,
    `<p>Application: ${asset.application || '-'}</p>`,
    `<p>Version: ${asset.version || 'N/A'}</p>`,
    `<p>SSL URL: ${asset.ssl_url}</p>`,
    `<p>SSL Expiry: ${sslExpiryOn}</p>`,
    `<p>Responsible Person: ${responsibleEmail}</p>`
  ].join('');

  const payload = {
    subject,
    priority: priorityForIhubAndSslMilestone(milestoneDays),
    status: 'Open',
    category: 'SSL',
    subCategory: 'SSL Expiry',
    description,
    contact: {
      lastName: asset.responsible_person_name || asset.client || 'SSL Owner',
      email: responsibleEmail
    }
  };

  if (ZOHO_DEPARTMENT_ID) {
    payload.departmentId = ZOHO_DEPARTMENT_ID;
  }

  const assigneeId = await lookupAgentIdByEmail(responsibleEmail);
  if (assigneeId) {
    payload.assigneeId = assigneeId;
  }

  let response = await zohoFetch('/tickets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  let data = await response.json().catch(() => null);

  // Retry without assignee if agent privilege assignment fails.
  if (!response.ok && payload.assigneeId) {
    const assigneeError = Array.isArray(data?.errors)
      ? data.errors.find((e) => e?.fieldName === '/assigneeId')
      : null;

    if (assigneeError) {
      delete payload.assigneeId;
      response = await zohoFetch('/tickets', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      data = await response.json().catch(() => null);
    }
  }

  if (!response.ok || !data?.id) {
    await pool.query(
      `DELETE FROM ssl_expiry_alert_tickets
       WHERE id = $1 AND status = 'Pending'`,
      [alertRowId]
    );
    throw new Error(data?.message || `SSL alert ticket creation failed (${response.status})`);
  }

  await pool.query(
    `UPDATE ssl_expiry_alert_tickets
     SET zoho_ticket_id = $1,
         zoho_ticket_number = $2,
         status = 'Open'
     WHERE id = $3`,
    [data.id, data.ticketNumber || null, alertRowId]
  );

  await upsertSslAssignment(data.id, data.ticketNumber || null, responsibleEmail);
}

async function processSslAlerts() {
  try {
    const result = await pool.query('SELECT * FROM ssl_assets');
    console.log(`[SSL] Processing ${result.rows.length} assets for alert generation...`);

    for (const asset of result.rows) {
      const daysLeft = daysUntilDate(asset.ssl_expiry);
      if (!SSL_ALERT_MILESTONES.includes(daysLeft)) {
        continue;
      }

      try {
        console.log(`[SSL] Creating alert ticket for asset ${asset.id} at ${daysLeft} day milestone`);
        await createSslAlertTicket(asset, daysLeft);
        console.log(`[SSL] Alert ticket processed for asset ${asset.id}`);
      } catch (err) {
        console.error(`SSL alert generation failed for asset ${asset.id}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('SSL alert processor failed:', err?.message || err);
  }
}

// -------------------------------------------------------
//                     API ROUTES
// -------------------------------------------------------

// 🚀 OPTIMIZED: Production-grade caching system
const countsCache = new Map(); // Cache per user role
const COUNTS_CACHE_MS = 20 * 1000; // 20 seconds for near-real-time dashboard updates
let agentsCache = null;
let agentsCacheTime = 0;
const AGENTS_CACHE_MS = 30 * 60 * 1000; // 30 minutes for agents list

async function getActiveRecycledTicketIds() {
  try {
    const result = await pool.query(
      `SELECT zoho_ticket_id
       FROM recycled_tickets
       WHERE restored_at IS NULL
         AND expires_at > NOW()`
    );
    return new Set(result.rows.map(r => (r.zoho_ticket_id || '').toString()));
  } catch (err) {
    console.error('Failed to fetch recycled ticket ids:', err?.message || err);
    return new Set();
  }
}

app.get('/api/tickets/counts', authenticateToken, async (req, res) => {
  // Prevent browser/proxy caching; rely only on short-lived server cache.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  try {
    const userEmail = req.user?.email?.toLowerCase() || '';
    const userRole = (req.user?.role || 'user').toLowerCase();
    const isAdmin = userRole === 'admin';
    
    // Role-based cache key (admins all see the same counts)
    const cacheKey = isAdmin ? 'counts_admin' : `counts_user_${userEmail}`;
    const cached = countsCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.time) < COUNTS_CACHE_MS) {
      console.log(`[CACHE HIT] ${cacheKey}`);
      return res.json(cached.data);
    }
    
    console.log(`[CACHE MISS] ${cacheKey} - fetching fresh counts`);
    
    const recycledTicketIds = await getActiveRecycledTicketIds();

    async function getSupabaseAssignedTickets(email) {
      if (!email) return new Set();
      try {
        const result = await pool.query(
          "SELECT zoho_ticket_id FROM ticket_assignments WHERE $1 = ANY(assigned_users)",
          [email]
        );
        return new Set(result.rows.map(r => r.zoho_ticket_id));
      } catch (e) {
        console.error('Error fetching Supabase assignments:', e);
        return new Set();
      }
    }

    async function getAllSupabaseAssignedOpenTickets() {
      try {
        const result = await pool.query(
          `SELECT zoho_ticket_id
           FROM ticket_assignments
           WHERE status IS NULL OR LOWER(status) NOT IN ('closed', 'resolved')`
        );
        return new Set(result.rows.map(r => r.zoho_ticket_id));
      } catch (e) {
        console.error('Error fetching all Supabase open assignments:', e);
        return new Set();
      }
    }

    const mySupabaseAssignedIds = await getSupabaseAssignedTickets(userEmail);
    const allSupabaseAssignedOpenIds = isAdmin
      ? await getAllSupabaseAssignedOpenTickets()
      : new Set();

    // Helper to count tickets with filters and pagination.
    // Fetch one page with a single 429-retry; returns { tickets, more }
    const PAGE_SIZE = 100;
    const PARALLEL_PAGES = 3; // 2 pods × 3 statuses × 3 pages = 18 max concurrent Zoho requests
    async function fetchPageWithRetry(status, from) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let res;
        try {
          res = await zohoFetch(`/tickets?limit=${PAGE_SIZE}&from=${from}&status=${status}&include=assignee`);
        } catch (e) {
          console.error(`Network error fetching ${status} at from=${from}:`, e?.message || e);
          return { tickets: [], more: false };
        }
        if (res.status === 429) {
          console.warn(`Zoho 429 for ${status} at from=${from}, retrying in 2s`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        if (!res.ok) {
          console.error(`Zoho ${res.status} for ${status} at from=${from}`);
          return { tickets: [], more: false };
        }
        let data;
        try { data = await res.json(); } catch (e) { return { tickets: [], more: false }; }
        const tickets = data.data || [];
        const more = data.info?.moreRecords ?? (tickets.length >= PAGE_SIZE);
        return { tickets, more };
      }
      return { tickets: [], more: false };
    }

    // Scan all pages of a status in batches of PARALLEL_PAGES, calling perTicket for each
    async function scanPages(status, perTicket) {
      let from = 0;
      while (from < 10000) {
        const offsets = [];
        for (let i = 0; i < PARALLEL_PAGES; i++) {
          const o = from + i * PAGE_SIZE;
          if (o >= 10000) break;
          offsets.push(o);
        }
        if (!offsets.length) break;
        const results = await Promise.all(offsets.map(o => fetchPageWithRetry(status, o)));
        await new Promise(r => setTimeout(r, 400)); // pace batches to avoid saturating rate limit
        let anyMore = false;
        for (const { tickets, more } of results) {
          for (const t of tickets) {
            const ticketId = (t.id || '').toString();
            if (ticketId && !recycledTicketIds.has(ticketId)) perTicket(t, ticketId);
          }
          if (more) anyMore = true;
        }
        if (!anyMore) break;
        from += offsets.length * PAGE_SIZE;
      }
    }

    // Scan Open, Closed, and Resolved simultaneously; derive all 4 metrics in 3 passes.
    // Resolved is a fallback status used when Zoho rejects 'Closed' (422), so both must be counted.
    let openCount = 0, slaCount = 0, assignedCount = 0, closedCount = 0;

    function countClosed(t, ticketId) {
      if (isAdmin) {
        closedCount++;
      } else {
        const zohoAssignee = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
        const isMine = (!!userEmail && zohoAssignee === userEmail) || mySupabaseAssignedIds.has(ticketId);
        if (isMine) closedCount++;
      }
    }

    await Promise.all([
      scanPages('Open', (t, ticketId) => {
        const zohoAssignee = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
        const isMine = (!!userEmail && zohoAssignee === userEmail) || mySupabaseAssignedIds.has(ticketId);
        if (isAdmin || isMine) openCount++;
        if (isMine) {
          assignedCount++;
          const priority = (t.priority || '').toLowerCase();
          if (priority.includes('sla') || priority.includes('urgent') || priority.includes('critical')) slaCount++;
        }
      }),
      scanPages('Closed',   countClosed),
      scanPages('Resolved', countClosed)
    ]);

    console.log(`Counts for ${userEmail}: open=${openCount}, closed=${closedCount}, mySLA=${slaCount}, assigned=${assignedCount}`);

    const countData = {
      scope: isAdmin ? 'all' : 'mine',
      open: openCount,
      closed: closedCount,
      sla: slaCount,
      assigned: assignedCount,
      total: openCount + closedCount
    };
    
    // Cache the result
    countsCache.set(cacheKey, { data: countData, time: Date.now() });

    res.json(countData);
  } catch (err) {
    console.error('Counts error:', err);
    res.status(500).json({ error: 'Failed to fetch ticket counts' });
  }
});

// 🔧 GET ZOHO DESK AGENTS for assignment dropdown

app.get('/api/agents', authenticateToken, async (req, res) => {
  try {
    // Return cached agents if still valid
    if (agentsCache && (Date.now() - agentsCacheTime) < AGENTS_CACHE_MS) {
      return res.json(agentsCache);
    }

    const agents = [];
    const limit = 100;
    let from = 0;
    let hasMore = true;

    while (hasMore && from < 500) { // Max 500 agents
      const response = await zohoFetch(`/agents?limit=${limit}&from=${from}`);
      const data = await response.json();
      const batch = Array.isArray(data?.data) ? data.data : [];
      
      batch.forEach(a => {
        const email = (a.email || a.emailId || a.primaryEmail || '').trim().toLowerCase();
        const name = a.name || a.firstName || '';
        if (email) {
          agents.push({ id: a.id, email, name });
        }
      });

      hasMore = batch.length === limit;
      from += limit;
    }

    agentsCache = agents;
    agentsCacheTime = Date.now();
    res.json(agents);
  } catch (err) {
    console.error('Agents error:', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// Cache for user-filtered tickets (avoids re-scanning Zoho on every page)
const userTicketsCache = new Map(); // key: email_status -> { tickets, time }
const USER_TICKETS_CACHE_MS = 30 * 1000; // 30 seconds for faster reflection after changes

function invalidateRuntimeCaches() {
  countsCache.clear();
  userTicketsCache.clear();
}

app.get('/api/tickets', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 27;
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status;
    const search = req.query.search;
    const filterByEmail = req.query.filterByEmail; // Server-side user filter
    const from = (page - 1) * limit;
    const include = 'contacts,assignee';

    // If filterByEmail is set, use cached user tickets
    if (filterByEmail) {
      const userEmail = filterByEmail.toLowerCase();
      const cacheKey = `${userEmail}_${status || 'all'}`;
      const startIdx = (page - 1) * limit;
      const neededForPage = startIdx + limit + 1;
      const cached = userTicketsCache.get(cacheKey);

      let allUserTickets;
      let partialPageOnly = false;
      if (cached && (Date.now() - cached.time) < USER_TICKETS_CACHE_MS) {
        allUserTickets = cached.tickets;
      } else {
        // Scan Zoho in PARALLEL batches for speed
        const startTime = Date.now();
        const apiPageSize = 100;
        const PARALLEL_BATCH = 5; // 5 parallel requests at a time

        const [recycledIds, supabaseResult] = await Promise.all([
          getActiveRecycledTicketIds(),
          pool.query(
            "SELECT zoho_ticket_id FROM ticket_assignments WHERE $1 = ANY(assigned_users)",
            [userEmail]
          ).catch(e => { console.error('Supabase assignment fetch error:', e); return { rows: [] }; })
        ]);
        const supabaseAssignedIds = new Set(supabaseResult.rows.map(r => r.zoho_ticket_id));

        // Helper to filter tickets from a Zoho response
        function filterMyTickets(tickets) {
          const result = [];
          for (const t of tickets) {
            const ticketId = (t.id || '').toString();
            if (!ticketId || recycledIds.has(ticketId)) continue;
            const contactEmail = (t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail || '').toLowerCase();
            const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
            if (contactEmail === userEmail || assigneeEmail === userEmail || supabaseAssignedIds.has(ticketId)) {
              result.push({
                ...t,
                email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
                assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId
              });
            }
          }
          return result;
        }

        // First, do a quick probe to find how many pages exist
        let statusParam = '';
        if (status === 'open') statusParam = '&status=Open';
        else if (status === 'closed') statusParam = '&status=Closed';

        allUserTickets = [];
        let zohoFrom = 0;
        let keepScanning = true;

        while (keepScanning) {
          // Launch PARALLEL_BATCH requests at once
          const batchPromises = [];
          for (let i = 0; i < PARALLEL_BATCH; i++) {
            const offset = zohoFrom + i * apiPageSize;
            if (offset > 5000) break; // Safety cap
            const ep = `/tickets?limit=${apiPageSize}&from=${offset}&include=${include}${statusParam}`;
            batchPromises.push(
              zohoFetch(ep)
                .then(r => r.ok ? r.json() : { data: [] })
                .then(d => ({ data: d.data || [], offset }))
                .catch(() => ({ data: [], offset }))
            );
          }

          if (batchPromises.length === 0) break;

          const batchResults = await Promise.all(batchPromises);

          // Sort by offset to maintain order
          batchResults.sort((a, b) => a.offset - b.offset);

          let anyPageFull = false;
          for (const result of batchResults) {
            const myTickets = filterMyTickets(result.data);
            allUserTickets.push(...myTickets);

            // Short-circuit once we have enough rows for the requested page.
            if (allUserTickets.length >= neededForPage) {
              partialPageOnly = true;
              keepScanning = false;
              break;
            }

            if (result.data.length === apiPageSize) anyPageFull = true;
          }

          if (!keepScanning) break;

          // If no page in batch was full, we've reached the end
          if (!anyPageFull) {
            keepScanning = false;
          } else {
            zohoFrom += PARALLEL_BATCH * apiPageSize;
            if (zohoFrom > 5000) keepScanning = false;
          }
        }

        // Cache only full scans. Partial scans are page-optimized and should not poison cache.
        if (!partialPageOnly) {
          userTicketsCache.set(cacheKey, { tickets: allUserTickets, time: Date.now() });
        }
        console.log(`Cached ${allUserTickets.length} tickets for ${userEmail} (${status || 'all'}) in ${Date.now() - startTime}ms`);
      }

      // Paginate from cached results
      const pageData = allUserTickets.slice(startIdx, startIdx + limit);
      const hasMore = partialPageOnly
        ? pageData.length === limit
        : startIdx + limit < allUserTickets.length;

      return res.json({
        page,
        limit,
        count: pageData.length,
        hasMore,
        data: pageData
      });
    }

    // Standard path (no user filter)
    let endpoint = `/tickets?limit=${limit}&from=${from}&include=${include}`;

    if (status === 'open') {
      endpoint += `&status=Open`;
    } else if (status === 'closed') {
      endpoint += `&status=Closed`;
    }

    const baseEndpoint = endpoint;
    const searchEndpoint = search
      ? `${endpoint}&searchText=${encodeURIComponent(search)}`
      : endpoint;

    let response = await zohoFetch(searchEndpoint);

    // Zoho searchText rejects some values (e.g., emails). Fallback to base listing.
    if (search && response.status === 422) {
      response = await zohoFetch(baseEndpoint);
    }
    
    // Check if Zoho API returned an error
    if (!response.ok) {
      console.error(`Zoho API error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json({ 
        error: 'Failed to fetch tickets from Zoho',
        details: errorData?.message || errorData?.error || 'Unknown error'
      });
    }
    
    const data = await response.json();
    const normalized = (data.data || []).map(t => ({
      ...t,
      email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
      assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId
    }));

    const recycledIds = await getActiveRecycledTicketIds();
    const filtered = normalized.filter(t => !recycledIds.has((t.id || '').toString()));

    res.json({
      page,
      limit,
      count: filtered.length || 0,
      hasMore: (data.data || []).length === limit,
      data: filtered
    });
  } catch (err) {
    console.error('Tickets endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tickets', details: err.message });
  }
});

app.get('/api/tickets/recycle-bin', authenticateToken, async (req, res) => {
  try {
    const userEmail = (req.user?.email || '').toLowerCase();

    await pool.query(
      `DELETE FROM recycled_tickets
       WHERE restored_at IS NULL
         AND expires_at <= NOW()`
    );

    const result = await pool.query(
      `SELECT
         zoho_ticket_id,
         zoho_ticket_number,
         subject,
         email,
         priority,
         deleted_by,
         deleted_at,
         expires_at,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400))::INT AS expires_in_days
       FROM recycled_tickets
       WHERE restored_at IS NULL
         AND LOWER(deleted_by) = $1
         AND expires_at > NOW()
       ORDER BY deleted_at DESC`,
      [userEmail]
    );

    return res.json({ data: result.rows });
  } catch (err) {
    console.error('Recycle bin fetch failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to fetch recycle bin' });
  }
});

app.post('/api/tickets/:id/recycle', authenticateToken, async (req, res) => {
  // Invalidate caches
  invalidateRuntimeCaches();
  try {
    const ticketId = (req.params.id || '').toString();
    if (!ticketId) {
      return res.status(400).json({ error: 'Ticket id is required' });
    }

    let snapshot = req.body?.ticket || null;

    if (!snapshot) {
      const detailRes = await zohoFetch(`/tickets/${ticketId}?include=contacts,assignee`);
      if (detailRes.ok) {
        snapshot = await detailRes.json();
      }
    }

    const source = snapshot?.data || snapshot || {};
    const ticketNumber = source.ticketNumber || source.displayId || source.id || ticketId;
    const subject = source.subject || 'No Subject';
    const email = source.email || source.contact?.email || source.contact?.emailAddress || null;
    const priority = source.priority || null;
    const deletedBy = (req.user?.email || '').toLowerCase() || 'unknown';

    await pool.query(
      `INSERT INTO recycled_tickets
        (zoho_ticket_id, zoho_ticket_number, subject, email, priority, deleted_by, deleted_at, expires_at, restored_at, snapshot, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '30 days', NULL, $7::jsonb, NOW())
       ON CONFLICT (zoho_ticket_id)
       DO UPDATE SET
         zoho_ticket_number = EXCLUDED.zoho_ticket_number,
         subject = EXCLUDED.subject,
         email = EXCLUDED.email,
         priority = EXCLUDED.priority,
         deleted_by = EXCLUDED.deleted_by,
         deleted_at = NOW(),
         expires_at = NOW() + INTERVAL '30 days',
         restored_at = NULL,
         snapshot = EXCLUDED.snapshot,
         updated_at = NOW()`,
      [ticketId, `${ticketNumber}`, subject, email, priority, deletedBy, JSON.stringify(source || {})]
    );

    invalidateRuntimeCaches();

    return res.json({ message: 'Ticket moved to recycle bin' });
  } catch (err) {
    console.error('Recycle ticket failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to move ticket to recycle bin' });
  }
});

app.post('/api/tickets/recycle-bin/:ticketId/restore', authenticateToken, async (req, res) => {
  // Invalidate caches
  invalidateRuntimeCaches();
  try {
    const ticketId = (req.params.ticketId || '').toString();
    const userEmail = (req.user?.email || '').toLowerCase();
    const result = await pool.query(
      `UPDATE recycled_tickets
       SET restored_at = NOW(), updated_at = NOW()
       WHERE zoho_ticket_id = $1
         AND restored_at IS NULL
         AND LOWER(deleted_by) = $2
       RETURNING zoho_ticket_id`,
      [ticketId, userEmail]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket not found in recycle bin' });
    }

    invalidateRuntimeCaches();

    return res.json({ message: 'Ticket restored successfully' });
  } catch (err) {
    console.error('Restore recycle ticket failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to restore ticket' });
  }
});

app.delete('/api/tickets/recycle-bin/:ticketId', authenticateToken, async (req, res) => {
  try {
    const ticketId = (req.params.ticketId || '').toString();
    const userEmail = (req.user?.email || '').toLowerCase();
    const result = await pool.query(
      `DELETE FROM recycled_tickets
       WHERE zoho_ticket_id = $1
         AND LOWER(deleted_by) = $2
       RETURNING zoho_ticket_id`,
      [ticketId, userEmail]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Ticket not found in recycle bin' });
    }

    invalidateRuntimeCaches();

    return res.json({ message: 'Ticket permanently deleted from recycle bin' });
  } catch (err) {
    console.error('Permanent delete recycle ticket failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to permanently delete ticket' });
  }
});

app.get('/api/tickets/:id',  authenticateToken,async (req, res) => {
  try {
    // Include assignee/contact fields so permission checks on the UI are accurate for assigned users.
    const response = await zohoFetch(`/tickets/${req.params.id}?include=contacts,assignee`);
    res.json(await response.json());
  } catch {
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

app.patch('/api/tickets/:id', authenticateToken, async (req, res) => {
  try {
    const payload = req.body || {};
    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No update fields provided' });
    }

    const response = await zohoFetch(`/tickets/${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return res.status(response.status).json(data || { error: 'Failed to update ticket' });
    }

    // Invalidate counts caches on ticket update (status changes affect counts)
    countsCache.clear();
    userTicketsCache.clear();

    return res.json(data || { status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticket', details: err?.message || String(err) });
  }
});

app.get('/api/tickets/:id/conversations', authenticateToken, async (req, res) => {
  try {
    const response = await zohoFetch(`/tickets/${req.params.id}/conversations`);
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    if (!Array.isArray(data?.data)) {
      return res.json(data);
    }

    // Always fetch full conversation details for every conversation
    // Zoho uses /threads/{id} for email threads and /comments/{id} for comments
    const detailRequests = data.data.map(async (conv, idx) => {
      try {
        // Determine the correct sub-endpoint based on conversation type
        const convType = (conv.type || '').toLowerCase();
        let detailEndpoint;
        if (convType === 'comment') {
          detailEndpoint = `/tickets/${req.params.id}/comments/${conv.id}`;
        } else {
          // Default to threads for email-type conversations
          detailEndpoint = `/tickets/${req.params.id}/threads/${conv.id}`;
        }

        const detailRes = await zohoFetch(detailEndpoint);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const detailData = detail?.data || detail;
          return { idx, enriched: { ...conv, ...detailData } };
        } else {
          // Try the other endpoint as fallback
          const fallbackEndpoint = convType === 'comment'
            ? `/tickets/${req.params.id}/threads/${conv.id}`
            : `/tickets/${req.params.id}/comments/${conv.id}`;
          const fallbackRes = await zohoFetch(fallbackEndpoint);
          if (fallbackRes.ok) {
            const fallback = await fallbackRes.json();
            const fallbackData = fallback?.data || fallback;
            return { idx, enriched: { ...conv, ...fallbackData } };
          }
        }
      } catch {
        // ignore enrichment errors, fall back to original
      }
      return { idx, enriched: conv };
    });

    const enriched = await Promise.allSettled(detailRequests);
    const resultData = [...data.data];

    enriched.forEach((result) => {
      if (result.status === 'fulfilled') {
        resultData[result.value.idx] = result.value.enriched;
      }
    });

    // Look up actual sender names for replies made through our app
    const convIds = resultData.map(c => (c.id || '').toString()).filter(Boolean);
    let replyAuthorMap = new Map();
    if (convIds.length) {
      try {
        const ra = await pool.query(
          `SELECT zoho_conversation_id, user_name FROM reply_authors WHERE zoho_conversation_id = ANY($1)`,
          [convIds]
        );
        for (const r of ra.rows) replyAuthorMap.set(r.zoho_conversation_id, r.user_name);
      } catch (e) { console.error('reply_authors lookup error:', e?.message); }
    }

    resultData.forEach(conv => {
      const cid = (conv.id || '').toString();
      if (replyAuthorMap.has(cid)) {
        conv.resolvedAuthorName = replyAuthorMap.get(cid);
        return;
      }
      const a = conv.author || {};
      const c = conv.commenter || {};
      const fullName = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
      const commenterName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
      conv.resolvedAuthorName =
        c.name ||
        commenterName ||
        a.name ||
        fullName ||
        conv.fromName ||
        conv.submitter?.name ||
        conv.contact?.name ||
        [conv.contact?.firstName, conv.contact?.lastName].filter(Boolean).join(' ').trim() ||
        c.email ||
        conv.from ||
        conv.fromEmailAddress ||
        a.email ||
        a.emailId ||
        '';
    });

    res.json({ ...data, data: resultData });
  } catch {
    res.status(500).json({ error: 'Failed to fetch ticket conversations' });
  }
});

app.get('/api/tickets/:id/attachments',  authenticateToken,async (req, res) => {
  try {
    const response = await zohoFetch(`/tickets/${req.params.id}/attachments`);
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

app.get('/api/tickets/:id/attachments/:attachmentId', authenticateToken, async (req, res) => {
  try {
    const { id, attachmentId } = req.params;
    let response = await zohoFetch(`/tickets/${id}/attachments/${attachmentId}/content`);

    // Some Zoho attachment responses are available without the /content suffix.
    if (!response.ok && response.status === 404) {
      response = await zohoFetch(`/tickets/${id}/attachments/${attachmentId}`);
    }

    if (!response.ok) {
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = { error: 'Failed to fetch attachment content' };
      }
      return res.status(response.status).json(data);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const disposition = response.headers.get('content-disposition');

    res.setHeader('Content-Type', contentType);
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', 'attachment');
    } else if (req.query.inline === '1') {
      if (disposition && disposition.toLowerCase().includes('filename=')) {
        const filename = disposition.split('filename=')[1] || '';
        res.setHeader('Content-Disposition', `inline; filename=${filename}`);
      } else {
        res.setHeader('Content-Disposition', 'inline');
      }
    } else if (disposition) {
      res.setHeader('Content-Disposition', disposition);
    }

    response.body.pipe(res);
  } catch {
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

app.get('/api/zoho-content', authenticateToken, async (req, res) => {
  try {
    const rawPath = (req.query.path || '').toString().trim();
    if (!rawPath) {
      return res.status(400).json({ error: 'path query is required' });
    }

    // Only allow Zoho Desk API v1 paths.
    let apiPath = rawPath;
    if (/^https?:\/\//i.test(rawPath)) {
      const parsed = new URL(rawPath);
      apiPath = `${parsed.pathname}${parsed.search || ''}`;
    }

    const v1Index = apiPath.toLowerCase().indexOf('/api/v1/');
    if (v1Index >= 0) {
      apiPath = apiPath.slice(v1Index + '/api/v1'.length);
    }

    if (!apiPath.startsWith('/')) {
      apiPath = `/${apiPath}`;
    }

    const response = await zohoFetch(apiPath);
    if (!response.ok) {
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = { error: 'Failed to fetch Zoho content' };
      }
      return res.status(response.status).json(data);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const disposition = response.headers.get('content-disposition');

    res.setHeader('Content-Type', contentType);
    if (disposition) {
      res.setHeader('Content-Disposition', disposition);
    }

    response.body.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch Zoho content', details: err?.message || String(err) });
  }
});

app.post('/api/tickets/:id/attachments', upload.array('attachments'),  authenticateToken,async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No attachments provided' });
    }

    const uploaded = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file.buffer, file.originalname);
      const upRes = await zohoFetch(`/tickets/${req.params.id}/attachments`, {
        method: 'POST',
        body: fd,
        headers: fd.getHeaders()
      });
      const upData = await upRes.json();
      uploaded.push({ ok: upRes.ok, data: upData });
    }

    res.json({ uploaded });
  } catch {
    res.status(500).json({ error: 'Failed to upload attachments' });
  }
});

app.post("/api/msal-login", async (req, res) => {
  try {
    const { email, accessToken } = req.body;

    if (!email || !accessToken) {
      return res.status(400).json({ message: "Missing data" });
    }

    const normalize = (v) => (v || '').toString().trim().toLowerCase();
    const normalizedEmail = normalize(email);

    // Step 1: Check Microsoft Graph for cloudops@muraai.com group membership
    let isInAdminGroup = false;
    let roleSource = 'default';
    
    try {
      let url = 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=mail,displayName,mailNickname';
      
      while (url && !isInAdminGroup) {
        const graphResponse = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!graphResponse.ok) {
          console.warn(`[MSAL LOGIN] Graph API check failed for ${normalizedEmail}: ${graphResponse.status}`);
          break;
        }

        const data = await graphResponse.json();
        const groups = Array.isArray(data?.value) ? data.value : [];

        isInAdminGroup = groups.some((g) => {
          const mail = normalize(g.mail);
          const displayName = normalize(g.displayName);
          const nickname = normalize(g.mailNickname);
          return mail === 'cloudops@muraai.com' || displayName === 'cloudops' || nickname === 'cloudops';
        });

        url = data['@odata.nextLink'] || '';
      }
      
      if (isInAdminGroup) {
        roleSource = 'graph-cloudops-group';
      }
    } catch (graphErr) {
      console.warn(`[MSAL LOGIN] Graph API error for ${normalizedEmail}:`, graphErr?.message || graphErr);
    }

    // Step 2: Check user_roles table for explicit role assignment (can override Graph membership)
    let dbRole = null;
    try {
      const roleResult = await pool.query(
        `SELECT role FROM user_roles WHERE LOWER(microsoft_email) = $1 LIMIT 1`,
        [normalizedEmail]
      );
      if (roleResult.rows.length > 0) {
        dbRole = (roleResult.rows[0]?.role || '').toString().toLowerCase();
        roleSource = 'user_roles-db';
        console.log(`[MSAL LOGIN] Found explicit DB role for ${normalizedEmail}: ${dbRole}`);
      }
    } catch (dbErr) {
      console.warn(`[MSAL LOGIN] DB role check failed for ${normalizedEmail}:`, dbErr?.message || dbErr);
    }

    // Step 3: Determine final role
    let role = 'user'; // default
    if (dbRole) {
      // DB role takes priority (explicit admin assignment)
      role = dbRole;
    } else if (isInAdminGroup) {
      // Graph group membership (cloudops@muraai.com)
      role = 'admin';
    }
    
    console.log(`[MSAL LOGIN] ${normalizedEmail} resolved role=${role} via ${roleSource}`);

    const newAccessToken = jwt.sign(
      { email: normalizedEmail, role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      { email: normalizedEmail, role },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ accessToken: newAccessToken, refreshToken, role });

  } catch (err) {
    console.error('MSAL login error:', err?.message);
    res.status(500).json({ error: "MSAL login failed" });
  }
});


app.post('/api/tickets/:id/reply', upload.array('attachments'),  authenticateToken,async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const content = req.body?.content || '';
    const senderName = req.body?.senderName || req.user?.email?.split('@')[0] || '';
    const senderEmail = req.user?.email || '';
    const isPublicStr = req.body?.isPublic === 'true' ? 'true' : 'false';
    const isPublicBool = req.body?.isPublic === 'true';

    const attempts = [
      { type: 'form', path: `/tickets/${req.params.id}/reply`, includeContentType: true },
      { type: 'form', path: `/tickets/${req.params.id}/sendReply`, includeContentType: true },
      { type: 'form', path: `/tickets/${req.params.id}/sendReply`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/comment`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/conversations`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/threads`, includeContentType: false }
    ];

    const errors = [];

    for (const attempt of attempts) {
      let response;
      if (attempt.type === 'form') {
        const fd = new FormData();
        fd.append('content', content);
        fd.append('isPublic', isPublicStr);
        if (attempt.includeContentType) {
          fd.append('contentType', 'text/html');
        }

        for (const file of files) {
          fd.append('attachments', file.buffer, file.originalname);
        }

        response = await zohoFetch(attempt.path, {
          method: 'POST',
          body: fd,
          headers: fd.getHeaders()
        });
      } else {
        const payload = {
          content,
          isPublic: isPublicBool
        };
        if (attempt.includeContentType) {
          payload.contentType = 'text/html';
        }

        response = await zohoFetch(attempt.path, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (response.ok) {
        const convId = (data?.id || '').toString();
        if (convId && senderEmail) {
          pool.query(
            `INSERT INTO reply_authors (zoho_ticket_id, zoho_conversation_id, user_email, user_name)
             VALUES ($1, $2, $3, $4) ON CONFLICT (zoho_conversation_id) DO NOTHING`,
            [req.params.id, convId, senderEmail, senderName]
          ).catch(e => console.error('Failed to save reply author:', e?.message));
        }
        return res.json(data || { status: 'ok' });
      }

      errors.push({ status: response.status, data, path: attempt.path });
    }

    return res.status(502).json({
      error: 'Reply failed',
      attempts: errors
    });
  } catch (err) {
    console.error('Reply error', err);
    res.status(500).json({
      error: 'Failed to send reply',
      message: err?.message || String(err)
    });
  }
});

app.post('/api/tickets', upload.array('attachments'), authenticateToken, async (req, res) => {
  try {
    const isMultipart = req.is('multipart/form-data');
    const body = isMultipart ? (req.body || {}) : (req.body || {});

    let payload;
    if (isMultipart) {
      let contact = undefined;
      if (body.contact) {
        try {
          contact = JSON.parse(body.contact);
        } catch {
          contact = undefined;
        }
      }

      payload = {
        subject: body.subject,
        departmentId: body.departmentId,
        priority: body.priority,
        description: body.description,
        status: body.status || 'Open',
        ...(body.assigneeEmail ? { assigneeEmail: body.assigneeEmail } : {}),
        contact: contact || {
          lastName: body.name || body.contactName || '',
          email: body.email || body.contactEmail || ''
        }
      };
    } else {
      payload = { ...(body || {}) };
    }

    if (!payload.assigneeId && payload.assigneeEmail) {
      const agentId = await lookupAgentIdByEmail(payload.assigneeEmail);
      if (agentId) {
        payload.assigneeId = agentId;
      } else {
        return res.status(400).json({
          errorCode: 'ASSIGNEE_NOT_FOUND',
          message: 'Assign To email not found as a Zoho Desk agent.'
        });
      }
    }
    delete payload.assigneeEmail;
    if (ZOHO_DEPARTMENT_ID) {
      payload.departmentId = ZOHO_DEPARTMENT_ID;
    }
    if (ZOHO_ASSIGNEE_ID) {
      payload.assigneeId = ZOHO_ASSIGNEE_ID;
    }

    const response = await zohoFetch('/tickets', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      const errorList = Array.isArray(data?.errors)
        ? data.errors
        : Array.isArray(data?.details?.errors)
          ? data.details.errors
          : Array.isArray(data?.details)
            ? data.details
            : [];

      const assigneeError = errorList.find(e => {
        const field = (e?.fieldName || '').toString().replace(/^\//, '');
        return field === 'assigneeId';
      });

      if (payload.assigneeId && assigneeError) {
        const retryPayload = { ...payload };
        delete retryPayload.assigneeId;

        const retryResponse = await zohoFetch('/tickets', {
          method: 'POST',
          body: JSON.stringify(retryPayload)
        });

        const retryData = await retryResponse.json();
        if (retryResponse.ok) {
          return res.status(200).json({
            ...retryData,
            warning: 'Assignee lacks privilege. Ticket created as Unassigned.'
          });
        }
      }

      console.error('Zoho create ticket failed:', data);
      return res.status(response.status).json({
        errorCode: data?.errorCode,
        message: data?.message || 'Zoho validation failed',
        details: data?.details || data
      });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length > 0 && data?.id) {
      const uploaded = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append('file', file.buffer, file.originalname);
        const upRes = await zohoFetch(`/tickets/${data.id}/attachments`, {
          method: 'POST',
          body: fd,
          headers: fd.getHeaders()
        });
        const upData = await upRes.json();
        uploaded.push({ ok: upRes.ok, data: upData });
      }
      invalidateRuntimeCaches();
      return res.status(response.status).json({
        ...data,
        attachments: uploaded
      });
    }

    invalidateRuntimeCaches();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

app.patch("/api/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { role } = req.body;

    const allowedRoles = ["admin", "support", "user"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2",
      [role, req.params.id]
    );

    res.json({ message: "Role updated" });

  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});



app.delete("/api/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const userId = req.params.id;

    // prevent deleting yourself
    const result = await pool.query(
      "SELECT email FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    if (result.rows[0].email === req.user.email) {
      return res.status(400).json({ message: "You cannot delete yourself" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [userId]);

    res.json({ message: "User deleted" });

  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});

// -------------------------------------------------------
// IHUB API
// -------------------------------------------------------

app.get('/api/ihub', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        a.*,
        (a.license_expiry::date - CURRENT_DATE) AS days_to_expiry
       FROM ihub_assets a
       ORDER BY a.license_expiry ASC, a.client ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch IHUB assets:', err);
    res.status(500).json({ message: 'Failed to fetch IHUB assets' });
  }
});

app.post('/api/ihub', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const {
      client,
      environment,
      hostname,
      ip_address,
      ihub_version,
      license_expiry,
      responsible_person_email,
      responsible_person_name
    } = req.body || {};

    if (!client || !environment || !license_expiry || !responsible_person_email) {
      return res.status(400).json({ message: 'Missing required IHUB fields' });
    }

    if (!isValidDateInput(license_expiry)) {
      return res.status(400).json({ message: 'Invalid license expiry date' });
    }

    const result = await pool.query(
      `INSERT INTO ihub_assets
        (client, environment, hostname, ip_address, ihub_version, license_expiry, responsible_person_email, responsible_person_name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING *`,
      [
        client,
        environment,
        hostname || '',
        ip_address || '',
        ihub_version || null,
        normalizeDateOnly(license_expiry),
        responsible_person_email.toLowerCase(),
        responsible_person_name || null,
        (req.user?.email || '').toLowerCase() || null
      ]
    );

    await processIhubAlerts();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to create IHUB asset:', err);
    res.status(500).json({ message: 'Failed to create IHUB asset' });
  }
});

app.put('/api/ihub/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assetId)) {
      return res.status(400).json({ message: 'Invalid IHUB asset id' });
    }

    const {
      client,
      environment,
      hostname,
      ip_address,
      ihub_version,
      license_expiry,
      responsible_person_email,
      responsible_person_name
    } = req.body || {};

    if (!client || !environment || !license_expiry || !responsible_person_email) {
      return res.status(400).json({ message: 'Missing required IHUB fields' });
    }

    if (!isValidDateInput(license_expiry)) {
      return res.status(400).json({ message: 'Invalid license expiry date' });
    }

    const result = await pool.query(
      `UPDATE ihub_assets SET
         client = $1,
         environment = $2,
         hostname = $3,
         ip_address = $4,
         ihub_version = $5,
         license_expiry = $6,
         responsible_person_email = $7,
         responsible_person_name = $8,
         updated_by = $9,
         updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        client,
        environment,
        hostname || '',
        ip_address || '',
        ihub_version || null,
        normalizeDateOnly(license_expiry),
        responsible_person_email.toLowerCase(),
        responsible_person_name || null,
        (req.user?.email || '').toLowerCase() || null,
        assetId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'IHUB asset not found' });
    }

    await pool.query(
      `UPDATE ihub_alert_tickets
       SET status = 'Superseded', closed_at = NOW()
       WHERE ihub_asset_id = $1 AND status = 'Open'`,
      [assetId]
    );

    await processIhubAlerts();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update IHUB asset:', err);
    res.status(500).json({ message: 'Failed to update IHUB asset' });
  }
});

app.delete('/api/ihub/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assetId)) {
      return res.status(400).json({ message: 'Invalid IHUB asset id' });
    }

    const existingAsset = await pool.query(
      'SELECT id FROM ihub_assets WHERE id = $1 LIMIT 1',
      [assetId]
    );

    if (existingAsset.rows.length === 0) {
      return res.status(404).json({ message: 'IHUB asset not found' });
    }

    const alertTicketIdsResult = await pool.query(
      `SELECT zoho_ticket_id
       FROM ihub_alert_tickets
       WHERE ihub_asset_id = $1`,
      [assetId]
    );
    const alertTicketIds = alertTicketIdsResult.rows
      .map(r => r.zoho_ticket_id)
      .filter(Boolean);

    await pool.query('DELETE FROM ihub_assets WHERE id = $1', [assetId]);

    if (alertTicketIds.length > 0) {
      await pool.query(
        `UPDATE ticket_assignments
         SET status = 'Closed',
             closed_at = NOW(),
             closed_by = $1,
             updated_at = NOW()
         WHERE zoho_ticket_id = ANY($2::text[])
           AND category = 'IHUB'`,
        [(req.user?.email || '').toLowerCase() || null, alertTicketIds]
      );
    }

    res.json({ message: 'IHUB asset deleted successfully' });
  } catch (err) {
    console.error('Failed to delete IHUB asset:', err);
    res.status(500).json({ message: 'Failed to delete IHUB asset' });
  }
});

// -------------------------------------------------------
// SSL API
// -------------------------------------------------------

app.get('/api/ssl', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        s.*,
        (s.ssl_expiry::date - CURRENT_DATE) AS days_to_expiry
       FROM ssl_assets s
       ORDER BY s.ssl_expiry ASC, s.client ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch SSL assets:', err);
    res.status(500).json({ message: 'Failed to fetch SSL assets' });
  }
});

app.post('/api/ssl', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const {
      client,
      environment,
      hostname,
      ip_address,
      application,
      version,
      ssl_url,
      responsible_person_email,
      responsible_person_name,
      ssl_expiry
    } = req.body || {};

    if (!client || !environment || !ssl_url || !responsible_person_email || !ssl_expiry) {
      return res.status(400).json({ message: 'Missing required SSL fields' });
    }

    if (!isValidDateInput(ssl_expiry)) {
      return res.status(400).json({ message: 'Invalid SSL expiry date' });
    }

    const result = await pool.query(
      `INSERT INTO ssl_assets
        (client, environment, hostname, ip_address, application, version, ssl_url, responsible_person_email, responsible_person_name, ssl_expiry, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
       RETURNING *`,
      [
        client,
        environment,
        hostname || '',
        ip_address || '',
        application || '',
        version || null,
        ssl_url,
        responsible_person_email.toLowerCase(),
        responsible_person_name || null,
        normalizeDateOnly(ssl_expiry),
        (req.user?.email || '').toLowerCase() || null
      ]
    );

    await processSslAlerts();

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to create SSL asset:', err);
    res.status(500).json({ message: 'Failed to create SSL asset' });
  }
});

app.put('/api/ssl/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assetId)) {
      return res.status(400).json({ message: 'Invalid SSL asset id' });
    }

    const {
      client,
      environment,
      hostname,
      ip_address,
      application,
      version,
      ssl_url,
      responsible_person_email,
      responsible_person_name,
      ssl_expiry
    } = req.body || {};

    if (!client || !environment || !ssl_url || !responsible_person_email || !ssl_expiry) {
      return res.status(400).json({ message: 'Missing required SSL fields' });
    }

    if (!isValidDateInput(ssl_expiry)) {
      return res.status(400).json({ message: 'Invalid SSL expiry date' });
    }

    const result = await pool.query(
      `UPDATE ssl_assets SET
         client = $1,
         environment = $2,
         hostname = $3,
         ip_address = $4,
         application = $5,
         version = $6,
         ssl_url = $7,
         responsible_person_email = $8,
         responsible_person_name = $9,
         ssl_expiry = $10,
         updated_by = $11,
         updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [
        client,
        environment,
        hostname || '',
        ip_address || '',
        application || '',
        version || null,
        ssl_url,
        responsible_person_email.toLowerCase(),
        responsible_person_name || null,
        normalizeDateOnly(ssl_expiry),
        (req.user?.email || '').toLowerCase() || null,
        assetId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SSL asset not found' });
    }

    await processSslAlerts();

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update SSL asset:', err);
    res.status(500).json({ message: 'Failed to update SSL asset' });
  }
});

app.delete('/api/ssl/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assetId)) {
      return res.status(400).json({ message: 'Invalid SSL asset id' });
    }

    const result = await pool.query('DELETE FROM ssl_assets WHERE id = $1 RETURNING id', [assetId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'SSL asset not found' });
    }

    res.json({ message: 'SSL asset deleted successfully' });
  } catch (err) {
    console.error('Failed to delete SSL asset:', err);
    res.status(500).json({ message: 'Failed to delete SSL asset' });
  }
});

app.post('/api/ssl/run-expiry-check', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    await processSslAlerts();
    res.json({ message: 'SSL expiry check completed successfully' });
  } catch (err) {
    console.error('Failed to run SSL expiry check:', err);
    res.status(500).json({ message: 'SSL expiry check failed' });
  }
});

// -------------------------------------------------------
// SSL ALERT TICKETS API
// -------------------------------------------------------
app.get('/api/ssl/alerts', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const sslAssetId = req.query.ssl_asset_id;
    let query = `
      SELECT 
        a.id,
        a.ssl_asset_id,
        s.client,
        s.hostname,
        a.milestone_days,
        a.ssl_expiry_on,
        a.zoho_ticket_id,
        a.zoho_ticket_number,
        a.status,
        a.created_at,
        a.closed_at
      FROM ssl_expiry_alert_tickets a
      JOIN ssl_assets s ON a.ssl_asset_id = s.id
      WHERE a.status = 'Open'
    `;
    const params = [];

    if (sslAssetId) {
      query += ` AND a.ssl_asset_id = $1`;
      params.push(sslAssetId);
    }

    query += ` ORDER BY a.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to get SSL alerts:', err);
    res.status(500).json({ message: 'Failed to get SSL alerts' });
  }
});

app.post('/api/ssl/tickets/:zohoTicketId/close', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.zohoTicketId;
    const newExpiryDate = req.body?.new_expiry_date;
    const userEmail = (req.user?.email || '').toLowerCase();
    const isAdmin = req.user?.role === 'admin';

    const assignmentResult = await pool.query(
      `SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1 LIMIT 1`,
      [ticketId]
    );
    const assignment = assignmentResult.rows[0];

    if (!assignment || (assignment.category || '').toUpperCase() !== 'SSL') {
      return res.status(404).json({ message: 'SSL ticket assignment not found' });
    }

    const assignedUsers = Array.isArray(assignment.assigned_users)
      ? assignment.assigned_users.map(u => (u || '').toLowerCase())
      : [];

    if (!isAdmin && !assignedUsers.includes(userEmail)) {
      return res.status(403).json({ message: 'Only responsible person or admin can close SSL ticket' });
    }

    const automationAlertResult = await pool.query(
      `SELECT * FROM alertmanager_ssl_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
      [ticketId]
    );
    const automationAlert = automationAlertResult.rows[0];

    // Automation SSL tickets are URL-driven; they do not need manual expiry updates while closing.
    if (automationAlert) {
      const closedInZoho = await closeZohoTicketWithFallback(ticketId);
      if (!closedInZoho) {
        return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
      }

      await pool.query(
        `UPDATE alertmanager_ssl_tickets
         SET status = 'Closed',
             closed_at = NOW(),
             updated_at = NOW()
         WHERE zoho_ticket_id = $1`,
        [ticketId]
      );

      await pool.query(
        `UPDATE ticket_assignments
         SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
         WHERE zoho_ticket_id = $2`,
        [userEmail || null, ticketId]
      );

      return res.json({
        message: 'Automation SSL ticket closed successfully'
      });
    }

    if (!isValidDateInput(newExpiryDate)) {
      return res.status(400).json({ message: 'Valid new_expiry_date is required' });
    }

    const alertResult = await pool.query(
      `SELECT * FROM ssl_expiry_alert_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
      [ticketId]
    );
    const alert = alertResult.rows[0];

    if (!alert) {
      return res.status(404).json({ message: 'SSL alert record not found for this ticket' });
    }

    const closedInZoho = await closeZohoTicketWithFallback(ticketId);
    if (!closedInZoho) {
      return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
    }

    const normalizedDate = normalizeDateOnly(newExpiryDate);

    await pool.query(
      `UPDATE ssl_assets
       SET ssl_expiry = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [normalizedDate, userEmail || null, alert.ssl_asset_id]
    );

    await pool.query(
      `UPDATE ssl_expiry_alert_tickets
       SET status = 'Closed', closed_at = NOW()
       WHERE zoho_ticket_id = $1`,
      [ticketId]
    );

    await pool.query(
      `UPDATE ssl_expiry_alert_tickets
       SET status = 'Superseded', closed_at = NOW()
       WHERE ssl_asset_id = $1 AND status = 'Open'`,
      [alert.ssl_asset_id]
    );

    await pool.query(
      `UPDATE ticket_assignments
       SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
       WHERE zoho_ticket_id = $2`,
      [userEmail || null, ticketId]
    );

    await processSslAlerts();

    return res.json({
      message: 'SSL ticket closed and expiry updated',
      ssl_expiry: normalizedDate
    });
  } catch (err) {
    console.error('Failed to close SSL ticket:', err);
    return res.status(500).json({ message: 'Failed to close SSL ticket' });
  }
});

app.post('/api/ihub/run-expiry-check', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    await processIhubAlerts();
    res.json({ message: 'Expiry check completed successfully' });
  } catch (err) {
    console.error('Failed to run expiry check:', err);
    res.status(500).json({ message: 'Expiry check failed' });
  }
});

app.post('/api/ihub/tickets/:zohoTicketId/close', authenticateToken, async (req, res) => {
  try {
    const ticketId = req.params.zohoTicketId;
    const newExpiryDate = req.body?.new_expiry_date;
    const userEmail = (req.user?.email || '').toLowerCase();
    const isAdmin = req.user?.role === 'admin';

    if (!isValidDateInput(newExpiryDate)) {
      return res.status(400).json({ message: 'Valid new_expiry_date is required' });
    }

    const assignmentResult = await pool.query(
      `SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1 LIMIT 1`,
      [ticketId]
    );
    const assignment = assignmentResult.rows[0];

    if (!assignment || (assignment.category || '').toUpperCase() !== 'IHUB') {
      return res.status(404).json({ message: 'IHUB ticket assignment not found' });
    }

    const assignedUsers = Array.isArray(assignment.assigned_users)
      ? assignment.assigned_users.map(u => (u || '').toLowerCase())
      : [];

    if (!isAdmin && !assignedUsers.includes(userEmail)) {
      return res.status(403).json({ message: 'Only responsible person or admin can close IHUB ticket' });
    }

    const alertResult = await pool.query(
      `SELECT * FROM ihub_alert_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
      [ticketId]
    );
    const alert = alertResult.rows[0];

    if (!alert) {
      return res.status(404).json({ message: 'IHUB alert record not found for this ticket' });
    }

    const closedInZoho = await closeZohoTicketWithFallback(ticketId);
    if (!closedInZoho) {
      return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
    }

    const normalizedDate = normalizeDateOnly(newExpiryDate);

    await pool.query(
      `UPDATE ihub_assets
       SET license_expiry = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [normalizedDate, userEmail || null, alert.ihub_asset_id]
    );

    await pool.query(
      `UPDATE ihub_alert_tickets
       SET status = 'Closed', closed_at = NOW()
       WHERE zoho_ticket_id = $1`,
      [ticketId]
    );

    await pool.query(
      `UPDATE ihub_alert_tickets
       SET status = 'Superseded', closed_at = NOW()
       WHERE ihub_asset_id = $1 AND status = 'Open'`,
      [alert.ihub_asset_id]
    );

    await pool.query(
      `UPDATE ticket_assignments
       SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
       WHERE zoho_ticket_id = $2`,
      [userEmail || null, ticketId]
    );

    await processIhubAlerts();

    return res.json({
      message: 'IHUB ticket closed and license expiry updated',
      license_expiry: normalizedDate
    });
  } catch (err) {
    console.error('Failed to close IHUB ticket:', err);
    return res.status(500).json({ message: 'Failed to close IHUB ticket' });
  }
});

// -------------------------------------------------------
// TICKET ASSIGNMENTS API (Supabase)
// -------------------------------------------------------

// Get all assignments
app.get("/api/assignments", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ticket_assignments ORDER BY assigned_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch assignments:", err);
    res.status(500).json({ message: "Failed to fetch assignments" });
  }
});

// Get assignment by Zoho ticket ID
app.get("/api/assignments/:zohoTicketId", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1",
      [req.params.zohoTicketId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to fetch assignment:", err);
    res.status(500).json({ message: "Failed to fetch assignment" });
  }
});

// Get assignments by user email
app.get("/api/assignments/user/:email", authenticateToken, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const result = await pool.query(
      "SELECT * FROM ticket_assignments WHERE $1 = ANY(assigned_users) ORDER BY assigned_at DESC",
      [email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch user assignments:", err);
    res.status(500).json({ message: "Failed to fetch user assignments" });
  }
});

// Create new assignment (also syncs to Zoho)
app.post("/api/assignments", authenticateToken, async (req, res) => {
  try {
    const { 
      zoho_ticket_id, 
      zoho_ticket_number,
      assigned_users, 
      assigned_by,
      zoho_department_id,
      status,
      category
    } = req.body;

    if (!zoho_ticket_id || !assigned_users || assigned_users.length === 0 || !assigned_by) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Primary assignee is the first user (round-robin)
    const primary_assignee = assigned_users[0].toLowerCase();
    const normalizedUsers = assigned_users.map(u => u.toLowerCase());

    // Insert into Supabase - try with category first, fallback without
    let result;
    try {
      result = await pool.query(
        `INSERT INTO ticket_assignments 
          (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (zoho_ticket_id) DO UPDATE SET
           assigned_users = EXCLUDED.assigned_users,
           primary_assignee = EXCLUDED.primary_assignee,
           reassigned_user = ticket_assignments.primary_assignee,
           reassigned_at = NOW(),
           reassigned_by = EXCLUDED.assigned_by,
           category = COALESCE(EXCLUDED.category, ticket_assignments.category),
           updated_at = NOW()
         RETURNING *`,
        [
          zoho_ticket_id,
          zoho_ticket_number || null,
          normalizedUsers,
          primary_assignee,
          assigned_by.toLowerCase(),
          zoho_department_id || null,
          status || 'Open',
          category || null
        ]
      );
    } catch (dbErr) {
      // Fallback: try without category column (migration not applied)
      console.log('Trying without category column...');
      result = await pool.query(
        `INSERT INTO ticket_assignments 
          (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (zoho_ticket_id) DO UPDATE SET
           assigned_users = EXCLUDED.assigned_users,
           primary_assignee = EXCLUDED.primary_assignee,
           reassigned_user = ticket_assignments.primary_assignee,
           reassigned_at = NOW(),
           reassigned_by = EXCLUDED.assigned_by,
           updated_at = NOW()
         RETURNING *`,
        [
          zoho_ticket_id,
          zoho_ticket_number || null,
          normalizedUsers,
          primary_assignee,
          assigned_by.toLowerCase(),
          zoho_department_id || null,
          status || 'Open'
        ]
      );
    }

    // Sync primary assignee to Zoho Desk
    try {
      const agentId = await lookupAgentIdByEmail(primary_assignee);
      if (agentId) {
        await zohoFetch(`/tickets/${zoho_ticket_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId: agentId })
        });
      }
    } catch (zohoErr) {
      // Don't fail the request, Supabase record is created
    }

    invalidateRuntimeCaches();
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to create assignment:", err);
    res.status(500).json({ message: "Failed to create assignment", error: err.message });
  }
});

// Reassign ticket
app.put("/api/assignments/reassign", authenticateToken, async (req, res) => {
  try {
    const { zoho_ticket_id, new_assigned_users, reassigned_by } = req.body;

    if (!zoho_ticket_id || !new_assigned_users || new_assigned_users.length === 0 || !reassigned_by) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const new_primary = new_assigned_users[0].toLowerCase();
    const normalizedUsers = new_assigned_users.map(u => u.toLowerCase());

    // Get current assignment
    const current = await pool.query(
      "SELECT primary_assignee FROM ticket_assignments WHERE zoho_ticket_id = $1",
      [zoho_ticket_id]
    );

    const old_primary = current.rows[0]?.primary_assignee || null;

    // Update assignment
    const result = await pool.query(
      `UPDATE ticket_assignments SET
         assigned_users = $1,
         primary_assignee = $2,
         reassigned_user = $3,
         reassigned_at = NOW(),
         reassigned_by = $4,
         updated_at = NOW()
       WHERE zoho_ticket_id = $5
       RETURNING *`,
      [normalizedUsers, new_primary, old_primary, reassigned_by.toLowerCase(), zoho_ticket_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    // Sync new primary assignee to Zoho Desk
    try {
      const agentId = await lookupAgentIdByEmail(new_primary);
      if (agentId) {
        await zohoFetch(`/tickets/${zoho_ticket_id}`, {
          method: 'PATCH',
          body: JSON.stringify({ assigneeId: agentId })
        });
      }
    } catch (zohoErr) {
      // Silently fail; DB record is primary source of truth
    }

    invalidateRuntimeCaches();
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to reassign:", err);
    res.status(500).json({ message: "Failed to reassign ticket" });
  }
});

// Bulk assign (round-robin distribution)
app.post("/api/assignments/bulk", authenticateToken, async (req, res) => {
  try {
    const { ticket_ids, assigned_users, assigned_by, ticket_categories } = req.body;

    if (!ticket_ids || ticket_ids.length === 0 || !assigned_users || assigned_users.length === 0 || !assigned_by) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const normalizedUsers = assigned_users.map(u => u.toLowerCase());
    const success = [];
    const failed = [];

    // Round-robin distribution
    for (let i = 0; i < ticket_ids.length; i++) {
      const ticketId = ticket_ids[i];
      const primaryIndex = i % normalizedUsers.length;
      const primaryAssignee = normalizedUsers[primaryIndex];

      try {
        const category = ticket_categories?.[ticketId] || null;
        // Insert/update assignment
        await pool.query(
          `INSERT INTO ticket_assignments 
            (zoho_ticket_id, assigned_users, primary_assignee, assigned_by, status, category)
           VALUES ($1, $2, $3, $4, 'Open', $5)
           ON CONFLICT (zoho_ticket_id) DO UPDATE SET
             assigned_users = EXCLUDED.assigned_users,
             primary_assignee = EXCLUDED.primary_assignee,
             reassigned_user = ticket_assignments.primary_assignee,
             reassigned_at = NOW(),
             reassigned_by = EXCLUDED.assigned_by,
             category = COALESCE(EXCLUDED.category, ticket_assignments.category),
             updated_at = NOW()`,
          [ticketId, [primaryAssignee], primaryAssignee, assigned_by.toLowerCase(), category]
        );

        // Sync to Zoho
        try {
          const agentId = await lookupAgentIdByEmail(primaryAssignee);
          if (agentId) {
            await zohoFetch(`/tickets/${ticketId}`, {
              method: 'PATCH',
              body: JSON.stringify({ assigneeId: agentId })
            });
          }
        } catch (zohoErr) {
          console.error(`Failed to sync ticket ${ticketId} to Zoho:`, zohoErr);
        }

        success.push(ticketId);
      } catch (err) {
        console.error(`Failed to assign ticket ${ticketId}:`, err);
        failed.push(ticketId);
      }
    }

    invalidateRuntimeCaches();
    res.json({ success, failed });
  } catch (err) {
    console.error("Bulk assign failed:", err);
    res.status(500).json({ message: "Bulk assign failed" });
  }
});

// Close assignment
app.put("/api/assignments/:zohoTicketId/close", authenticateToken, async (req, res) => {
  try {
    const { closed_by } = req.body;
    
    const result = await pool.query(
      `UPDATE ticket_assignments SET
         status = 'Closed',
         closed_at = NOW(),
         closed_by = $1,
         updated_at = NOW()
       WHERE zoho_ticket_id = $2
       RETURNING *`,
      [closed_by?.toLowerCase() || null, req.params.zohoTicketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    invalidateRuntimeCaches();
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to close assignment:", err);
    res.status(500).json({ message: "Failed to close assignment" });
  }
});

// Delete assignment
app.delete("/api/assignments/:zohoTicketId", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM ticket_assignments WHERE zoho_ticket_id = $1 RETURNING *",
      [req.params.zohoTicketId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    invalidateRuntimeCaches();
    res.json({ message: "Assignment deleted" });
  } catch (err) {
    console.error("Failed to delete assignment:", err);
    res.status(500).json({ message: "Failed to delete assignment" });
  }
});

// Get all users (for assignment dropdown)
app.get("/api/assignable-users", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, role FROM users WHERE role IN ('admin', 'support', 'user') ORDER BY email ASC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch assignable users:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// Admin: resolve group members by group email (cloudops@muraai.com)
app.get("/api/admin/group-members", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const groupEmail = (req.query.groupEmail || '').toString().trim().toLowerCase();
    if (!groupEmail) {
      return res.status(400).json({ message: "Missing groupEmail" });
    }

    const token = getGraphToken(req);
    if (!token) {
      return res.status(401).json({ message: "Missing access token" });
    }

    const groupLookupUrl =
      `https://graph.microsoft.com/v1.0/groups?$filter=mail eq '${groupEmail}'&$select=id,displayName,mail`;

    let groupResponse = await fetch(groupLookupUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!groupResponse.ok) {
      return res.status(401).json({ message: "Graph group lookup failed" });
    }

    let groupData = await groupResponse.json();
    let group = (groupData.value || [])[0];

    if (!group) {
      const fallbackUrl =
        `https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${groupEmail}'&$select=id,displayName,mail`;
      groupResponse = await fetch(fallbackUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!groupResponse.ok) {
        return res.status(401).json({ message: "Graph group lookup failed" });
      }

      groupData = await groupResponse.json();
      group = (groupData.value || [])[0];
    }

    if (!group?.id) {
      return res.json({ members: [] });
    }

    let membersUrl =
      `https://graph.microsoft.com/v1.0/groups/${group.id}/members?$select=mail,userPrincipalName,displayName&$top=100`;
    const members = [];

    while (membersUrl) {
      const response = await fetch(membersUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.ok) {
        return res.status(401).json({ message: "Graph members request failed" });
      }

      const data = await response.json();
      const items = Array.isArray(data.value) ? data.value : [];

      items.forEach(u => {
        const email = (u.mail || u.userPrincipalName || '').trim().toLowerCase();
        const displayName = (u.displayName || '').trim();
        if (email && !email.includes('#ext#')) {
          members.push({ email, displayName });
        }
      });

      membersUrl = data['@odata.nextLink'] || '';
    }

    res.json({ members });
  } catch (err) {
    console.error("Group member lookup failed:", err);
    res.status(500).json({ message: "Group member lookup failed" });
  }
});

// Admin: assignments report (for cloudops group members)
app.get("/api/admin/assignments-report", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ticket_assignments ORDER BY assigned_at DESC"
    );
    res.json({ assignments: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch assignments report" });
  }
});

// -------------------------------------------------------
// ADMIN: USER ROLE MANAGEMENT API
// -------------------------------------------------------

// GET /api/admin/user-roles - List all stored user roles from database
app.get('/api/admin/user-roles', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
         id,
         microsoft_email,
         role,
         assigned_by,
         assigned_at,
         updated_at,
         notes
       FROM user_roles
       ORDER BY updated_at DESC`
    );

    return res.json({ 
      users: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Failed to fetch user roles:', err?.message || err);
    return res.status(500).json({ error: 'Failed to fetch user roles' });
  }
});

// POST /api/admin/users/:email/role - Assign/update role for a user
app.post('/api/admin/users/:email/role', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { role: newRole, notes } = req.body;
    const userEmail = (req.params.email || '').toString().toLowerCase().trim();
    const adminEmail = (req.user?.email || '').toLowerCase();

    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }

    const allowedRoles = ['admin', 'support', 'user'];
    if (!newRole || !allowedRoles.includes(newRole)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${allowedRoles.join(', ')}` });
    }

    // Upsert into user_roles table
    const result = await pool.query(
      `INSERT INTO user_roles (microsoft_email, role, assigned_by, notes, assigned_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (microsoft_email)
       DO UPDATE SET
         role = EXCLUDED.role,
         assigned_by = EXCLUDED.assigned_by,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id, microsoft_email, role, assigned_by, assigned_at, updated_at, notes`,
      [userEmail, newRole, adminEmail, notes || null]
    );

    console.log(`[ADMIN] Role assigned: ${userEmail} → ${newRole} by ${adminEmail}`);

    return res.json({
      success: true,
      message: `Role updated for ${userEmail}`,
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Failed to assign role:', err?.message || err);
    return res.status(500).json({ error: 'Failed to assign role' });
  }
});

// GET /api/admin/users - Get paginated list of Microsoft users (from Graph)
app.get('/api/admin/users', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 50;
    const skip = (page - 1) * pageSize;
    const searchText = (req.query.search || '').toString().trim();

    // Use explicit Graph token from frontend (MSAL), not app JWT.
    const adminAccessToken = (req.headers['x-graph-token'] || '').toString().trim();
    
    if (!adminAccessToken) {
      return res.status(400).json({ error: 'No Microsoft Graph token provided' });
    }

    // Fetch users from Microsoft Graph
    let graphUrl = `https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,displayName,mail&$top=${pageSize}&$skip=${skip}&$orderby=displayName`;

    if (searchText) {
      graphUrl += `&$filter=contains(displayName,'${searchText}') or contains(mail,'${searchText}')`;
    }

    const graphResponse = await fetch(graphUrl, {
      headers: { 
        Authorization: `Bearer ${adminAccessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!graphResponse.ok) {
      console.warn(`Graph API users fetch failed: ${graphResponse.status}`);
      return res.status(graphResponse.status).json({ 
        error: 'Failed to fetch users from Microsoft Graph',
        details: `Graph API returned ${graphResponse.status}`
      });
    }

    const graphData = await graphResponse.json();
    const graphUsers = Array.isArray(graphData?.value) ? graphData.value : [];

    // Enrich with stored roles from DB
    const userEmails = graphUsers.map(u => (u.mail || '').toLowerCase()).filter(Boolean);
    let storedRoles = new Map();

    if (userEmails.length > 0) {
      const roleResult = await pool.query(
        `SELECT microsoft_email, role, assigned_by, assigned_at, updated_at
         FROM user_roles
         WHERE LOWER(microsoft_email) = ANY($1)`,
        [userEmails]
      );
      
      roleResult.rows.forEach(row => {
        storedRoles.set((row.microsoft_email || '').toLowerCase(), row);
      });
    }

    const enrichedUsers = graphUsers.map(u => {
      const email = (u.mail || '').toLowerCase();
      const storedRole = storedRoles.get(email);
      return {
        id: u.id,
        email: u.mail || u.userPrincipalName,
        displayName: u.displayName,
        userPrincipalName: u.userPrincipalName,
        currentRole: storedRole?.role || 'user', // default to 'user' if not in DB
        assignedBy: storedRole?.assigned_by || null,
        assignedAt: storedRole?.assigned_at || null,
        updatedAt: storedRole?.updated_at || null
      };
    });

    return res.json({
      users: enrichedUsers,
      page,
      pageSize,
      count: enrichedUsers.length,
      hasMore: enrichedUsers.length === pageSize
    });
  } catch (err) {
    console.error('Failed to fetch Graph users:', err?.message || err);
    return res.status(500).json({ 
      error: 'Failed to fetch users',
      details: err?.message
    });
  }
});

// DELETE /api/admin/users/:email/role - Remove stored role assignment (reverts to Graph group + default)
app.delete('/api/admin/users/:email/role', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const userEmail = (req.params.email || '').toString().toLowerCase().trim();
    const adminEmail = (req.user?.email || '').toLowerCase();

    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }

    const result = await pool.query(
      `DELETE FROM user_roles
       WHERE LOWER(microsoft_email) = $1
       RETURNING microsoft_email, role`,
      [userEmail]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No role assignment found for this user' });
    }

    console.log(`[ADMIN] Role assignment deleted: ${userEmail} by ${adminEmail}`);

    return res.json({
      success: true,
      message: `Role assignment removed for ${userEmail}. User will revert to Graph group-based role.`,
      user: result.rows[0]
    });
  } catch (err) {
    console.error('Failed to delete role assignment:', err?.message || err);
    return res.status(500).json({ error: 'Failed to delete role assignment' });
  }
});

// -------------------------------------------------------
// SPA fallback (Angular routing) - MUST BE LAST
// -------------------------------------------------------
app.get("*", (req, res) => {
  const indexPath =
    fs.existsSync(path.join(angularBrowserPath, "index.html"))
      ? path.join(angularBrowserPath, "index.html")
      : path.join(angularPath, "index.html");

  res.sendFile(indexPath);
});


// ------------------------
// Start server
// ------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});