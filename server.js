// server.js
require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const http = require("http");
const https = require("https");
const path = require("path");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
const tls = require("tls");
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
app.use(express.json());
app.use(bodyParser.json());

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

    // Optional SSL fields should be nullable/optional in API usage.
    await pool.query(`
      ALTER TABLE ssl_assets
      ALTER COLUMN hostname DROP NOT NULL,
      ALTER COLUMN ip_address DROP NOT NULL,
      ALTER COLUMN application DROP NOT NULL
    `);
    
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
const SSL_ALERT_MILESTONES = [33, 18, 10, 7, 4, 3];
const SSL_DAILY_CHECK_HOUR = 11;
const SSL_DAILY_CHECK_MINUTE = 0;
const SSL_MAX_REDIRECTS = 5;
const SSL_REQUEST_TIMEOUT_MS = 10000;

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

let sslDailyCheckTimeout = null;

function getNextDailyRunTime(hour, minute) {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setHours(hour, minute, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  return nextRun;
}

async function runScheduledSslAlerts() {
  console.log(`[SSL] Running daily SSL expiry check at ${new Date().toISOString()}`);
  await processSslAlerts();
}

function scheduleDailySslAlertRun() {
  if (sslDailyCheckTimeout) {
    clearTimeout(sslDailyCheckTimeout);
  }

  const nextRun = getNextDailyRunTime(SSL_DAILY_CHECK_HOUR, SSL_DAILY_CHECK_MINUTE);
  const delayMs = nextRun.getTime() - Date.now();

  console.log(`[SSL] Daily SSL expiry check scheduled for ${nextRun.toString()}`);

  sslDailyCheckTimeout = setTimeout(async () => {
    await runScheduledSslAlerts();
    scheduleDailySslAlertRun();
  }, delayMs);
}

// Refresh token on startup and every 55 minutes
setInterval(refreshZohoToken, 55 * 60 * 1000);
refreshZohoToken();

// IHUB expiry alert processing on startup + every 12 hours
setTimeout(() => {
  processIhubAlerts();
}, 15 * 1000);
setInterval(processIhubAlerts, 12 * 60 * 60 * 1000);
scheduleDailySslAlertRun();

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

function httpRequestForRedirectCheck(targetUrl, method) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const transport = parsedUrl.protocol === 'https:' ? https : http;

    const request = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      timeout: SSL_REQUEST_TIMEOUT_MS,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'itsm-ssl-check/1.0'
      }
    }, (response) => {
      response.resume();
      resolve({
        statusCode: response.statusCode || 0,
        headers: response.headers || {}
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`Timed out while checking ${targetUrl}`));
    });

    request.on('error', reject);
    request.end();
  });
}

async function resolveSslCheckUrl(targetUrl) {
  let currentUrl = targetUrl;

  for (let redirectCount = 0; redirectCount < SSL_MAX_REDIRECTS; redirectCount += 1) {
    let response = await httpRequestForRedirectCheck(currentUrl, 'HEAD');

    if (response.statusCode === 405 || response.statusCode === 501) {
      response = await httpRequestForRedirectCheck(currentUrl, 'GET');
    }

    const location = response.headers.location;
    const isRedirect = response.statusCode >= 300 && response.statusCode < 400 && location;

    if (!isRedirect) {
      return currentUrl;
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  return currentUrl;
}

function readSslCertificateExpiry(targetUrl) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl);
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 443;

    const socket = tls.connect({
      host: parsedUrl.hostname,
      port,
      servername: parsedUrl.hostname,
      rejectUnauthorized: false,
      timeout: SSL_REQUEST_TIMEOUT_MS
    }, () => {
      try {
        const certificate = socket.getPeerCertificate();

        if (!certificate || !certificate.valid_to) {
          throw new Error(`No SSL certificate found for ${targetUrl}`);
        }

        resolve(normalizeDateOnly(certificate.valid_to));
      } catch (error) {
        reject(error);
      } finally {
        socket.end();
      }
    });

    socket.on('timeout', () => {
      socket.destroy(new Error(`Timed out while reading certificate for ${targetUrl}`));
    });

    socket.on('error', reject);
  });
}

async function fetchLiveSslMetadata(targetUrl) {
  if (!targetUrl) {
    throw new Error('SSL URL is required');
  }

  const resolvedUrl = await resolveSslCheckUrl(targetUrl);
  const parsedResolvedUrl = new URL(resolvedUrl);

  if (parsedResolvedUrl.protocol !== 'https:') {
    throw new Error(`Resolved URL must use HTTPS: ${resolvedUrl}`);
  }

  const expiryDate = await readSslCertificateExpiry(resolvedUrl);

  return {
    resolvedUrl,
    expiryDate
  };
}

async function syncSslAssetExpiry(asset) {
  const liveSsl = await fetchLiveSslMetadata(asset.ssl_url);
  const currentExpiry = normalizeDateOnly(asset.ssl_expiry);

  if (currentExpiry !== liveSsl.expiryDate) {
    await pool.query(
      `UPDATE ssl_assets
       SET ssl_expiry = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [liveSsl.expiryDate, 'ssl-monitor', asset.id]
    );
  }

  return {
    ...asset,
    ssl_expiry: liveSsl.expiryDate,
    resolved_ssl_url: liveSsl.resolvedUrl
  };
}

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
    priority: milestoneDays <= 7 ? 'High' : 'Medium',
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
    priority: milestoneDays <= 7 ? 'High' : 'Medium',
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
      let liveAsset;

      try {
        liveAsset = await syncSslAssetExpiry(asset);
      } catch (err) {
        console.error(`[SSL] Live certificate check failed for asset ${asset.id}:`, err?.message || err);
        continue;
      }

      const daysLeft = daysUntilDate(liveAsset.ssl_expiry);
      if (!SSL_ALERT_MILESTONES.includes(daysLeft)) {
        continue;
      }

      try {
        console.log(`[SSL] Creating alert ticket for asset ${asset.id} at ${daysLeft} day milestone`);
        await createSslAlertTicket(liveAsset, daysLeft);
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

// 🚀 OPTIMIZED: Server-side cache for counts
let countsCache = null;
let countsCacheTime = 0;
const COUNTS_CACHE_MS = 5 * 60 * 1000; // 5 minutes cache (larger datasets need more time)

app.get('/api/tickets/counts', authenticateToken, async (req, res) => {
  // Disable browser caching for this endpoint
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.removeHeader('ETag');
  
  try {
    const userEmail = req.user?.email?.toLowerCase() || '';
    
    // Return cached counts if still valid (5 min cache for large datasets)
    // Use user-specific cache key for assigned count
    const cacheKey = `counts_${userEmail}`;
    if (countsCache && countsCache._key === cacheKey && (Date.now() - countsCacheTime) < COUNTS_CACHE_MS) {
      console.log('Returning cached counts:', countsCache);
      return res.json(countsCache);
    }

    console.log(`Fetching fresh counts for user: ${userEmail}`);
    
    // Helper to count tickets for a specific status with pagination
    async function countTicketsByStatus(status) {
      let count = 0;
      let from = 0;
      const limit = 100;
      let hasMore = true;
      
      while (hasMore && from < 10000) { // Safety limit of 10k per status
        const res = await zohoFetch(`/tickets?limit=${limit}&from=${from}&status=${status}`);
        if (!res.ok) {
          console.error(`Failed to fetch ${status} tickets at from=${from}:`, res.status);
          break;
        }
        const data = await res.json();
        const tickets = data.data || [];
        count += tickets.length;
        hasMore = tickets.length === limit;
        from += limit;
      }
      return count;
    }

    // Get Supabase assignments for current user
    async function getSupabaseAssignedTickets(email) {
      if (!email) return new Set();
      try {
        const result = await pool.query(
          "SELECT zoho_ticket_id FROM ticket_assignments WHERE LOWER(primary_assignee) = $1",
          [email]
        );
        return new Set(result.rows.map(r => r.zoho_ticket_id));
      } catch (e) {
        console.error('Error fetching Supabase assignments:', e);
        return new Set();
      }
    }

    // Get Supabase assigned ticket IDs first
    const supabaseAssignedIds = await getSupabaseAssignedTickets(userEmail);
    console.log(`User has ${supabaseAssignedIds.size} Supabase assignments`);

    // Helper to count SLA tickets assigned to user (from Zoho + Supabase)
    async function countMySLATickets(email, supabaseIds) {
      if (!email) return 0;
      let slaCount = 0;
      let from = 0;
      const limit = 100;
      let hasMore = true;
      
      while (hasMore && from < 10000) {
        const res = await zohoFetch(`/tickets?limit=${limit}&from=${from}&status=Open&include=assignee`);
        if (!res.ok) break;
        const data = await res.json();
        const tickets = data.data || [];
        
        for (const t of tickets) {
          const priority = (t.priority || '').toLowerCase();
          const isSLA = priority.includes('sla') || priority.includes('urgent') || priority.includes('critical');
          
          if (isSLA) {
            const ticketId = t.id?.toString();
            const zohoAssignee = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
            
            // Check if assigned to user via Zoho OR Supabase
            if (zohoAssignee === email || supabaseIds.has(ticketId)) {
              slaCount++;
            }
          }
        }
        
        hasMore = tickets.length === limit;
        from += limit;
      }
      return slaCount;
    }

    // Helper to count tickets assigned to current user (Zoho + Supabase)
    async function countAssignedToUser(email, supabaseIds) {
      if (!email) return 0;
      let assignedCount = 0;
      const countedIds = new Set();
      let from = 0;
      const limit = 100;
      let hasMore = true;
      
      while (hasMore && from < 10000) {
        const res = await zohoFetch(`/tickets?limit=${limit}&from=${from}&status=Open&include=assignee`);
        if (!res.ok) break;
        const data = await res.json();
        const tickets = data.data || [];
        
        for (const t of tickets) {
          const ticketId = t.id?.toString();
          if (countedIds.has(ticketId)) continue;
          
          const zohoAssignee = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
          
          // Check if assigned to user via Zoho OR Supabase
          if (zohoAssignee === email || supabaseIds.has(ticketId)) {
            assignedCount++;
            countedIds.add(ticketId);
          }
        }
        
        hasMore = tickets.length === limit;
        from += limit;
      }
      return assignedCount;
    }

    // Fetch all counts in parallel
    const [openCount, closedCount, slaCount, assignedCount] = await Promise.all([
      countTicketsByStatus('Open'),
      countTicketsByStatus('Closed'),
      countMySLATickets(userEmail, supabaseAssignedIds),
      countAssignedToUser(userEmail, supabaseAssignedIds)
    ]);

    console.log(`Counts for ${userEmail}: open=${openCount}, closed=${closedCount}, mySLA=${slaCount}, assigned=${assignedCount}`);

    countsCache = {
      _key: cacheKey,
      open: openCount,
      closed: closedCount,
      sla: slaCount,
      assigned: assignedCount,
      total: openCount + closedCount
    };
    countsCacheTime = Date.now();

    res.json(countsCache);
  } catch (err) {
    console.error('Counts error:', err);
    res.status(500).json({ error: 'Failed to fetch ticket counts' });
  }
});

// 🔧 GET ZOHO DESK AGENTS for assignment dropdown
let agentsCache = null;
let agentsCacheTime = 0;
const AGENTS_CACHE_MS = 10 * 60 * 1000; // 10 minutes cache

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

app.get('/api/tickets', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 27;
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status;
    const search = req.query.search;
    const from = (page - 1) * limit;
    const include = 'contacts,assignee';

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

    res.json({
      page,
      limit,
      count: normalized.length || 0,
      hasMore: (data.data || []).length === limit,
      data: normalized
    });
  } catch (err) {
    console.error('Tickets endpoint error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tickets', details: err.message });
  }
});

app.get('/api/tickets/:id',  authenticateToken,async (req, res) => {
  try {
    const response = await zohoFetch(`/tickets/${req.params.id}`);
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

    // 🚀 OPTIMIZATION: Limit enrichment to only conversations without content
    // and use Promise.allSettled to prevent one failure from breaking others
    const conversationsWithoutContent = data.data
      .map((conv, idx) => ({ conv, idx }))
      .filter(item => !item.conv?.content && !item.conv?.description && !item.conv?.summary)
      .slice(0, 10); // 🔥 Limit max 10 detail calls per request

    if (conversationsWithoutContent.length === 0) {
      // All conversations have content, return as-is
      return res.json(data);
    }

    const detailRequests = conversationsWithoutContent.map(async ({ conv, idx }) => {
      try {
        const detailRes = await zohoFetch(
          `/tickets/${req.params.id}/conversations/${conv.id}`
        );
        if (detailRes.ok) {
          const detail = await detailRes.json();
          return {
            idx,
            enriched: detail?.data ? { ...conv, ...detail.data } : { ...conv, ...detail }
          };
        }
      } catch {
        // ignore enrichment errors
      }
      return { idx, enriched: conv };
    });

    const enriched = await Promise.all(detailRequests);
    const resultData = [...data.data];
    
    enriched.forEach(({ idx, enriched: enrichedConv }) => {
      resultData[conversationsWithoutContent[idx]?.idx] = enrichedConv;
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
    const response = await zohoFetch(`/tickets/${id}/attachments/${attachmentId}/content`);

    if (!response.ok) {
      const data = await response.json();
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

    const graphResponse = await fetch(
      "https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=mail",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!graphResponse.ok) {
      return res.status(401).json({ message: "Graph validation failed" });
    }

    const data = await graphResponse.json();
    const groups = data.value || [];

    const isAdmin = groups.some(
      g => (g.mail || "").toLowerCase() === "cloudops@muraai.com"
    );

    const role = isAdmin ? "admin" : "user";

const newAccessToken = jwt.sign(
  { email, role },
  process.env.JWT_SECRET,
  { expiresIn: "1h" }
);

const refreshToken = jwt.sign(
  { email, role },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: "7d" }
);

res.json({ accessToken: newAccessToken, refreshToken, role });


  } catch (err) {
    res.status(500).json({ error: "MSAL login failed" });
  }
});


app.post('/api/tickets/:id/reply', upload.array('attachments'),  authenticateToken,async (req, res) => {
  try {
    const files = Array.isArray(req.files) ? req.files : [];
    const content = req.body?.content || '';
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
      return res.status(response.status).json({
        ...data,
        attachments: uploaded
      });
    }

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

    if (!isValidDateInput(newExpiryDate)) {
      return res.status(400).json({ message: 'Valid new_expiry_date is required' });
    }

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
// SPA fallback (Angular routing)
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