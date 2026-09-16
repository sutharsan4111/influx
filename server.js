// server.js
require("dotenv").config();

const express = require("express");
const fetch = require("node-fetch");
const crypto = require("crypto");
const path = require("path");
const { execFile } = require('child_process');
const bodyParser = require("body-parser");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const fs = require("fs");
const multer = require("multer");
const FormData = require("form-data");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 }
});
const NODE_ID = process.env.HOSTNAME || 'local-node';

// ===============================
// Middleware
// ===============================
// Locked to known frontend origins. CORS_ALLOWED_ORIGINS (comma-separated) is
// set per environment via Helm; falls back to local dev origins when unset.
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
const DEFAULT_DEV_ORIGINS = ['http://localhost:4200', 'http://localhost:3000'];
const corsAllowlist = CORS_ALLOWED_ORIGINS.length > 0 ? CORS_ALLOWED_ORIGINS : DEFAULT_DEV_ORIGINS;
app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = same-origin/non-browser request (curl, server-to-server) — allow.
    if (!origin || corsAllowlist.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  }
}));
app.use(compression()); // 🚀 Enable gzip compression for responses
app.use(express.json());
app.use(bodyParser.json());

// Rate limit auth endpoints against credential stuffing / brute force.
// Per-pod (in-memory store): with N replicas the effective ceiling is up to
// N times this limit, since counters aren't shared across pods. Still closes
// the "no limit at all" gap; move to a shared (e.g. Redis) store if a precise
// cluster-wide limit is ever needed.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts, please try again later' }
});

// 🚀 Production: Smart caching headers
app.use((req, res, next) => {
  res.set('X-ITSM-Node', NODE_ID);
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

function isZohoProjectsConfigured() {
  return ENABLE_ZOHO_PROJECTS && !!ZOHO_PROJECTS_PORTAL_ID;
}

app.get('/api/project-workspace/projects', authenticateToken, async (req, res) => {
  try {
    if (isZohoProjectsConfigured()) {
      const zohoProjects = await fetchZohoProjectsItems();
      return res.json(zohoProjects);
    }

    const result = await pool.query(
      `SELECT id, name, owner, status, progress, due_date AS "dueDate" FROM project_workspace_projects ORDER BY id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Project workspace get projects failed', err);
    res.status(500).json({ message: 'Failed to load projects' });
  }
});

app.post('/api/project-workspace/projects', authenticateToken, async (req, res) => {
  try {
    const { name, owner, status, progress, dueDate } = req.body;
    const result = await pool.query(
      `INSERT INTO project_workspace_projects (name, owner, status, progress, due_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, owner, status, progress, due_date AS "dueDate"`,
      [name, owner, status, progress, dueDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Project workspace create project failed', err);
    res.status(500).json({ message: 'Failed to create project' });
  }
});

app.get('/api/project-workspace/tasks', authenticateToken, async (req, res) => {
  try {
    if (isZohoProjectsConfigured()) {
      const zohoTasks = await fetchZohoTasksItems();
      return res.json(zohoTasks);
    }

    const result = await pool.query(
      `SELECT id, project_id AS "projectId", title, assignee, status, priority, due_date AS "dueDate"
       FROM project_workspace_tasks ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Project workspace get tasks failed', err);
    res.status(500).json({ message: 'Failed to load tasks' });
  }
});

app.post('/api/project-workspace/tasks', authenticateToken, async (req, res) => {
  try {
    const { projectId, title, assignee, status, priority, dueDate } = req.body;
    const result = await pool.query(
      `INSERT INTO project_workspace_tasks (project_id, title, assignee, status, priority, due_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id AS "projectId", title, assignee, status, priority, due_date AS "dueDate"`,
      [projectId, title, assignee, status, priority, dueDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Project workspace create task failed', err);
    res.status(500).json({ message: 'Failed to create task' });
  }
});

app.get('/api/project-workspace/time-logs', authenticateToken, async (req, res) => {
  try {
    if (isZohoProjectsConfigured() && ENABLE_ZOHO_PROJECTS_TIME_LOGS) {
      const zohoTimeLogs = await fetchZohoTimeLogsItems();
      return res.json(zohoTimeLogs);
    }

    const result = await pool.query(
      `SELECT id, task_id AS "taskId", project_id AS "projectId", "user", hours, date, note
       FROM project_workspace_time_logs ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Project workspace get time logs failed', err);
    res.status(500).json({ message: 'Failed to load time logs' });
  }
});

app.post('/api/project-workspace/time-logs', authenticateToken, async (req, res) => {
  try {
    const { taskId, projectId, user, hours, date, note } = req.body;
    const result = await pool.query(
      `INSERT INTO project_workspace_time_logs (task_id, project_id, "user", hours, date, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, task_id AS "taskId", project_id AS "projectId", "user", hours, date, note`,
      [taskId, projectId, user, hours, date, note]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Project workspace create time log failed', err);
    res.status(500).json({ message: 'Failed to create time log' });
  }
});

app.patch('/api/project-workspace/tasks/:id/status', authenticateToken, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { status } = req.body;
    const result = await pool.query(
      `UPDATE project_workspace_tasks SET status = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, project_id AS "projectId", title, assignee, status, priority, due_date AS "dueDate"`,
      [status, taskId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Project workspace update task status failed', err);
    res.status(500).json({ message: 'Failed to update task status' });
  }
});

app.get('/api/project-workspace/dashboard', authenticateToken, async (req, res) => {
  try {
    if (isZohoProjectsConfigured()) {
      const dashboard = await fetchZohoDashboardItems();
      return res.json(dashboard);
    }

    const [projectCount, activeProjectCount, pendingTaskCount, totalHours] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM project_workspace_projects'),
      pool.query("SELECT COUNT(*)::int AS count FROM project_workspace_projects WHERE status = 'Active'"),
      pool.query("SELECT COUNT(*)::int AS count FROM project_workspace_tasks WHERE status <> 'Done'"),
      pool.query('SELECT COALESCE(SUM(hours),0)::numeric AS total_hours FROM project_workspace_time_logs')
    ]);

    res.json({
      totalProjects: projectCount.rows[0].count,
      activeProjects: activeProjectCount.rows[0].count,
      pendingTasks: pendingTaskCount.rows[0].count,
      totalHours: Number(totalHours.rows[0].total_hours)
    });
  } catch (err) {
    console.error('Project workspace dashboard failed', err);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
});

app.get('/api/project-workspace/config', authenticateToken, (req, res) => {
  res.json({
    zohoProjectsEnabled: isZohoProjectsConfigured(),
    zohoTimeLogsEnabled: isZohoProjectsConfigured() && ENABLE_ZOHO_PROJECTS_TIME_LOGS
  });
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

    // Tracks which tickets we've already announced to Teams as "new arrivals" —
    // independent of ticket_assignments (which requires an assignee and is about
    // who's handling the ticket, not whether we've seen it exist).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ticket_arrival_notifications (
        zoho_ticket_id VARCHAR(50) PRIMARY KEY,
        zoho_department_id VARCHAR(50),
        notified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
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
      CREATE TABLE IF NOT EXISTS ihub_certificate_assets (
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
      CREATE TABLE IF NOT EXISTS ihub_certificate_alert_tickets (
        id SERIAL PRIMARY KEY,
        ihub_certificate_asset_id INTEGER NOT NULL REFERENCES ihub_certificate_assets(id) ON DELETE CASCADE,
        milestone_days INTEGER NOT NULL,
        license_expiry_on DATE NOT NULL,
        zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
        zoho_ticket_number VARCHAR(50),
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMP WITH TIME ZONE,
        UNIQUE (ihub_certificate_asset_id, milestone_days, license_expiry_on)
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_role_bindings (
        id SERIAL PRIMARY KEY,
        microsoft_email VARCHAR(255) NOT NULL UNIQUE,
        roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
        assigned_by VARCHAR(255),
        notes TEXT,
        assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_role_bindings_email ON user_role_bindings(microsoft_email)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_role_bindings (
        id SERIAL PRIMARY KEY,
        group_identifier VARCHAR(255) NOT NULL UNIQUE,
        roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
        assigned_by VARCHAR(255),
        notes TEXT,
        assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_role_bindings_identifier ON group_role_bindings(group_identifier)`);

    // Seed test account with all roles for profile role-switch validation.
    await pool.query(
      `INSERT INTO user_role_bindings (microsoft_email, roles, assigned_by, notes, assigned_at, updated_at)
       VALUES ($1, $2::text[], $3, $4, NOW(), NOW())
       ON CONFLICT (microsoft_email)
       DO UPDATE SET
         roles = EXCLUDED.roles,
         assigned_by = EXCLUDED.assigned_by,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        'automation.cloudops@muraai.com',
        ['admin', 'cloudops', 'itsm', 'product', 'hr', 'support', 'muraai'],
        'system-seed',
        'Seeded all roles for testing role switching'
      ]
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS monitoring_devices (
        device_id VARCHAR(100) PRIMARY KEY,
        hostname VARCHAR(200) NOT NULL,
        user_name VARCHAR(200),
        user_email VARCHAR(200),
        ip_address VARCHAR(50),
        os_name VARCHAR(200),
        os_version VARCHAR(100),
        os_build VARCHAR(50),
        last_seen TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS monitoring_telemetry (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(100) NOT NULL REFERENCES monitoring_devices(device_id) ON DELETE CASCADE,
        screen_on BOOLEAN NOT NULL DEFAULT TRUE,
        screen_on_duration INTEGER NOT NULL DEFAULT 0,
        active_apps JSONB NOT NULL DEFAULT '[]'::jsonb,
        all_processes JSONB NOT NULL DEFAULT '[]'::jsonb,
        cpu_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
        memory_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
        disk_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
        reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_monitoring_telemetry_device_time
        ON monitoring_telemetry (device_id, reported_at DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS monitoring_azure_resources (
        resource_id VARCHAR(255) PRIMARY KEY,
        resource_name VARCHAR(255) NOT NULL,
        resource_type VARCHAR(255) NOT NULL,
        status VARCHAR(100) NOT NULL DEFAULT 'Unknown',
        region VARCHAR(100) NOT NULL DEFAULT 'Unknown',
        cpu_percent NUMERIC(6,2) DEFAULT 0,
        memory_percent NUMERIC(6,2) DEFAULT 0,
        storage_gb NUMERIC(10,2) DEFAULT 0,
        last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        owner_email VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_monitoring_azure_resources_owner_email
        ON monitoring_azure_resources (owner_email);
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS monitoring_presence_log (
        id SERIAL PRIMARY KEY,
        user_email VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        activity VARCHAR(50) NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_presence_log_user_date
        ON monitoring_presence_log (user_email, timestamp DESC)
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS monitoring_intune_devices (
        device_id VARCHAR(200) PRIMARY KEY,
        hostname VARCHAR(200) NOT NULL,
        azure_ad_device_id VARCHAR(200),
        compliance_state VARCHAR(50),
        manufacturer VARCHAR(200),
        model VARCHAR(200),
        serial_number VARCHAR(200),
        os_version VARCHAR(100),
        bitlocker_status VARCHAR(50),
        ownership VARCHAR(50),
        last_sync_date TIMESTAMPTZ,
        enrolled_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_intune_devices_hostname
        ON monitoring_intune_devices (hostname)
    `);

    // CloudOps Projects & Tasks tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        owner_email VARCHAR(255),
        owner_name VARCHAR(255),
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    // Idempotent upgrade for tables created before owner_email/owner_name existed
    await pool.query(`
      ALTER TABLE cloudops_projects ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
      ALTER TABLE cloudops_projects ADD COLUMN IF NOT EXISTS owner_name VARCHAR(255);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_project_members (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES cloudops_projects(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        role VARCHAR(50) NOT NULL DEFAULT 'member',
        assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, email)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_tasks (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES cloudops_projects(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        assigned_to TEXT[] NOT NULL DEFAULT '{}',
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_task_assignees (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES cloudops_tasks(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(task_id, email)
      )
    `);

    // CloudOps Assets pages (Master Page, Rental Laptop, and custom pages)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_asset_pages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        description TEXT,
        is_system_page BOOLEAN NOT NULL DEFAULT FALSE,
        page_order INTEGER NOT NULL DEFAULT 0,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(name)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_asset_page_columns (
        id SERIAL PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES cloudops_asset_pages(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        data_type VARCHAR(50) NOT NULL DEFAULT 'text',
        column_order INTEGER NOT NULL DEFAULT 0,
        is_required BOOLEAN NOT NULL DEFAULT FALSE,
        default_value TEXT,
        select_options JSONB,
        validation_regex TEXT,
        is_visible BOOLEAN NOT NULL DEFAULT TRUE,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE(page_id, name)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloudops_asset_page_rows (
        id SERIAL PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES cloudops_asset_pages(id) ON DELETE CASCADE,
        row_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        row_order INTEGER NOT NULL DEFAULT 0,
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_cloudops_asset_pages_is_system ON cloudops_asset_pages(is_system_page);
      CREATE INDEX IF NOT EXISTS idx_cloudops_asset_pages_order ON cloudops_asset_pages(page_order);
      CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_columns_page_id ON cloudops_asset_page_columns(page_id);
      CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_columns_order ON cloudops_asset_page_columns(page_id, column_order);
      CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_rows_page_id ON cloudops_asset_page_rows(page_id);
      CREATE INDEX IF NOT EXISTS idx_cloudops_asset_page_rows_order ON cloudops_asset_page_rows(page_id, row_order);
    `);
    // No default pages are seeded — CloudOps users create their own asset pages from scratch.
    // Remove any default pages seeded by earlier versions of this app.
    await pool.query(`DELETE FROM cloudops_asset_pages WHERE name IN ('master', 'rental-laptop', 'issued-laptop') AND is_system_page = TRUE`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_workspace_projects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        owner VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'Planning',
        progress INTEGER NOT NULL DEFAULT 0,
        due_date DATE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_workspace_tasks (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES project_workspace_projects(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        assignee VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'To Do',
        priority VARCHAR(50) NOT NULL DEFAULT 'Medium',
        due_date DATE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS project_workspace_time_logs (
        id SERIAL PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES project_workspace_tasks(id) ON DELETE CASCADE,
        project_id INTEGER NOT NULL REFERENCES project_workspace_projects(id) ON DELETE CASCADE,
        "user" VARCHAR(255) NOT NULL,
        hours NUMERIC(6,2) NOT NULL DEFAULT 0,
        date DATE NOT NULL,
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      INSERT INTO project_workspace_projects (id, name, owner, status, progress, due_date)
      SELECT 1, 'ITSM Upgrade', 'Alicia', 'Active', 72, '2026-08-20'
      WHERE NOT EXISTS (SELECT 1 FROM project_workspace_projects WHERE id = 1);
    `);

    await pool.query(`
      INSERT INTO project_workspace_projects (id, name, owner, status, progress, due_date)
      SELECT 2, 'Mobile App Rollout', 'Daniel', 'Planning', 24, '2026-09-10'
      WHERE NOT EXISTS (SELECT 1 FROM project_workspace_projects WHERE id = 2);
    `);

    await pool.query(`
      INSERT INTO project_workspace_tasks (id, project_id, title, assignee, status, priority, due_date)
      SELECT 101, 1, 'Configure workflow approvals', 'Nadia', 'In Progress', 'High', '2026-08-05'
      WHERE NOT EXISTS (SELECT 1 FROM project_workspace_tasks WHERE id = 101);
    `);

    await pool.query(`
      INSERT INTO project_workspace_tasks (id, project_id, title, assignee, status, priority, due_date)
      SELECT 102, 2, 'Prepare deployment checklist', 'Omar', 'To Do', 'Medium', '2026-08-15'
      WHERE NOT EXISTS (SELECT 1 FROM project_workspace_tasks WHERE id = 102);
    `);

    await pool.query(`
      INSERT INTO project_workspace_time_logs (id, task_id, project_id, "user", hours, date, note)
      SELECT 1001, 101, 1, 'Nadia', 4.5, '2026-08-02', 'Approval design and testing'
      WHERE NOT EXISTS (SELECT 1 FROM project_workspace_time_logs WHERE id = 1001);
    `);

    // 🚀 Production performance indexes (007). Idempotent.
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ticket_assignments_status_open
          ON ticket_assignments (status)
          WHERE status IS NULL OR LOWER(status) NOT IN ('closed', 'resolved');
        CREATE INDEX IF NOT EXISTS idx_ticket_assignments_assigned_users_gin
          ON ticket_assignments USING GIN (assigned_users);
        CREATE INDEX IF NOT EXISTS idx_ticket_assignments_primary_assignee
          ON ticket_assignments (primary_assignee);
        CREATE INDEX IF NOT EXISTS idx_ticket_assignments_zoho_ticket_id
          ON ticket_assignments (zoho_ticket_id);
        CREATE INDEX IF NOT EXISTS idx_recycled_tickets_active
          ON recycled_tickets (zoho_ticket_id) WHERE restored_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_reply_authors_conv_id
          ON reply_authors (zoho_conversation_id);
        CREATE INDEX IF NOT EXISTS idx_reply_authors_ticket_conv
          ON reply_authors (zoho_ticket_id, zoho_conversation_id);
      `);
    } catch (e) {
      console.warn('⚠️ Performance index creation warning:', e?.message);
    }

    // Drop legacy CHECK constraints that restrict role values to old set.
    // These constraints block saving cloudops/hr/product/muraai/support roles.
    try {
      await pool.query(`ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check`);
      await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    } catch (e) {
      console.warn('⚠️ Role constraint drop warning:', e?.message);
    }

    // Enable RLS + deny-all policy on every backend-only table (see 008/009/011/013).
    // Supabase auto-exposes all public-schema tables via PostgREST to the anon/
    // authenticated roles unless RLS is enabled; this app never uses PostgREST
    // (it only talks to Postgres via the pool above), so PostgREST access to
    // these tables must always be denied. Re-applied on every boot so newly
    // added tables — or a table whose policy was manually dropped — can never
    // silently regress to being world-readable again the way 011's did.
    try {
      const backendOnlyTables = [
        'users', 'ticket_closure', 'ssl_alert_tickets', 'cloudops_members',
        'recycled_tickets', 'ihub_assets', 'ihub_alert_tickets', 'ssl_assets',
        'ssl_expiry_alert_tickets', 'ticket_assignments', 'recycle_bin',
        'email_tickets', 'user_name_mapping', 'alertmanager_ssl_tickets',
        'reply_authors', 'user_roles', 'ihub_certificate_assets',
        'ihub_certificate_alert_tickets', 'cloudops_tasks',
        'monitoring_azure_resources', 'cloudops_task_assignees',
        'monitoring_devices', 'monitoring_telemetry', 'monitoring_presence_log',
        'monitoring_intune_devices', 'user_role_bindings', 'group_role_bindings',
        'cloudops_project_members', 'cloudops_projects',
        'project_workspace_projects', 'project_workspace_tasks',
        'project_workspace_time_logs', 'ticket_arrival_notifications',
        'cloudops_asset_pages', 'cloudops_asset_page_columns',
        'cloudops_asset_page_rows'
      ];
      for (const table of backendOnlyTables) {
        await pool.query(`ALTER TABLE IF EXISTS public.${table} ENABLE ROW LEVEL SECURITY`);
        await pool.query(`DROP POLICY IF EXISTS "backend_only" ON public.${table}`);
        await pool.query(`CREATE POLICY "backend_only" ON public.${table} AS RESTRICTIVE FOR ALL TO public USING (false)`);
      }
    } catch (e) {
      console.warn('⚠️ RLS enforcement warning:', e?.message);
    }

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

// ===================================
// Azure Graph API - Send Email Function
// ===================================
async function sendEmailViaAzure(fromEmail, toEmail, subject, content, userInfo) {
  try {
    let clientId = process.env.CLIENT_ID || process.env.AZURE_CLIENT_ID;
    let clientSecret = process.env.CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET;
    let tenantId = process.env.TENANT_ID || process.env.AZURE_TENANT_ID;

    // Decode TENANT_ID if it's base64 encoded (contains only alphanumeric, +, /, =)
    if (tenantId && /^[A-Za-z0-9+/=]+$/.test(tenantId) && !tenantId.includes('-')) {
      try {
        tenantId = Buffer.from(tenantId, 'base64').toString('utf-8');
        console.log('[EMAIL] Decoded TENANT_ID from base64');
      } catch (e) {
        // Not base64 or decoding failed, use as-is
      }
    }

    console.log(`[EMAIL] Attempting to send email from ${fromEmail} to ${toEmail}`);

    if (!clientId || !clientSecret || !tenantId) {
      console.warn('⚠️ Azure credentials not configured. Feedback logged only.');
      return false;
    }

    // Get access token
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
    console.log(`[EMAIL] Getting Azure token from: ${tokenUrl}`);
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
      })
    });

    if (!tokenResponse.ok) {
      const tokenError = await tokenResponse.text();
      console.error(`❌ Failed to get Azure token: ${tokenResponse.status}`);
      console.error(`Token error response:`, tokenError);
      return false;
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
    console.log(`[EMAIL] ✅ Got Azure token successfully`);

    // Send email via Graph API
    const mailBody = {
      message: {
        subject: subject,
        body: {
          contentType: "Text",
          content: content
        },
        toRecipients: [{ emailAddress: { address: toEmail } }]
      },
      saveToSentItems: true
    };

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`;
    console.log(`[EMAIL] Sending via Graph API: ${graphUrl}`);
    
    const mailResponse = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mailBody)
    });

    if (mailResponse.ok) {
      console.log(`✅ Email sent via Azure Graph API to ${toEmail}`);
      return true;
    } else {
      const mailError = await mailResponse.text();
      console.error(`❌ Failed to send email: ${mailResponse.status}`);
      console.error(`Mail error response:`, mailError);
      return false;
    }
  } catch (error) {
    console.error('❌ Azure email error:', error?.message || error);
    console.error('Stack trace:', error?.stack);
    return false;
  }
}
// ===================================
// Reusable Graph API token helper
// ===================================
async function getGraphToken() {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  let tenantId = process.env.AZURE_TENANT_ID;

  if (tenantId && /^[A-Za-z0-9+/=]+$/.test(tenantId) && !tenantId.includes('-')) {
    try { tenantId = Buffer.from(tenantId, 'base64').toString('utf-8'); } catch (e) { }
  }

  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('Azure credentials not configured');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    throw new Error(`Graph token failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ---------------------------
// 🔐 ADMIN ROLE MIDDLEWARE
// ---------------------------
function authorizeAdmin(req, res, next) {
  const role = req.user.role;
  if (role !== "admin" && role !== "cloudops") {
    return res.status(403).json({ message: "Admin only access" });
  }
  next();
}

const ELEVATED_ROLES = new Set(['admin', 'cloudops', 'product', 'hr', 'support', 'muraai']);
function authorizeElevated(req, res, next) {
  const role = (req.user?.role || '').toLowerCase();
  if (!ELEVATED_ROLES.has(role)) {
    return res.status(403).json({ message: 'Elevated role required' });
  }
  next();
}

// Per-ticket access control, mirroring the frontend's canViewTicket(): these roles
// may access any ticket; everyone else must be the requester, the Zoho assignee, or
// in the ticket's Supabase multi-agent assignment (ticket_assignments.assigned_users).
const TICKET_UNRESTRICTED_ROLES = new Set(['admin', 'cloudops', 'itsm']);
function isUnrestrictedTicketRole(role) {
  return TICKET_UNRESTRICTED_ROLES.has((role || '').toString().toLowerCase());
}

// Given an already-fetched raw Zoho ticket payload (include=contacts,assignee) and its
// Supabase assigned_users array, return the lowercased set of emails allowed to access it.
function ticketOwnerEmails(ticketData, assignedUsers) {
  const requesterEmail = (
    ticketData?.email || ticketData?.contact?.email ||
    ticketData?.contact?.emailAddress || ticketData?.contact?.secondaryEmail || ''
  ).toString().trim().toLowerCase();
  const assigneeEmail = (
    ticketData?.assignee?.email || ticketData?.assignee?.emailId || ''
  ).toString().trim().toLowerCase();
  const supabaseUsers = (assignedUsers || []).map(e => (e || '').toString().trim().toLowerCase());
  return [requesterEmail, assigneeEmail, ...supabaseUsers].filter(Boolean);
}

// For routes that haven't already fetched the ticket/assignment themselves.
async function userCanAccessTicket(user, ticketId) {
  if (isUnrestrictedTicketRole(user?.role)) return true;

  const requestingEmail = (user?.email || '').toString().trim().toLowerCase();
  if (!requestingEmail) return false;

  const [ticketRes, assignmentRes] = await Promise.allSettled([
    zohoFetch(`/tickets/${ticketId}?include=contacts,assignee`).then(r => r.ok ? r.json() : {}),
    pool.query('SELECT assigned_users FROM ticket_assignments WHERE zoho_ticket_id = $1', [ticketId])
  ]);

  const ticketData = ticketRes.status === 'fulfilled' ? ticketRes.value : {};
  const assignedUsers = assignmentRes.status === 'fulfilled' ? (assignmentRes.value?.rows?.[0]?.assigned_users || []) : [];

  return ticketOwnerEmails(ticketData, assignedUsers).includes(requestingEmail);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDeviceRow(row) {
  return {
    ...row,
    active_apps: parseJsonArray(row.active_apps),
    all_processes: parseJsonArray(row.all_processes),
    cpu_percent: toNumber(row.cpu_percent),
    memory_percent: toNumber(row.memory_percent),
    disk_percent: toNumber(row.disk_percent)
  };
}

function canUseMonitoringKey() {
  return Boolean(process.env.MONITORING_API_KEY);
}

function validateMonitoringKey(req, res, next) {
  if (!canUseMonitoringKey()) {
    return next();
  }

  const key = String(req.headers['x-monitoring-key'] || '');
  if (key !== process.env.MONITORING_API_KEY) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  next();
}

app.post('/api/monitoring/telemetry', validateMonitoringKey, async (req, res) => {
  try {
    const {
      device_id,
      hostname,
      user_name,
      user_email,
      ip_address,
      os_name,
      os_version,
      os_build,
      screen_on,
      screen_on_duration,
      active_apps,
      all_processes,
      cpu_percent,
      memory_percent,
      disk_percent,
      reported_at
    } = req.body || {};

    if (!device_id || !hostname) {
      return res.status(400).json({ message: 'device_id and hostname are required' });
    }

    const normalizedActiveApps = parseJsonArray(active_apps);
    const normalizedAllProcesses = parseJsonArray(all_processes);
    const reportedAt = reported_at ? new Date(reported_at) : new Date();

    await pool.query(`
      INSERT INTO monitoring_devices (
        device_id, hostname, user_name, user_email, ip_address, os_name, os_version, os_build, last_seen, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
      ON CONFLICT (device_id) DO UPDATE SET
        hostname = EXCLUDED.hostname,
        user_name = EXCLUDED.user_name,
        user_email = EXCLUDED.user_email,
        ip_address = EXCLUDED.ip_address,
        os_name = EXCLUDED.os_name,
        os_version = EXCLUDED.os_version,
        os_build = EXCLUDED.os_build,
        last_seen = EXCLUDED.last_seen,
        updated_at = NOW()
    `, [
      device_id,
      hostname,
      user_name || null,
      user_email || null,
      ip_address || null,
      os_name || null,
      os_version || null,
      os_build || null,
      reportedAt
    ]);

    await pool.query(`
      INSERT INTO monitoring_telemetry (
        device_id, screen_on, screen_on_duration, active_apps, all_processes,
        cpu_percent, memory_percent, disk_percent, reported_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      device_id,
      Boolean(screen_on),
      toNumber(screen_on_duration),
      JSON.stringify(normalizedActiveApps),
      JSON.stringify(normalizedAllProcesses),
      toNumber(cpu_percent),
      toNumber(memory_percent),
      toNumber(disk_percent),
      reportedAt
    ]);

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Monitoring telemetry error:', err);
    res.status(500).json({ message: 'Failed to save telemetry' });
  }
});

app.get('/api/monitoring/devices', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        d.device_id,
        d.hostname,
        d.user_name,
        d.user_email,
        d.ip_address,
        d.os_name,
        d.os_version,
        d.os_build,
        d.last_seen,
        t.screen_on,
        t.screen_on_duration,
        t.active_apps,
        t.all_processes,
        t.cpu_percent,
        t.memory_percent,
        t.disk_percent,
        t.reported_at
      FROM monitoring_devices d
      LEFT JOIN LATERAL (
        SELECT *
        FROM monitoring_telemetry t
        WHERE t.device_id = d.device_id
        ORDER BY t.reported_at DESC, t.id DESC
        LIMIT 1
      ) t ON true
      ORDER BY d.last_seen DESC NULLS LAST, d.hostname ASC
    `);

    res.json(result.rows.map(normalizeDeviceRow));
  } catch (err) {
    console.error('Monitoring devices error:', err);
    res.status(500).json({ message: 'Failed to fetch devices' });
  }
});

app.get('/api/monitoring/devices/:deviceId/history', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        device_id,
        screen_on,
        screen_on_duration,
        active_apps,
        all_processes,
        cpu_percent,
        memory_percent,
        disk_percent,
        reported_at,
        created_at
      FROM monitoring_telemetry
      WHERE device_id = $1
      ORDER BY reported_at DESC, id DESC
      LIMIT 100
    `, [req.params.deviceId]);

    res.json(result.rows.map(normalizeDeviceRow));
  } catch (err) {
    console.error('Monitoring history error:', err);
    res.status(500).json({ message: 'Failed to fetch history' });
  }
});

app.get('/api/monitoring/assets', authenticateToken, async (req, res) => {
  try {
    const queryEmail = (req.query.userEmail || '').toString().trim().toLowerCase();
    const effectiveEmail = req.user?.email?.toString().toLowerCase() || '';
    const targetEmail = req.user?.role === 'admin' && queryEmail ? queryEmail : effectiveEmail;

    if (!targetEmail) {
      return res.status(400).json({ message: 'User email is required' });
    }

    // Get latest telemetry per device
    const result = await pool.query(`
      SELECT
        d.device_id,
        d.hostname,
        d.user_name,
        d.user_email,
        d.ip_address,
        d.os_name,
        d.os_version,
        d.os_build,
        d.last_seen,
        d.updated_at,
        t.cpu_percent,
        t.memory_percent,
        t.disk_percent,
        t.reported_at
      FROM monitoring_devices d
      LEFT JOIN LATERAL (
        SELECT cpu_percent, memory_percent, disk_percent, reported_at
        FROM monitoring_telemetry t
        WHERE t.device_id = d.device_id
        ORDER BY t.reported_at DESC, t.id DESC
        LIMIT 1
      ) t ON true
      WHERE LOWER(d.user_email) = $1
      ORDER BY d.last_seen DESC NULLS LAST, d.hostname ASC
    `, [targetEmail]);

    // Get current Teams presence for this user
    const presenceResult = await pool.query(`
      SELECT activity, timestamp FROM monitoring_presence_log
      WHERE LOWER(user_email) = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `, [targetEmail]);

    const currentPresence = presenceResult.rows.length > 0
      ? presenceResult.rows[0].activity
      : null;

    // Get daily activity (last 5 days)
    const activityResult = await pool.query(`
      SELECT
        DATE(timestamp AT TIME ZONE 'UTC') as date,
        activity,
        COUNT(*) as samples
      FROM monitoring_presence_log
      WHERE LOWER(user_email) = $1
        AND timestamp >= NOW() - INTERVAL '5 days'
      GROUP BY DATE(timestamp AT TIME ZONE 'UTC'), activity
      ORDER BY date DESC, activity
    `, [targetEmail]);

    // Build daily activity breakdown
    const dailyMap = new Map();
    for (const row of activityResult.rows) {
      const dateKey = row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date).split('T')[0];
      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, {
          date: dateKey,
          availableHours: 0, awayHours: 0, inCallHours: 0,
          inMeetingHours: 0, doNotDisturbHours: 0, offlineHours: 0
        });
      }
      const day = dailyMap.get(dateKey);
      const activity = (row.activity || '').toLowerCase();
      const hours = Math.round((Number(row.samples) || 0) * 0.25 * 10) / 10;
      if (activity === 'available' || activity === 'availableidle') day.availableHours += hours;
      else if (activity === 'away' || activity === 'berightback' || activity === 'offwork') day.awayHours += hours;
      else if (activity === 'inacall' || activity === 'inaconferencecall') day.inCallHours += hours;
      else if (activity === 'inameeting') day.inMeetingHours += hours;
      else if (activity === 'donotdisturb' || activity === 'urgentinterruptionsonly') day.doNotDisturbHours += hours;
      else if (activity === 'offline' || activity === 'presenceunknown' || activity === 'outofoffice') day.offlineHours += hours;
    }
    const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Get Intune device data merged by hostname
    const intuneResult = await pool.query(`
      SELECT hostname, compliance_state, manufacturer, model, serial_number,
             os_version as intune_os_version, bitlocker_status, ownership, last_sync_date
      FROM monitoring_intune_devices
    `);
    const intuneByHostname = new Map();
    for (const row of intuneResult.rows) {
      const key = (row.hostname || '').toLowerCase().trim();
      if (key) intuneByHostname.set(key, row);
    }

    const rows = result.rows.map(row => {
      const hostnameLower = (row.hostname || '').toLowerCase().trim();
      const intune = intuneByHostname.get(hostnameLower) || null;

      return {
        asset_id: row.device_id,
        hostname: row.hostname,
        owner_email: row.user_email,
        status: row.last_seen && Date.now() - new Date(row.last_seen).getTime() < 5 * 60 * 1000 ? 'Online' : 'Offline',
        last_seen: row.last_seen,
        cpu_percent: Number(row.cpu_percent) || 0,
        memory_percent: Number(row.memory_percent) || 0,
        disk_percent: Number(row.disk_percent) || 0,
        primary_issue: row.cpu_percent > 90 || row.memory_percent > 90 || row.disk_percent > 90 ? 'Resource warning' : 'No issues',
        teams_presence: currentPresence,
        daily_activity: dailyActivity,
        compliance_state: intune?.compliance_state || null,
        manufacturer: intune?.manufacturer || null,
        model: intune?.model || null,
        serial_number: intune?.serial_number || null,
        intune_os_version: intune?.intune_os_version || null,
        bitlocker_status: intune?.bitlocker_status || null,
        ownership: intune?.ownership || null,
        last_intune_sync: intune?.last_sync_date || null
      };
    });

    res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(rows);
  } catch (err) {
    console.error('Monitoring assets error:', err);
    res.status(500).json({ message: 'Failed to fetch assets' });
  }
});

// ============================================================
// POST /api/monitoring/presence/sync - Fetch Teams presence for all monitored users
// ============================================================
app.post('/api/monitoring/presence/sync', authenticateToken, async (req, res) => {
  try {
    const token = await getGraphToken();

    // Get all unique user emails from monitoring_devices
    const usersResult = await pool.query(`
      SELECT DISTINCT LOWER(TRIM(user_email)) as email
      FROM monitoring_devices
      WHERE user_email IS NOT NULL AND TRIM(user_email) != ''
    `);

    const emails = usersResult.rows.map(r => r.email).filter(Boolean);
    if (emails.length === 0) {
      return res.json({ status: 'ok', synced: 0, message: 'No users with devices found' });
    }

    // Resolve emails to user IDs via Graph API
    let synced = 0;
    for (const email of emails) {
      try {
        const userResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!userResp.ok) continue;
        const userData = await userResp.json();
        const userId = userData.id;
        if (!userId) continue;

        // Get presence for this user
        const presenceResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${userId}/presence`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!presenceResp.ok) continue;
        const presence = await presenceResp.json();

        const activity = presence.activity || 'PresenceUnknown';

        // Store in presence log
        await pool.query(`
          INSERT INTO monitoring_presence_log (user_email, user_id, activity, timestamp)
          VALUES ($1, $2, $3, NOW())
        `, [email, userId, activity]);

        synced++;
      } catch (e) {
        console.warn(`[PRESENCE] Failed for ${email}:`, e.message);
      }
    }

    res.json({ status: 'ok', synced, total: emails.length });
  } catch (err) {
    console.error('Presence sync error:', err);
    res.status(500).json({ message: 'Failed to sync presence' });
  }
});

// ============================================================
// POST /api/monitoring/intune/sync - Fetch Intune managed devices from Graph API
// ============================================================
app.post('/api/monitoring/intune/sync', authenticateToken, async (req, res) => {
  try {
    const token = await getGraphToken();

    let url = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=id,deviceName,azureADDeviceId,complianceState,manufacturer,model,serialNumber,osVersion,encryptionStatus,ownerType,lastSyncDateTime,enrolledDateTime&$top=500';
    let synced = 0;

    while (url) {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!resp.ok) {
        throw new Error(`Graph API error: ${resp.status} ${await resp.text()}`);
      }

      const data = await resp.json();
      const devices = data.value || [];

      for (const d of devices) {
        const hostname = d.deviceName || '';
        if (!hostname) continue;

        const bitlockerMap = { 0: 'Unknown', 1: 'Encrypted', 2: 'Not Encrypted', 3: 'Not Supported' };
        const complianceMap = {
          'compliant': 'Compliant', 'noncompliant': 'Non-Compliant',
          'conflict': 'Conflict', 'error': 'Error', 'unknown': 'Unknown',
          'configmanager': 'ConfigMgr', 'inactive': 'Inactive'
        };

        await pool.query(`
          INSERT INTO monitoring_intune_devices (
            device_id, hostname, azure_ad_device_id, compliance_state,
            manufacturer, model, serial_number, os_version,
            bitlocker_status, ownership, last_sync_date, enrolled_date,
            updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            hostname = EXCLUDED.hostname,
            azure_ad_device_id = EXCLUDED.azure_ad_device_id,
            compliance_state = EXCLUDED.compliance_state,
            manufacturer = EXCLUDED.manufacturer,
            model = EXCLUDED.model,
            serial_number = EXCLUDED.serial_number,
            os_version = EXCLUDED.os_version,
            bitlocker_status = EXCLUDED.bitlocker_status,
            ownership = EXCLUDED.ownership,
            last_sync_date = EXCLUDED.last_sync_date,
            enrolled_date = EXCLUDED.enrolled_date,
            updated_at = NOW()
        `, [
          d.id,
          hostname,
          d.azureADDeviceId || null,
          complianceMap[(d.complianceState || '').toLowerCase()] || d.complianceState || 'Unknown',
          d.manufacturer || null,
          d.model || null,
          d.serialNumber || null,
          d.osVersion || null,
          bitlockerMap[d.encryptionStatus] || 'Unknown',
          d.ownerType || null,
          d.lastSyncDateTime ? new Date(d.lastSyncDateTime) : null,
          d.enrolledDateTime ? new Date(d.enrolledDateTime) : null
        ]);
        synced++;
      }

      url = data['@odata.nextLink'] || '';
    }

    res.json({ status: 'ok', synced });
  } catch (err) {
    console.error('Intune sync error:', err);
    res.status(500).json({ message: 'Failed to sync Intune devices', error: err.message });
  }
});

// ============================================================
// GET /api/monitoring/intune-devices - List Intune devices (admin)
// ============================================================
app.get('/api/monitoring/intune-devices', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM monitoring_intune_devices
      ORDER BY hostname ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Intune devices error:', err);
    res.status(500).json({ message: 'Failed to fetch Intune devices' });
  }
});

app.get('/api/monitoring/azure', authenticateToken, async (req, res) => {
  try {
    const queryEmail = (req.query.userEmail || '').toString().trim().toLowerCase();
    const effectiveEmail = req.user?.email?.toString().toLowerCase() || '';
    const targetEmail = queryEmail || effectiveEmail;

    if (!targetEmail) {
      return res.status(400).json({ message: 'User email is required' });
    }

    const result = await pool.query(`
      SELECT
        resource_id,
        resource_name,
        resource_type,
        status,
        region,
        cpu_percent,
        memory_percent,
        storage_gb,
        last_updated
      FROM monitoring_azure_resources
      WHERE LOWER(owner_email) = $1
      ORDER BY last_updated DESC
      LIMIT 200
    `, [targetEmail]);

    res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(result.rows.map(row => ({
      resource_id: row.resource_id,
      resource_name: row.resource_name,
      resource_type: row.resource_type,
      status: row.status,
      region: row.region,
      cpu_percent: Number(row.cpu_percent) || 0,
      memory_percent: Number(row.memory_percent) || 0,
      storage_gb: Number(row.storage_gb) || 0,
      last_updated: row.last_updated
    })));
  } catch (err) {
    console.error('Azure monitoring error:', err);
    res.status(500).json({ message: 'Failed to fetch Azure resources' });
  }
});

// Temporary: Seed sample Azure resources for the authenticated user (dev helper)
app.post('/api/monitoring/azure/seed', authenticateToken, async (req, res) => {
  try {
    const ownerEmail = (req.user?.email || '').toString().toLowerCase();
    if (!ownerEmail) return res.status(400).json({ message: 'No authenticated user email available' });

    const samples = [
      {
        resource_id: `${ownerEmail}-vm-01`,
        resource_name: 'Dev-VM-01',
        resource_type: 'Virtual Machine',
        status: 'Healthy',
        region: 'eastus',
        cpu_percent: 12.5,
        memory_percent: 34.2,
        storage_gb: 128
      },
      {
        resource_id: `${ownerEmail}-sqldb-01`,
        resource_name: 'AppDB-01',
        resource_type: 'SQL Database',
        status: 'Healthy',
        region: 'eastus2',
        cpu_percent: 5.1,
        memory_percent: 21.3,
        storage_gb: 256
      },
      {
        resource_id: `${ownerEmail}-appsvc-01`,
        resource_name: 'WebApp-01',
        resource_type: 'App Service',
        status: 'Warning',
        region: 'westus',
        cpu_percent: 78.4,
        memory_percent: 65.2,
        storage_gb: 10
      }
    ];

    const client = await pool.connect();
    try {
      for (const s of samples) {
        await client.query(`
          INSERT INTO monitoring_azure_resources (
            resource_id, resource_name, resource_type, status, region,
            cpu_percent, memory_percent, storage_gb, last_updated, owner_email, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,NOW(),NOW())
          ON CONFLICT (resource_id) DO UPDATE SET
            resource_name = EXCLUDED.resource_name,
            resource_type = EXCLUDED.resource_type,
            status = EXCLUDED.status,
            region = EXCLUDED.region,
            cpu_percent = EXCLUDED.cpu_percent,
            memory_percent = EXCLUDED.memory_percent,
            storage_gb = EXCLUDED.storage_gb,
            last_updated = NOW(),
            owner_email = EXCLUDED.owner_email,
            updated_at = NOW()
        `, [
          s.resource_id,
          s.resource_name,
          s.resource_type,
          s.status,
          s.region,
          s.cpu_percent,
          s.memory_percent,
          s.storage_gb,
          ownerEmail
        ]);
      }
    } finally {
      client.release();
    }

    res.json({ status: 'ok', inserted: samples.length });
  } catch (err) {
    console.error('Seed Azure error:', err);
    res.status(500).json({ message: 'Failed to seed Azure resources' });
  }
});

app.post('/api/monitoring/assets/seed', authenticateToken, async (req, res) => {
  try {
    const ownerEmail = (req.user?.email || '').toString().toLowerCase();
    if (!ownerEmail) return res.status(400).json({ message: 'No authenticated user email available' });

    const devices = [
      { device_id: `${ownerEmail}-laptop-01`, hostname: 'WORK-LAP-001', ip: '192.168.1.101', os: 'Windows', os_ver: '10.0.19045', os_build: '19045', cpu: 23.5, mem: 45.2, disk: 67.8 },
      { device_id: `${ownerEmail}-laptop-02`, hostname: 'WORK-LAP-002', ip: '192.168.1.102', os: 'Windows', os_ver: '10.0.19045', os_build: '19045', cpu: 78.1, mem: 82.3, disk: 91.2 },
      { device_id: `${ownerEmail}-desktop-01`, hostname: 'WORK-DSK-001', ip: '192.168.1.201', os: 'Windows', os_ver: '10.0.22631', os_build: '22631', cpu: 12.0, mem: 34.5, disk: 55.0 },
      { device_id: `${ownerEmail}-laptop-03`, hostname: 'WORK-LAP-003', ip: '192.168.1.103', os: 'Windows', os_ver: '10.0.19045', os_build: '19045', cpu: 95.2, mem: 88.7, disk: 45.3 },
    ];

    const client = await pool.connect();
    try {
      for (const d of devices) {
        const now = new Date();
        const lastSeen = new Date(now.getTime() - Math.floor(Math.random() * 120000));
        await client.query(`
          INSERT INTO monitoring_devices (device_id, hostname, user_name, user_email, ip_address, os_name, os_version, os_build, last_seen, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
          ON CONFLICT (device_id) DO UPDATE SET
            hostname = EXCLUDED.hostname, user_name = EXCLUDED.user_name, user_email = EXCLUDED.user_email,
            ip_address = EXCLUDED.ip_address, os_name = EXCLUDED.os_name, os_version = EXCLUDED.os_version,
            os_build = EXCLUDED.os_build, last_seen = EXCLUDED.last_seen, updated_at = NOW()
        `, [d.device_id, d.hostname, ownerEmail.split('@')[0], ownerEmail, d.ip, d.os, d.os_ver, d.os_build, lastSeen]);

        await client.query(`
          INSERT INTO monitoring_telemetry (device_id, cpu_percent, memory_percent, disk_percent, screen_on, screen_on_duration, active_apps, all_processes, reported_at, created_at)
          VALUES ($1,$2,$3,$4,TRUE,3600,'[]'::jsonb,'[]'::jsonb,$5,NOW())
        `, [d.device_id, d.cpu, d.mem, d.disk, lastSeen]);
      }
    } finally {
      client.release();
    }

    res.json({ status: 'ok', inserted: devices.length });
  } catch (err) {
    console.error('Seed assets error:', err);
    res.status(500).json({ message: 'Failed to seed assets' });
  }
});

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
app.post("/api/login", authRateLimiter, async (req, res) => {
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

    const normalizedRole = normalizeRole(user.role) || 'user';
    const roles = normalizeRoleList([normalizedRole]);

    // 🔥 ACCESS TOKEN (1 hour)
    const accessToken = jwt.sign(
      { email: user.email, role: normalizedRole, roles },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 🔥 REFRESH TOKEN (7 days)
    const refreshToken = jwt.sign(
      { email: user.email, role: normalizedRole, roles },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // Start warming the My Tickets cache now so it's ready before the user navigates there.
    prewarmUserTickets(user.email.toLowerCase(), normalizedRole);

    res.json({
      accessToken,
      refreshToken,
      role: normalizedRole,
      roles,
      email: user.email
    });

  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});
// 🔄 Refresh Token API
app.post("/api/refresh", authRateLimiter, (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) return res.sendStatus(401);

  jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);

    const newAccessToken = jwt.sign(
      { email: user.email, role: user.role, roles: normalizeRoleList(user.roles || [user.role]) },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({ accessToken: newAccessToken });
  });
});

app.post('/api/auth/switch-role', authenticateToken, async (req, res) => {
  try {
    const requestedRole = normalizeRole(req.body?.role);
    if (!requestedRole) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const tokenRoles = normalizeRoleList(req.user?.roles || [req.user?.role]);
    if (!tokenRoles.includes(requestedRole)) {
      return res.status(403).json({ error: 'Role is not assigned to this user' });
    }

    const email = (req.user?.email || '').toLowerCase();
    const accessToken = jwt.sign(
      { email, role: requestedRole, roles: tokenRoles },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const refreshToken = jwt.sign(
      { email, role: requestedRole, roles: tokenRoles },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ accessToken, refreshToken, role: requestedRole, roles: tokenRoles });
  } catch (err) {
    console.error('Role switch failed:', err?.message || err);
    return res.status(500).json({ error: 'Failed to switch role' });
  }
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
const ZOHO_PROJECTS_BASE_URL = process.env.ZOHO_PROJECTS_BASE_URL || 'https://projectsapi.zoho.com/restapi';
const ZOHO_PROJECTS_PORTAL_ID = (process.env.ZOHO_PROJECTS_PORTAL_ID || '').trim();
const ENABLE_ZOHO_OUTBOUND = (process.env.ENABLE_ZOHO_OUTBOUND || 'true').toLowerCase() === 'true';
const ENABLE_ZOHO_PROJECTS = (process.env.ENABLE_ZOHO_PROJECTS || 'true').toLowerCase() === 'true';
const ENABLE_ZOHO_PROJECTS_TIME_LOGS = (process.env.ENABLE_ZOHO_PROJECTS_TIME_LOGS || 'false').toLowerCase() === 'true';
const ZOHO_ALLOWED_EGRESS_IPS = new Set(
  (process.env.ZOHO_ALLOWED_EGRESS_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean)
);
const ZOHO_DEPARTMENT_ID = process.env.ZOHO_DEPARTMENT_ID;
const ZOHO_ASSIGNEE_ID = process.env.ZOHO_ASSIGNEE_ID;
const ENABLE_ALERT_JOBS = (process.env.ENABLE_ALERT_JOBS || 'true').toLowerCase() === 'true';
const IHUB_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const IHUB_CERTIFICATE_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const SSL_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const AUTOMATION_SSL_ALERT_MILESTONES = [30, 15, 7, 3, 1];
const AUTOMATION_PROMETHEUS_URL = (process.env.AUTOMATION_PROMETHEUS_URL || '').trim();
const ALERTMANAGER_WEBHOOK_SECRET = (process.env.ALERTMANAGER_WEBHOOK_SECRET || '').trim();
const ALERTMANAGER_FALLBACK_EMAIL = (process.env.ALERTMANAGER_FALLBACK_EMAIL || '').trim().toLowerCase();
const ADMIN_GROUP_MAIL = (process.env.ADMIN_GROUP_MAIL || 'automation.cloudops@muraai.com').trim().toLowerCase();
const ADMIN_GROUP_NAME = (process.env.ADMIN_GROUP_NAME || 'automation.cloudops').trim().toLowerCase();
const CLOUDOPS_GROUP_MAIL = (process.env.CLOUDOPS_GROUP_MAIL || 'cloudops@muraai.com').trim().toLowerCase();
const CLOUDOPS_GROUP_NAME = (process.env.CLOUDOPS_GROUP_NAME || 'cloudops').trim().toLowerCase();
// Incoming Webhook URL for the Teams channel that all CloudOps members are in.
// Left blank, notifications are silently skipped — see notifyCloudOpsTeamsOnAssignment().
const CLOUDOPS_TEAMS_WEBHOOK_URL = (process.env.CLOUDOPS_TEAMS_WEBHOOK_URL || '').trim();
// Shared secret a Zoho Desk workflow rule must send to /api/webhook/zoho-ticket-assigned
// so tickets assigned directly in Zoho (bypassing this portal) still notify Teams.
const ZOHO_TICKET_WEBHOOK_SECRET = (process.env.ZOHO_TICKET_WEBHOOK_SECRET || '').trim();
// Public URL of this ITSM portal ("Influx"), used to build "open ticket" links in Teams cards.
const PORTAL_BASE_URL = (process.env.PORTAL_BASE_URL || '').trim().replace(/\/+$/, '');
function ticketPortalUrl(zohoTicketId) {
  return PORTAL_BASE_URL ? `${PORTAL_BASE_URL}/tickets/${zohoTicketId}` : null;
}

const DEFAULT_ADMIN_EMAIL_ALLOWLIST = [
  'ravi.chadaram@muraai.com',
  'senthil.n@muraai.com',
  't.balaji@muraai.com',
  'akash.yadav@muraai.com',
  'automation.cloudops@muraai.com'
];

const ADMIN_EMAIL_ALLOWLIST = new Set(
  (process.env.ADMIN_EMAIL_ALLOWLIST || DEFAULT_ADMIN_EMAIL_ALLOWLIST.join(','))
    .split(',')
    .map(v => (v || '').trim().toLowerCase())
    .filter(Boolean)
);

function isAllowlistedAdminEmail(email) {
  return ADMIN_EMAIL_ALLOWLIST.has((email || '').toString().trim().toLowerCase());
}

const SUPPORTED_ROLES = ['admin', 'cloudops', 'product', 'hr', 'support', 'muraai', 'user'];
const DEPARTMENT_ROLE_KEYS = ['itsm', 'product', 'hr', 'support', 'muraai'];
const ROLE_PRIORITY = ['admin', 'cloudops', 'support', 'product', 'hr', 'muraai', 'user'];

const DEPARTMENT_IDS = {
  itsm: (process.env.DEPT_ITSM_ID || '132475000009937630').trim(),
  support: (process.env.DEPT_SUPPORT_ID || '132475000009948173').trim(),
  product: (process.env.DEPT_PRODUCT_ID || '132475000009958716').trim(),
  hr: (process.env.DEPT_HR_ID || '132475000009925079').trim(),
  muraai: (process.env.DEPT_MURAAI_ID || '132475000000010772').trim()
};

function normalizeRole(role) {
  const v = (role || '').toString().trim().toLowerCase();
  if (v === 'itsm') return 'cloudops';
  return SUPPORTED_ROLES.includes(v) ? v : null;
}

function parseRoleCsv(value) {
  return [...new Set(
    (value || '')
      .split(',')
      .map(v => normalizeRole(v))
      .filter(Boolean)
  )];
}

function parseRoleJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const DEFAULT_ROLE_GROUPS = {
  admin: [ADMIN_GROUP_MAIL, ADMIN_GROUP_NAME],
  cloudops: [CLOUDOPS_GROUP_MAIL, CLOUDOPS_GROUP_NAME, 'itsm@muraai.com', 'itsm'],
  product: ['product@muraai.com', 'products@muraai.com', 'product', 'products'],
  hr: ['hr@muraai.com', 'hr'],
  support: ['support@muraai.com', 'support'],
  muraai: ['muraai@muraai.com', 'muraai']
};

const ROLE_GROUP_MAP = (() => {
  const fromEnv = parseRoleJson(process.env.ROLE_GROUP_MAP, {});
  const merged = { ...DEFAULT_ROLE_GROUPS };
  for (const [role, entries] of Object.entries(fromEnv || {})) {
    const nr = normalizeRole(role);
    if (!nr || !Array.isArray(entries)) continue;
    merged[nr] = entries.map(v => (v || '').toString().trim().toLowerCase()).filter(Boolean);
  }
  return merged;
})();

function rolesFromGraphGroups(groups = []) {
  const found = new Set();
  for (const g of groups) {
    const values = [g?.mail, g?.displayName, g?.mailNickname]
      .map(v => (v || '').toString().trim().toLowerCase())
      .filter(Boolean);
    for (const role of Object.keys(ROLE_GROUP_MAP)) {
      const matches = ROLE_GROUP_MAP[role] || [];
      if (values.some(v => matches.includes(v))) {
        found.add(role);
      }
    }
  }
  return [...found];
}

function normalizeRoleList(roles, fallbackRole = 'user') {
  const arr = Array.isArray(roles) ? roles : [];
  const normalized = arr.map(r => normalizeRole(r)).filter(Boolean);
  if (!normalized.length) return fallbackRole ? [fallbackRole] : [];
  return [...new Set(normalized)];
}

function pickDefaultRole(roles, preferredRole, fallbackRole = 'user') {
  const allowed = new Set(normalizeRoleList(roles, fallbackRole));
  const preferred = normalizeRole(preferredRole);
  if (preferred && allowed.has(preferred)) return preferred;
  for (const role of ROLE_PRIORITY) {
    if (allowed.has(role)) return role;
  }
  return fallbackRole;
}

function extractTicketDepartmentId(ticket = {}) {
  return (
    ticket.departmentId ||
    ticket.department?.id ||
    ticket.department?.departmentId ||
    ticket.departmentIdStr ||
    ''
  ).toString();
}

function getAllowedDepartmentIdsForRole(role) {
  const r = normalizeRole(role) || 'user';
  if (r === 'admin' || r === 'user') return [];
  if (r === 'cloudops') {
    return [DEPARTMENT_IDS.itsm];
  }
  return DEPARTMENT_IDS[r] ? [DEPARTMENT_IDS[r]] : [];
}

function isDepartmentAllowed(ticket, allowedDeptIds = []) {
  if (!Array.isArray(allowedDeptIds) || allowedDeptIds.length === 0) return true;
  const tid = extractTicketDepartmentId(ticket);
  return !!tid && allowedDeptIds.includes(tid);
}

// Posts a ticket-assignment notice to the CloudOps Teams channel so the whole
// team sees it in one place, not just the assignee. No-op until
// CLOUDOPS_TEAMS_WEBHOOK_URL is configured (see .env). Only fires for CloudOps
// ("itsm") department tickets — this app also handles assignment for HR/Support/
// Product/Muraai, and those shouldn't spam the CloudOps channel.
// Adaptive Cards, not the legacy MessageCard format — this Teams Workflow
// (the "Post to a channel when a webhook request is received" template) does
// not render MessageCard's potentialAction buttons, confirmed by testing both
// side by side. Action.OpenUrl on an Adaptive Card renders correctly.
async function postCloudOpsTeamsCard(zohoTicketId, { title, facts }) {
  if (!CLOUDOPS_TEAMS_WEBHOOK_URL) return;

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true },
      { type: 'FactSet', facts: facts.map(f => ({ title: f.name, value: f.value })) }
    ]
  };

  const url = ticketPortalUrl(zohoTicketId);
  if (url) {
    card.actions = [{ type: 'Action.OpenUrl', title: 'Open in Influx', url }];
  }

  try {
    const res = await fetch(CLOUDOPS_TEAMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card)
    });
    if (!res.ok) {
      console.warn(`[Teams] Webhook post failed for ticket ${zohoTicketId}: ${res.status}`);
    }
  } catch (err) {
    console.warn(`[Teams] Webhook post errored for ticket ${zohoTicketId}:`, err?.message || err);
  }
}

async function notifyCloudOpsTeamsOnAssignment({
  zohoTicketId,
  zohoTicketNumber,
  zohoDepartmentId,
  assignedUsers = [],
  assignedBy,
  category,
  isBulk = false
}) {
  if ((zohoDepartmentId || '') !== DEPARTMENT_IDS.itsm) return;

  const ticketLabel = zohoTicketNumber ? `#${zohoTicketNumber}` : `#${zohoTicketId}`;
  const assigneeText = assignedUsers.length ? assignedUsers.join(', ') : 'Unassigned';

  await postCloudOpsTeamsCard(zohoTicketId, {
    title: `🎫 Ticket ${ticketLabel} assigned${isBulk ? ' (bulk)' : ''}`,
    facts: [
      { name: 'Ticket', value: ticketLabel },
      { name: 'Assigned To', value: assigneeText },
      { name: 'Assigned By', value: assignedBy || 'Unknown' },
      { name: 'Category', value: category || 'Uncategorized' }
    ]
  });
}

// New-ticket "arrival" notice — fires once per ticket, independent of whether
// it's been assigned yet. See ticket_arrival_notifications / runCloudOpsAssignmentPoll.
async function notifyCloudOpsTeamsOnNewTicket({
  zohoTicketId,
  zohoTicketNumber,
  subject,
  requesterEmail,
  assigneeEmail,
  category
}) {
  const ticketLabel = zohoTicketNumber ? `#${zohoTicketNumber}` : `#${zohoTicketId}`;

  await postCloudOpsTeamsCard(zohoTicketId, {
    title: `📥 New ticket ${ticketLabel}${subject ? `: ${subject}` : ''}`,
    facts: [
      { name: 'Ticket', value: ticketLabel },
      { name: 'Requester', value: requesterEmail || 'Unknown' },
      { name: 'Assigned To', value: assigneeEmail || 'Unassigned' },
      { name: 'Category', value: category || 'Uncategorized' }
    ]
  });
}

let egressIpCache = { value: '', time: 0 };
const EGRESS_IP_CACHE_MS = 10 * 60 * 1000;
let egressIpLookupInFlight = null;

async function getPublicEgressIp(force = false) {
  const age = Date.now() - egressIpCache.time;
  if (!force && egressIpCache.value && age < EGRESS_IP_CACHE_MS) {
    return egressIpCache.value;
  }

  if (egressIpLookupInFlight) {
    return egressIpLookupInFlight;
  }

  egressIpLookupInFlight = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const response = await fetch('https://api.ipify.org', { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`ipify returned ${response.status}`);
      }
      const ip = (await response.text()).trim();
      if (ip) {
        egressIpCache = { value: ip, time: Date.now() };
      }
      return egressIpCache.value;
    } catch (err) {
      console.error('Failed to resolve public egress IP:', err?.message || err);
      return egressIpCache.value;
    } finally {
      egressIpLookupInFlight = null;
    }
  })();

  return egressIpLookupInFlight;
}

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
  if (!ENABLE_ZOHO_OUTBOUND) return;
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
if (ENABLE_ZOHO_OUTBOUND) {
  setInterval(refreshZohoToken, 55 * 60 * 1000);
  refreshZohoToken();
} else {
  console.log('[ZOHO OUTBOUND] Disabled (ENABLE_ZOHO_OUTBOUND=false)');
}

// Log outbound egress identity at startup for API access-point tracing.
setTimeout(async () => {
  if (!ENABLE_ZOHO_OUTBOUND) {
    console.log('[ZOHO EGRESS] Skipped (outbound disabled)');
    return;
  }
  const ip = await getPublicEgressIp();
  if (ZOHO_ALLOWED_EGRESS_IPS.size > 0) {
    const allowed = Array.from(ZOHO_ALLOWED_EGRESS_IPS).join(', ');
    console.log(`[ZOHO EGRESS] Current public IP=${ip || 'unknown'} | Allowed=${allowed}`);
  } else {
    console.log(`[ZOHO EGRESS] Current public IP=${ip || 'unknown'} | Allowlist=disabled`);
  }
}, 3000);

// IHUB/SSL alert processors should run only on designated deployments.
if (ENABLE_ALERT_JOBS) {
  // Startup + every 12 hours
  setTimeout(() => {
    processIhubAlerts();
    processIhubCertificateAlerts();
    processSslAlerts();
    processAutomationSslAlerts();
  }, 15 * 1000);
  setInterval(processIhubAlerts, 12 * 60 * 60 * 1000);
  setInterval(processIhubCertificateAlerts, 12 * 60 * 60 * 1000);
  setInterval(processSslAlerts, 12 * 60 * 60 * 1000);
  setInterval(processAutomationSslAlerts, 12 * 60 * 60 * 1000);
} else {
  console.log('[ALERT JOBS] Disabled (ENABLE_ALERT_JOBS=false)');
}

// ------------------------
// ZOHO API HELPER
// ------------------------

// 🚀 Global rate limiter: max 1200 calls/hour (~20/min) to stay well under 85k/day
const ZOHO_RATE_LIMIT_PER_HOUR = 1200;
const zohoRateBucket = {
  tokens: ZOHO_RATE_LIMIT_PER_HOUR,
  lastRefill: Date.now(),
  maxTokens: ZOHO_RATE_LIMIT_PER_HOUR,
  refillRate: ZOHO_RATE_LIMIT_PER_HOUR / 3600000 // tokens per ms
};

function zohoRateLimitCheck() {
  const now = Date.now();
  const elapsed = now - zohoRateBucket.lastRefill;
  zohoRateBucket.tokens = Math.min(
    zohoRateBucket.maxTokens,
    zohoRateBucket.tokens + elapsed * zohoRateBucket.refillRate
  );
  zohoRateBucket.lastRefill = now;

  if (zohoRateBucket.tokens < 1) {
    return false; // rate limited
  }
  zohoRateBucket.tokens -= 1;
  return true;
}

// Track API usage for observability
let zohoApiCallCount = 0;
let zohoApiCallCountResetTime = Date.now();
function trackZohoApiCall() {
  const now = Date.now();
  if (now - zohoApiCallCountResetTime > 3600000) {
    console.log(`[ZOHO RATE] ${zohoApiCallCount} API calls in last hour`);
    zohoApiCallCount = 0;
    zohoApiCallCountResetTime = now;
  }
  zohoApiCallCount++;
}

async function zohoFetch(endpoint, options = {}, baseUrl = ZOHO_BASE_URL) {
  // Rate limit check — reject if budget exhausted
  if (!zohoRateLimitCheck()) {
    console.warn(`[ZOHO RATE LIMIT] Blocked call to ${endpoint} — hourly budget exhausted`);
    return new Response(
      JSON.stringify({ error: 'Zoho API rate limit reached. Try again later.', endpoint }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }
  trackZohoApiCall();

  if (!ENABLE_ZOHO_OUTBOUND) {
    return new Response(
      JSON.stringify({
        error: 'Zoho outbound is disabled for this deployment',
        endpoint
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  if (ZOHO_ALLOWED_EGRESS_IPS.size > 0) {
    const egressIp = await getPublicEgressIp();
    if (!egressIp || !ZOHO_ALLOWED_EGRESS_IPS.has(egressIp)) {
      const allowed = Array.from(ZOHO_ALLOWED_EGRESS_IPS).join(', ');
      console.error(
        `[ZOHO BLOCKED] egress IP ${egressIp || 'unknown'} is not in allowlist: ${allowed}`
      );
      return new Response(
        JSON.stringify({
          error: 'Zoho API blocked by egress IP policy',
          egressIp: egressIp || null,
          allowedIps: Array.from(ZOHO_ALLOWED_EGRESS_IPS)
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }

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

  const res = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers
  });

  if (res.status === 401) {
    await refreshZohoToken();
    return zohoFetch(endpoint, options, baseUrl);
  }

  return res;
}

function getZohoList(data, keys) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (typeof data !== 'object') return [];

  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      const nested = getZohoList(value, keys);
      if (nested.length) return nested;
      return [value];
    }
  }

  if (data.response) {
    return getZohoList(data.response, keys);
  }

  return [];
}

async function fetchZohoPaginatedList(endpointBase, listKeyNames) {
  const items = [];
  const limit = 200;
  let from = 1;
  let hasMore = true;

  while (hasMore) {
    const endpoint = `${endpointBase}${endpointBase.includes('?') ? '&' : '?'}from=${from}&limit=${limit}`;
    const response = await zohoProjectsFetch(endpoint);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Zoho paginated fetch failed: ${response.status} ${text}`);
    }
    const data = await response.json();
    const pageItems = getZohoList(data, listKeyNames);
    if (!Array.isArray(pageItems) || pageItems.length === 0) {
      break;
    }
    items.push(...pageItems);
    if (pageItems.length < limit) {
      hasMore = false;
    } else {
      from += limit;
    }
  }

  return items;
}

function normalizeZohoProject(project) {
  return {
    id: Number(project.id || project.project_id || project.projectId || project.projectId || 0),
    name: project.name || project.project_name || project.projectName || '',
    owner:
      project.owner?.name || project.owner_name || project.owner || project.created_by?.name || 'Unknown',
    status: project.status || project.project_status || project.status_name || 'Planning',
    progress: Number(project.progress ?? project.completion_percentage ?? project.percent_complete ?? 0),
    dueDate: project.end_date || project.due_date || project.target_end_date || ''
  };
}

function normalizeZohoTask(task, projectId) {
  return {
    id: Number(task.id || task.task_id || task.taskId || task.taskId || 0),
    projectId: Number(projectId || task.project_id || task.projectId || 0),
    title: task.name || task.task_name || task.title || 'Untitled Task',
    assignee:
      task.owner?.name || task.assignee?.name || task.assigned_to?.name || task.owner_name || task.assignee_name || 'Unassigned',
    status: task.status || task.task_status || 'To Do',
    priority: task.priority || task.priority_name || 'Medium',
    dueDate: task.due_date || task.end_date || task.dueDate || ''
  };
}

async function zohoProjectsFetch(endpoint, options = {}) {
  return zohoFetch(endpoint, options, ZOHO_PROJECTS_BASE_URL);
}

async function fetchZohoProjectsItems() {
  if (!ENABLE_ZOHO_PROJECTS || !ZOHO_PROJECTS_PORTAL_ID) {
    throw new Error('Zoho Projects is not configured');
  }
  const portal = ZOHO_PROJECTS_PORTAL_ID;
  const projects = await fetchZohoPaginatedList(
    `/portal/${portal}/projects/?status=all`,
    ['projects', 'project']
  );
  return projects.map(normalizeZohoProject).filter(p => p.id > 0);
}

async function fetchZohoTasksForProject(projectId) {
  if (!ENABLE_ZOHO_PROJECTS || !ZOHO_PROJECTS_PORTAL_ID) {
    throw new Error('Zoho Projects is not configured');
  }
  const portal = ZOHO_PROJECTS_PORTAL_ID;
  const response = await zohoProjectsFetch(`/portal/${portal}/projects/${projectId}/tasks/?status=all&from=1&limit=200`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Zoho task list failed for project ${projectId}: ${response.status} ${text}`);
  }
  const data = await response.json();
  const tasks = getZohoList(data, ['tasks', 'task']);
  return tasks.map(task => normalizeZohoTask(task, projectId)).filter(t => t.id > 0);
}

async function fetchZohoTasksItems() {
  const projects = await fetchZohoProjectsItems();
  const settled = await Promise.allSettled(
    projects.map(project => fetchZohoTasksForProject(project.id))
  );
  return settled.reduce((acc, result) => {
    if (result.status === 'fulfilled') {
      return acc.concat(result.value);
    }
    console.warn('Zoho Projects tasks fetch warning:', result.reason?.message || result.reason);
    return acc;
  }, []);
}

async function fetchZohoDashboardItems() {
  const [projects, tasks] = await Promise.all([fetchZohoProjectsItems(), fetchZohoTasksItems()]);
  return {
    totalProjects: projects.length,
    activeProjects: projects.filter(p => /active/i.test(p.status)).length,
    pendingTasks: tasks.filter(t => !/done|completed/i.test(t.status)).length,
    totalHours: 0
  };
}

async function fetchZohoTimeLogsItems() {
  if (!ENABLE_ZOHO_PROJECTS_TIME_LOGS) {
    throw new Error('Zoho Projects time log sync is disabled');
  }
  const portal = ZOHO_PROJECTS_PORTAL_ID;
  const tasks = await fetchZohoTasksItems();
  const entries = [];
  await Promise.allSettled(
    tasks.map(async task => {
      const logs = await fetchZohoPaginatedList(
        `/portal/${portal}/projects/${task.projectId}/tasks/${task.id}/timelogs`,
        ['time_logs', 'timelogs', 'timelog', 'timeLog']
      );
      for (const log of logs) {
        entries.push({
          id: Number(log.id || log.log_id || 0),
          taskId: task.id,
          projectId: task.projectId,
          user: log.user?.name || log.user_name || log.owner?.name || log.owner_name || 'Unknown',
          hours: Number(log.hours || log.time_spent || log.spent_hours || 0),
          date: log.date || log.log_date || '',
          note: log.description || log.note || log.comments || ''
        });
      }
    })
  );
  return entries;
}

async function lookupAgentIdByEmail(email) {
  if (!email) return '';
  const target = email.trim().toLowerCase();

  // 🚀 Use cached agents list first to avoid unnecessary Zoho API calls
  if (agentsCache && Array.isArray(agentsCache) && agentsCache.length > 0) {
    const cached = agentsCache.find(a => (a.email || '').toLowerCase() === target);
    if (cached?.id) return cached.id;
  }

  // Fallback: paginate Zoho agents API only if cache miss
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

// Fail closed like isZohoTicketWebhookAuthorized below: this endpoint creates real
// Zoho tickets from "firing" alerts, so an unset secret must reject, not admit, all.
//
// Checks the standard `Authorization: Bearer <token>` header — this is what
// Alertmanager's http_config.authorization sends via credentials_file, and works
// across Alertmanager versions without depending on custom-header support.
function isAlertmanagerAuthorized(req) {
  if (!ALERTMANAGER_WEBHOOK_SECRET) return false;
  const authHeader = (req.headers['authorization'] || '').toString().trim();
  const provided = authHeader.replace(/^Bearer\s+/i, '');
  return safeTokenEqual(provided, ALERTMANAGER_WEBHOOK_SECRET);
}

// Unlike the Alertmanager secret, this one is required — the endpoint it guards
// writes to ticket_assignments and can be used to spoof a Teams post, so it must
// not run open-by-default just because the env var was never set.
function isZohoTicketWebhookAuthorized(req) {
  if (!ZOHO_TICKET_WEBHOOK_SECRET) return false;
  const provided = (req.headers['x-zoho-webhook-secret'] || req.query.secret || '').toString().trim();
  return safeTokenEqual(provided, ZOHO_TICKET_WEBHOOK_SECRET);
}

// Assigning a ticket through this portal also PATCHes the assignee back to Zoho
// (see /api/assignments and /api/assignments/bulk). If a Zoho workflow rule fires
// on "assignee changed" and calls our webhook, that PATCH would echo straight back
// here and double-post to Teams. This short-lived marker lets the webhook handler
// recognize "we just did this ourselves" and skip the duplicate.
const recentPortalAssignments = new Map(); // zohoTicketId -> timestamp
const PORTAL_ECHO_WINDOW_MS = 60 * 1000;

function markPortalAssignment(zohoTicketId) {
  if (!zohoTicketId) return;
  recentPortalAssignments.set(zohoTicketId.toString(), Date.now());
  if (recentPortalAssignments.size > 500) {
    const cutoff = Date.now() - PORTAL_ECHO_WINDOW_MS;
    for (const [id, ts] of recentPortalAssignments) {
      if (ts < cutoff) recentPortalAssignments.delete(id);
    }
  }
}

function isRecentPortalAssignment(zohoTicketId) {
  const ts = recentPortalAssignments.get((zohoTicketId || '').toString());
  return !!ts && (Date.now() - ts) < PORTAL_ECHO_WINDOW_MS;
}

function parseMilestoneDays(alert) {
  const labels = alert?.labels || {};
  const annotations = alert?.annotations || {};
  const fromLabel = parseInt(labels.milestone_days || labels.days_left || '', 10);
  if (Number.isInteger(fromLabel)) return fromLabel;

  // Prefer annotation text because some alert names encode technical windows
  // (e.g., SSLCert_33Days) while summary/description carry business milestones
  // (30/15/7/3/1 days) used by ticketing.
  const sources = [
    annotations.summary || '',
    annotations.description || '',
    labels.alertname || ''
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
  // Use a fixed alertname so that the scheduled Prometheus job and the
  // Alertmanager webhook share the same fingerprint namespace for the same
  // certificate+milestone combination. Without this, each path generates a
  // different fingerprint (e.g. 'AutomationSSLExpiry' vs 'SSLCert_30Days')
  // and both create tickets for the same cert — the primary duplicate vector.
  const raw = [
    'SSL_ALERT',
    labels.client || 'unknown-client',
    labels.instance || labels.target || labels.url || 'unknown-instance',
    labels.application || 'unknown-app',
    String(milestoneDays)
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function fetchAutomationSslMonitoredUrls() {
  if (!AUTOMATION_PROMETHEUS_URL) {
    throw new Error('AUTOMATION_PROMETHEUS_URL is not configured');
  }

  const diagnostics = {
    timestamp: new Date().toISOString(),
    targetsWithProbeSuccess: 0,
    targetsWithSslMetric: 0,
    targetsWithoutSslMetric: [],
    missingMetricDetails: []
  };

  const baseUrl = AUTOMATION_PROMETHEUS_URL.replace(/\/$/, '');
  const queryPrometheus = async (query, errorMessage) => {
    const url = `${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
    const response = await fetch(url, { method: 'GET' });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== 'success') {
      throw new Error(errorMessage);
    }
    return Array.isArray(payload?.data?.result) ? payload.data.result : [];
  };

  // Use probe_success as the baseline so all configured targets are visible,
  // even when certificate-expiry metric is unavailable for failed probes.
  const [successRows, expiryRows] = await Promise.all([
    queryPrometheus('probe_success', 'Failed to fetch probe availability metrics from Prometheus'),
    queryPrometheus('probe_ssl_earliest_cert_expiry', 'Failed to fetch SSL expiry metrics from Prometheus')
  ]);

  const today = toStartOfDay(new Date());
  diagnostics.targetsWithProbeSuccess = successRows.length;
  diagnostics.targetsWithSslMetric = expiryRows.length;

  const keyFromMetric = (metric = {}) => {
    const instance = (metric.instance || metric.target || '').trim().toLowerCase();
    const client = (metric.client || '').trim().toLowerCase();
    const environment = (metric.environment || '').trim().toLowerCase();
    const application = (metric.application || '').trim().toLowerCase();
    return [instance, client, environment, application].join('|');
  };

  const mappedByKey = new Map();
  const expiryKeySet = new Set(expiryRows.map(r => keyFromMetric(r?.metric || {})));

  for (const row of successRows) {
    const metric = row?.metric || {};
    const value = Number(Array.isArray(row?.value) ? row.value[1] : NaN);
    const key = keyFromMetric(metric);

    if (!expiryKeySet.has(key)) {
      const instance = (metric.instance || metric.target || '').trim();
      diagnostics.targetsWithoutSslMetric.push(instance);
      diagnostics.missingMetricDetails.push({
        instance,
        client: (metric.client || '').trim() || 'Unknown',
        environment: (metric.environment || '').trim() || 'Unknown',
        application: (metric.application || '').trim() || 'Unknown',
        probeSuccess: Number.isFinite(value) ? value === 1 : null
      });
    }

    mappedByKey.set(key, {
      client: (metric.client || '').trim() || 'Unknown',
      environment: (metric.environment || '').trim() || 'Unknown',
      application: (metric.application || '').trim() || 'Unknown',
      ssl_url: (metric.instance || metric.target || '').trim() || '',
      responsible: (metric.responsible || '').trim() || null,
      responsible_email: (metric.responsible_email || metric.owner_email || metric.email || '').trim().toLowerCase() || null,
      hostname: (metric.hostname || '').trim() || null,
      ip_address: (metric.ip_address || '').trim() || null,
      version: (metric.version || '').trim() || null,
      estimated_expiry_on: null,
      estimated_days_to_expiry: null,
      metric_value: null,
      probe_success: Number.isFinite(value) ? value === 1 : null
    });
  }

  for (const row of expiryRows) {
    const metric = row?.metric || {};
    const value = Number(Array.isArray(row?.value) ? row.value[1] : NaN);
    const expiryDate = Number.isFinite(value) ? toStartOfDay(new Date(value * 1000)) : null;
    const daysToExpiry = expiryDate
      ? Math.floor((expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const key = keyFromMetric(metric);

    const existing = mappedByKey.get(key) || {
      client: (metric.client || '').trim() || 'Unknown',
      environment: (metric.environment || '').trim() || 'Unknown',
      application: (metric.application || '').trim() || 'Unknown',
      ssl_url: (metric.instance || metric.target || '').trim() || '',
      responsible: (metric.responsible || '').trim() || null,
      responsible_email: (metric.responsible_email || metric.owner_email || metric.email || '').trim().toLowerCase() || null,
      hostname: (metric.hostname || '').trim() || null,
      ip_address: (metric.ip_address || '').trim() || null,
      version: (metric.version || '').trim() || null,
      probe_success: null
    };

    mappedByKey.set(key, {
      ...existing,
      estimated_expiry_on: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
      estimated_days_to_expiry: daysToExpiry,
      metric_value: Number.isFinite(value) ? value : null
    });
  }

  console.log('[Automation SSL] Diagnostics:', JSON.stringify(diagnostics, null, 2));
  global.lastAutomationSslDiagnostics = diagnostics;

  return Array.from(mappedByKey.values())
    .sort((a, b) => {
      const aDays = Number.isFinite(a.estimated_days_to_expiry) ? a.estimated_days_to_expiry : Number.MAX_SAFE_INTEGER;
      const bDays = Number.isFinite(b.estimated_days_to_expiry) ? b.estimated_days_to_expiry : Number.MAX_SAFE_INTEGER;
      if (aDays !== bDays) return aDays - bDays;
      return (a.client || '').localeCompare(b.client || '');
    });
}

async function processAutomationSslAlerts() {
  const summary = {
    scanned: 0,
    matchedMilestones: 0,
    created: 0,
    duplicate: 0,
    skipped: 0,
    errors: 0
  };

  try {
    if (!AUTOMATION_PROMETHEUS_URL) {
      console.warn('[Automation SSL] Skipping alert generation: AUTOMATION_PROMETHEUS_URL is not configured');
      return {
        ...summary,
        skipped: summary.skipped + 1,
        reason: 'AUTOMATION_PROMETHEUS_URL is not configured'
      };
    }

    const monitoredRows = await fetchAutomationSslMonitoredUrls();
    summary.scanned = monitoredRows.length;
    console.log(`[Automation SSL] Processing ${monitoredRows.length} monitored URLs for alert generation...`);

    for (const row of monitoredRows) {
      const daysLeft = row.estimated_days_to_expiry;
      if (!Number.isInteger(daysLeft) || !AUTOMATION_SSL_ALERT_MILESTONES.includes(daysLeft)) {
        summary.skipped += 1;
        continue;
      }
      summary.matchedMilestones += 1;

      const instance = (row.ssl_url || row.hostname || '').trim();
      const alert = {
        labels: {
          alertname: 'AutomationSSLExpiry',
          milestone_days: String(daysLeft),
          client: row.client || 'Unknown',
          environment: row.environment || 'Unknown',
          application: row.application || 'Unknown',
          instance,
          responsible: row.responsible || '',
          responsible_email: row.responsible_email || ''
        },
        annotations: {
          summary: `SSL certificate expires in ${daysLeft} day(s)`,
          description: `Prometheus milestone detected for ${instance || 'unknown endpoint'}`
        },
        startsAt: new Date().toISOString(),
        generatorURL: AUTOMATION_PROMETHEUS_URL
      };

      try {
        const result = await createAlertmanagerSslTicket(alert, daysLeft);
        if (result.status === 'created') {
          summary.created += 1;
          console.log(`[Automation SSL] Created ticket for ${instance || row.client} at ${daysLeft} day milestone`);
        } else if (result.status === 'duplicate') {
          summary.duplicate += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (err) {
        summary.errors += 1;
        console.error(`[Automation SSL] Ticket creation failed for ${instance || row.client}:`, err?.message || err);
      }
    }
    return summary;
  } catch (err) {
    summary.errors += 1;
    console.error('[Automation SSL] Alert processor failed:', err?.message || err);
    return {
      ...summary,
      reason: err?.message || String(err)
    };
  }
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

  // Primary dedup: check by normalised fingerprint (alertname-agnostic).
  // Secondary dedup: check by (instance, milestone_days, client) so that
  // records created with old fingerprints (before the normalisation change)
  // still prevent cross-path duplicates.
  const existing = await pool.query(
    `SELECT id, status FROM alertmanager_ssl_tickets 
     WHERE (
       alert_fingerprint = $1
       OR (instance = $2 AND milestone_days = $3 AND client = $4)
     )
     AND status IN ('Open', 'Pending')
     ORDER BY id DESC LIMIT 1`,
    [fingerprint, instance, milestoneDays, client]
  );
  if (existing.rows.length > 0) {
    return { status: 'duplicate', reason: 'already processed' };
  }

  // Remove old closed rows that share the fingerprint so the UNIQUE
  // constraint allows a fresh insert for a renewed certificate.
  await pool.query(
    `DELETE FROM alertmanager_ssl_tickets WHERE alert_fingerprint = $1 AND status = 'Closed'`,
    [fingerprint]
  );

  // ON CONFLICT DO NOTHING guards against race conditions where two
  // concurrent callers (scheduler + webhook) both pass the check above
  // before either has committed its INSERT.
  const reservation = await pool.query(
    `INSERT INTO alertmanager_ssl_tickets
      (alert_fingerprint, alertname, milestone_days, client, environment, application, instance, responsible, responsible_email, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
     ON CONFLICT (alert_fingerprint) DO NOTHING
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

// Called by a Zoho Desk workflow rule whenever a ticket is assigned directly in
// Zoho (i.e. not through this portal's Assign/Bulk Assign). Mirrors the
// assignment into ticket_assignments — so the CloudOps dashboard/report counts
// it too — and notifies the CloudOps Teams channel, same as portal assignments.
// Requires ZOHO_TICKET_WEBHOOK_SECRET to be set; see setup notes in .env.
app.post('/api/webhook/zoho-ticket-assigned', async (req, res) => {
  if (!isZohoTicketWebhookAuthorized(req)) {
    return res.status(401).json({ message: 'Invalid or missing webhook secret' });
  }

  try {
    const {
      ticketId,
      ticketNumber,
      departmentId,
      assigneeEmail,
      assignedByEmail,
      category,
      status
    } = req.body || {};

    const zohoTicketId = (ticketId || '').toString().trim();
    const primaryAssignee = (assigneeEmail || '').toString().trim().toLowerCase();

    if (!zohoTicketId || !primaryAssignee) {
      return res.status(400).json({ message: 'ticketId and assigneeEmail are required' });
    }

    // Our own portal PATCHes the assignee back to Zoho on every assign/reassign,
    // which would otherwise trigger this same Zoho workflow rule and double-post.
    if (isRecentPortalAssignment(zohoTicketId)) {
      return res.json({ message: 'Skipped — matches a recent portal-driven assignment' });
    }

    const normalizedDeptId = (departmentId || '').toString().trim() || null;
    const normalizedCategory = (category || '').toString().trim() || null;
    const normalizedAssignedBy = (assignedByEmail || '').toString().trim().toLowerCase() || 'zoho-desk';

    await pool.query(
      `INSERT INTO ticket_assignments
        (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, status, category, zoho_department_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (zoho_ticket_id) DO UPDATE SET
         assigned_users = EXCLUDED.assigned_users,
         primary_assignee = EXCLUDED.primary_assignee,
         reassigned_user = ticket_assignments.primary_assignee,
         reassigned_at = NOW(),
         reassigned_by = EXCLUDED.assigned_by,
         category = COALESCE(EXCLUDED.category, ticket_assignments.category),
         zoho_department_id = COALESCE(EXCLUDED.zoho_department_id, ticket_assignments.zoho_department_id),
         updated_at = NOW()`,
      [zohoTicketId, ticketNumber || null, [primaryAssignee], primaryAssignee, normalizedAssignedBy, status || 'Open', normalizedCategory, normalizedDeptId]
    );

    notifyCloudOpsTeamsOnAssignment({
      zohoTicketId,
      zohoTicketNumber: ticketNumber,
      zohoDepartmentId: normalizedDeptId,
      assignedUsers: [primaryAssignee],
      assignedBy: normalizedAssignedBy,
      category: normalizedCategory
    }).catch(() => {});

    invalidateRuntimeCaches();
    res.json({ message: 'Assignment recorded' });
  } catch (err) {
    console.error('Zoho ticket-assigned webhook failed:', err);
    res.status(500).json({ message: 'Failed to process webhook' });
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

async function upsertIhubCertificateAssignment(ticketId, ticketNumber, assigneeEmail) {
  const normalizedEmail = (assigneeEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return;

  await pool.query(
    `INSERT INTO ticket_assignments
      (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
     VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'IHUB_CERTIFICATE')
     ON CONFLICT (zoho_ticket_id) DO UPDATE SET
       assigned_users = EXCLUDED.assigned_users,
       primary_assignee = EXCLUDED.primary_assignee,
       reassigned_user = ticket_assignments.primary_assignee,
       reassigned_at = NOW(),
       reassigned_by = EXCLUDED.assigned_by,
       category = 'IHUB_CERTIFICATE',
       status = 'Open',
       updated_at = NOW()`,
    [
      ticketId,
      ticketNumber || null,
      [normalizedEmail],
      normalizedEmail,
      'ihub-certificate-system',
      ZOHO_DEPARTMENT_ID || null
    ]
  );
}

async function createIhubCertificateAlertTicket(asset, milestoneDays) {
  const responsibleEmail = (asset.responsible_person_email || '').trim().toLowerCase();
  console.log(`[IHUB CERTIFICATE] createIhubCertificateAlertTicket: Asset ${asset.id}, email="${responsibleEmail}"`);

  if (!responsibleEmail) {
    console.log(`[IHUB CERTIFICATE] createIhubCertificateAlertTicket: No responsible email for asset ${asset.id}, skipping`);
    return;
  }

  const licenseExpiryOn = normalizeDateOnly(asset.license_expiry);
  console.log(`[IHUB CERTIFICATE] Checking for existing alert: asset=${asset.id}, milestone=${milestoneDays}, expiry=${licenseExpiryOn}`);

  // Reserve the alert row first to prevent concurrent runs from creating duplicate Zoho tickets.
  const reservationTicketId = `IHUB-CERT-PENDING-${asset.id}-${milestoneDays}-${licenseExpiryOn}-${Date.now()}`;
  const reservation = await pool.query(
    `INSERT INTO ihub_certificate_alert_tickets
      (ihub_certificate_asset_id, milestone_days, license_expiry_on, zoho_ticket_id, status)
     VALUES ($1, $2, $3, $4, 'Pending')
     ON CONFLICT (ihub_certificate_asset_id, milestone_days, license_expiry_on) DO NOTHING
     RETURNING id`,
    [asset.id, milestoneDays, licenseExpiryOn, reservationTicketId]
  );

  if (reservation.rows.length === 0) {
    console.log(`[IHUB CERTIFICATE] Alert already exists for asset ${asset.id} at ${milestoneDays} days, skipping`);
    return;
  }

  const alertRowId = reservation.rows[0].id;

  const subject = `[IHUB Certificate] Certificate expiry in ${milestoneDays} day(s) - ${asset.client} (${asset.hostname})`;
  const description = [
    '<p><strong>IHUB Certificate Expiry Alert</strong></p>',
    `<p>Certificate is due in <strong>${milestoneDays}</strong> day(s).</p>`,
    `<p>Client: ${asset.client}</p>`,
    `<p>Environment: ${asset.environment}</p>`,
    `<p>Hostname: ${asset.hostname}</p>`,
    `<p>IP Address: ${asset.ip_address}</p>`,
    `<p>IHUB Version: ${asset.ihub_version || 'N/A'}</p>`,
    `<p>Certificate Expiry: ${licenseExpiryOn}</p>`,
    `<p>Responsible Person: ${responsibleEmail}</p>`
  ].join('');

  const payload = {
    subject,
    priority: priorityForIhubAndSslMilestone(milestoneDays),
    status: 'Open',
    // Zoho Desk's ticket category picklist only has 'IHUB' configured (Automation
    // SSL similarly reuses the 'SSL' category) - subCategory + subject differentiate.
    category: 'IHUB',
    subCategory: 'Certificate Expiry',
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

  console.log(`[IHUB CERTIFICATE] Creating Zoho ticket for asset ${asset.id}:`, subject);
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
      console.warn(`[IHUB CERTIFICATE] Zoho rejected assigneeId for asset ${asset.id}, retrying without assigneeId`);
      delete payload.assigneeId;
      response = await zohoFetch('/tickets', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      data = await response.json().catch(() => null);
    }
  }

  if (!response.ok || !data?.id) {
    const errorMsg = data?.message || `IHUB Certificate alert ticket creation failed (${response.status})`;
    console.error(`[IHUB CERTIFICATE] Zoho API error for asset ${asset.id}:`, errorMsg, data);

    // Release reservation on failure so future runs can retry.
    await pool.query(
      `DELETE FROM ihub_certificate_alert_tickets
       WHERE id = $1 AND status = 'Pending'`,
      [alertRowId]
    );

    throw new Error(errorMsg);
  }

  console.log(`[IHUB CERTIFICATE] Zoho ticket created: ${data.id} (${data.ticketNumber})`);

  await pool.query(
    `UPDATE ihub_certificate_alert_tickets
     SET zoho_ticket_id = $1,
         zoho_ticket_number = $2,
         status = 'Open'
     WHERE id = $3`,
    [data.id, data.ticketNumber || null, alertRowId]
  );

  console.log(`[IHUB CERTIFICATE] Alert ticket record created in DB for asset ${asset.id}`);

  await upsertIhubCertificateAssignment(data.id, data.ticketNumber || null, responsibleEmail);
  console.log(`[IHUB CERTIFICATE] Assignment created for asset ${asset.id}`);
}

async function processIhubCertificateAlerts() {
  try {
    const result = await pool.query('SELECT * FROM ihub_certificate_assets');
    console.log(`[IHUB CERTIFICATE] Processing ${result.rows.length} assets for alert generation...`);

    for (const asset of result.rows) {
      const daysLeft = daysUntilDate(asset.license_expiry);
      console.log(`[IHUB CERTIFICATE] Asset ${asset.id} (${asset.client}): ${daysLeft} days until expiry on ${asset.license_expiry}, email: ${asset.responsible_person_email}`);

      if (!IHUB_CERTIFICATE_ALERT_MILESTONES.includes(daysLeft)) {
        console.log(`[IHUB CERTIFICATE] Asset ${asset.id}: ${daysLeft} days not in milestones [${IHUB_CERTIFICATE_ALERT_MILESTONES.join(',')}], skipping`);
        continue;
      }

      try {
        console.log(`[IHUB CERTIFICATE] Creating alert ticket for asset ${asset.id} at ${daysLeft} day milestone`);
        await createIhubCertificateAlertTicket(asset, daysLeft);
        console.log(`[IHUB CERTIFICATE] Alert ticket created successfully for asset ${asset.id}`);
      } catch (err) {
        console.error(`IHUB Certificate alert generation failed for asset ${asset.id}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('IHUB Certificate alert processor failed:', err?.message || err);
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
const COUNTS_CACHE_MS = 2 * 60 * 60 * 1000;   // 2 hour "fresh" window (reduced API consumption)
const COUNTS_STALE_MS = 4 * 60 * 60 * 1000;   // 4 hour serve-stale-while-revalidate window
const countsRefreshInFlight = new Map();      // Dedupe concurrent background refreshes
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
  // Stale-while-revalidate: ALWAYS return immediately from cache when available,
  // refresh in the background. Browser may also use ETag for 304s.
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');
  res.set('Pragma', 'no-cache');

  try {
    const userEmail = req.user?.email?.toLowerCase() || '';
    const userRole = (req.user?.role || 'user').toLowerCase();
    const isAdmin = userRole === 'admin' || userRole === 'cloudops';
    let allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);

    // Allow admin to filter by specific department
    const reqDeptId = (req.query.departmentId || '').toString().trim();
    if (isAdmin && reqDeptId) {
      allowedDeptIds = [reqDeptId];
    }

    // Per-user cache key — assigned/SLA counts are personal even for admins.
    const cacheKey = `counts_${isAdmin ? 'admin_' : 'user_'}${userRole}_${userEmail}${reqDeptId ? '_dept_' + reqDeptId : ''}`;
    const cached = countsCache.get(cacheKey);
    const now = Date.now();
    const age = cached ? now - cached.time : Infinity;

    // 1) Fresh cache → instant response.
    if (cached && age < COUNTS_CACHE_MS) {
      console.log(`[CACHE HIT-FRESH] ${cacheKey} age=${age}ms`);
      res.set('X-ITSM-Counts-Cache', `HIT-FRESH;node=${NODE_ID};ageMs=${age}`);
      res.set('ETag', cached.etag);
      if (req.get('if-none-match') === cached.etag) return res.status(304).end();
      return res.json(cached.data);
    }

    // 2) Stale cache → instant response + background refresh.
    if (cached && age < COUNTS_STALE_MS) {
      console.log(`[CACHE HIT-STALE] ${cacheKey} age=${age}ms (refreshing in background)`);
      res.set('X-ITSM-Counts-Cache', `HIT-STALE;node=${NODE_ID};ageMs=${age}`);
      res.set('ETag', cached.etag);
      if (req.get('if-none-match') !== cached.etag) {
        res.json(cached.data);
      } else {
        res.status(304).end();
      }
      // Fire-and-forget refresh, deduped per cache key.
      refreshCountsCache(cacheKey, userEmail, isAdmin, allowedDeptIds).catch(err =>
        console.error(`Background counts refresh failed for ${cacheKey}:`, err?.message || err)
      );
      return;
    }

    // 3) Cold cache → must compute synchronously.
    console.log(`[CACHE MISS] ${cacheKey} - computing fresh counts`);
    res.set('X-ITSM-Counts-Cache', `MISS;node=${NODE_ID}`);
    const countData = await refreshCountsCache(cacheKey, userEmail, isAdmin, allowedDeptIds);
    const fresh = countsCache.get(cacheKey);
    res.set('ETag', fresh.etag);
    if (req.get('if-none-match') === fresh.etag) return res.status(304).end();
    // Pre-warm user's "My Tickets" caches in background after responding.
    prewarmUserTickets(userEmail, userRole);
    res.json(countData);
  } catch (err) {
    console.error('Counts error:', err);
    res.status(500).json({ error: 'Failed to fetch ticket counts' });
  }
});

// Background-prefetch a user's My Tickets (open + closed) if not already fresh.
function prewarmUserTickets(userEmail, userRole = 'user') {
  if (!userEmail) return;
  const allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);
  for (const status of ['open', 'closed']) {
    const cacheKey = `${userRole}_${userEmail}_${status}`;
    const cached = userTicketsCache.get(cacheKey);
    if (cached && (Date.now() - cached.time) < USER_TICKETS_CACHE_MS) continue;
    refreshUserTicketsCache(cacheKey, userEmail, status, allowedDeptIds).catch(err =>
      console.error(`Pre-warm user-tickets failed for ${cacheKey}:`, err?.message || err)
    );
  }
}

// ---- Counts computation (extracted so it can run in background + at startup) ----
async function computeCounts(userEmail, isAdmin, allowedDeptIds = []) {
  const recycledTicketIds = await getActiveRecycledTicketIds();

  let mySupabaseAssignedIds = new Set();
  if (userEmail) {
    try {
      const r = await pool.query(
        "SELECT zoho_ticket_id FROM ticket_assignments WHERE $1 = ANY(assigned_users)",
        [userEmail]
      );
      mySupabaseAssignedIds = new Set(r.rows.map(x => x.zoho_ticket_id));
    } catch (e) {
      console.error('Error fetching Supabase assignments:', e?.message || e);
    }
  }

  const PAGE_SIZE = 100;
  const PARALLEL_PAGES = 3;
  const hasSingleDept = Array.isArray(allowedDeptIds) && allowedDeptIds.length === 1;
  const deptQuery = hasSingleDept ? `&departmentId=${allowedDeptIds[0]}` : '';
  async function fetchPageWithRetry(status, from) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let r;
      try {
        r = await zohoFetch(`/tickets?limit=${PAGE_SIZE}&from=${from}&status=${status}&include=assignee${deptQuery}`);
      } catch (e) {
        console.error(`Network error fetching ${status} at from=${from}:`, e?.message || e);
        return { tickets: [], more: false };
      }
      if (r.status === 429) {
        await new Promise(rs => setTimeout(rs, 2000));
        continue;
      }
      if (!r.ok) return { tickets: [], more: false };
      let data; try { data = await r.json(); } catch { return { tickets: [], more: false }; }
      const tickets = data.data || [];
      const more = data.info?.moreRecords ?? (tickets.length >= PAGE_SIZE);
      return { tickets, more };
    }
    return { tickets: [], more: false };
  }

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
      await new Promise(r => setTimeout(r, 400));
      let anyMore = false;
      for (const { tickets, more } of results) {
        for (const t of tickets) {
          const ticketId = (t.id || '').toString();
          if (
            ticketId &&
            !recycledTicketIds.has(ticketId) &&
            isDepartmentAllowed(t, allowedDeptIds)
          ) {
            perTicket(t, ticketId);
          }
        }
        if (more) anyMore = true;
      }
      if (!anyMore) break;
      from += offsets.length * PAGE_SIZE;
    }
  }

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

  return {
    scope: isAdmin ? 'all' : 'mine',
    open: openCount,
    closed: closedCount,
    sla: slaCount,
    assigned: assignedCount,
    total: openCount + closedCount
  };
}

// Dedupe concurrent refreshes for the same cache key.
async function refreshCountsCache(cacheKey, userEmail, isAdmin, allowedDeptIds = []) {
  const inflight = countsRefreshInFlight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const start = Date.now();
    const countData = await computeCounts(userEmail, isAdmin, allowedDeptIds);
    const etag = '"' + crypto.createHash('md5').update(JSON.stringify(countData)).digest('hex') + '"';
    countsCache.set(cacheKey, { data: countData, time: Date.now(), etag });
    console.log(`[COUNTS REFRESHED] ${cacheKey} in ${Date.now() - start}ms`);
    return countData;
  })().finally(() => countsRefreshInFlight.delete(cacheKey));

  countsRefreshInFlight.set(cacheKey, promise);
  return promise;
}

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
const USER_TICKETS_CACHE_MS  = 5 * 60 * 1000;   // 5 min "fresh" window for My Tickets (was 60s)
const USER_TICKETS_STALE_MS  = 30 * 60 * 1000;  // 30 min serve-stale-while-revalidate window
const userTicketsRefreshInFlight = new Map();   // Dedupe concurrent refreshes

// Shared cache for standard tickets endpoint (non filterByEmail requests).
const standardTicketsCache = new Map();          // key: endpoint -> { payload, time }
const STANDARD_TICKETS_CACHE_MS = 30 * 1000;    // 30 sec fresh window
const STANDARD_TICKETS_STALE_MS = 5 * 60 * 1000; // 5 min stale-while-revalidate window
const standardTicketsRefreshInFlight = new Map();

function invalidateRuntimeCaches() {
  // Mark all counts entries as stale (so SWR refreshes them) instead of
  // wiping them, which would force the next dashboard hit to wait 5-7s.
  for (const [key, entry] of countsCache.entries()) {
    entry.time = 0; // age = Infinity → still served as stale, refresh kicked off
    countsCache.set(key, entry);
  }
  // Same SWR treatment for per-user ticket caches.
  for (const [key, entry] of userTicketsCache.entries()) {
    entry.time = 0;
    userTicketsCache.set(key, entry);
  }
  // Per-user caches are already stale-marked above; they'll self-refresh on
  // the next request via SWR — no shared-admin pre-warm needed here.

  // Standard ticket list cache should also be stale-marked.
  for (const [key, entry] of standardTicketsCache.entries()) {
    entry.time = 0;
    standardTicketsCache.set(key, entry);
  }
}

async function refreshStandardTicketsCache(cacheKey, endpoint, limit, allowedDeptIds = []) {
  const inflight = standardTicketsRefreshInFlight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const response = await zohoFetch(endpoint);
    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch {
        // ignore parse error
      }
      const details = errorData?.message || errorData?.error || 'Unknown error';
      throw new Error(`Failed to fetch tickets from Zoho (${response.status}): ${details}`);
    }

    const data = await response.json();
    const normalized = (data.data || []).map(t => ({
      ...t,
      email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
      assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId
    }));

    const recycledIds = await getActiveRecycledTicketIds();
    const filtered = normalized.filter(t => {
      if (recycledIds.has((t.id || '').toString())) return false;
      return isDepartmentAllowed(t, allowedDeptIds);
    });

    const payload = {
      count: filtered.length || 0,
      hasMore: (data.data || []).length === limit,
      data: filtered
    };

    standardTicketsCache.set(cacheKey, {
      payload,
      time: Date.now()
    });

    return payload;
  })().finally(() => standardTicketsRefreshInFlight.delete(cacheKey));

  standardTicketsRefreshInFlight.set(cacheKey, promise);
  return promise;
}

// ── Compute the full filtered ticket list for a user ──
// Uses Zoho contact search (fast path) + limited assignee scan + Supabase-assigned fetch.
async function computeUserTickets(userEmail, status, allowedDeptIds = []) {
  const include = 'contacts,assignee';

  const [recycledIds, supabaseResult] = await Promise.all([
    getActiveRecycledTicketIds(),
    pool.query(
      "SELECT zoho_ticket_id FROM ticket_assignments WHERE $1 = ANY(assigned_users)",
      [userEmail]
    ).catch(e => { console.error('Supabase assignment fetch error:', e?.message || e); return { rows: [] }; })
  ]);
  const supabaseAssignedIds = new Set(supabaseResult.rows.map(r => r.zoho_ticket_id));

  // status filter lists for Zoho API
  let statusValues;
  if (status === 'open') statusValues = ['Open', 'In Progress', 'On Hold', 'Escalated'];
  else if (status === 'closed') statusValues = ['Closed', 'Resolved'];
  else statusValues = [''];

  const seenIds = new Set();
  const allUserTickets = [];

  function isStatusMatch(t) {
    const s = (t.status || '').toLowerCase();
    if (status === 'open') return !s.includes('closed') && !s.includes('resolved');
    if (status === 'closed') return s.includes('closed') || s.includes('resolved');
    return true;
  }

  function addTicket(t) {
    const tid = (t.id || '').toString();
    if (!tid || recycledIds.has(tid) || seenIds.has(tid)) return;
    if (!isDepartmentAllowed(t, allowedDeptIds)) return;
    const contactEmail = (t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail || '').toLowerCase();
    const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || '').toLowerCase();
    const isRequester = contactEmail === userEmail;
    const isAssignee = assigneeEmail === userEmail || supabaseAssignedIds.has(tid);
    if (!isRequester && !isAssignee) return;
    seenIds.add(tid);
    allUserTickets.push({
      ...t,
      email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
      assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId,
      _isRequester: isRequester,
      _isAssignee: isAssignee
    });
  }

  // ── Path 1: Contact-based search (fast — gets tickets where user is the requester) ──
  try {
    const contactRes = await zohoFetch(`/contacts/search?email=${encodeURIComponent(userEmail)}&limit=5`)
      .then(r => r.ok ? r.json() : null)
      .catch(() => null);
    const contacts = Array.isArray(contactRes?.data) ? contactRes.data : [];

    // Some Zoho setups have duplicate contact records for one email.
    // Scan all matched contacts so requester tickets aren't missed.
    for (const contact of contacts) {
      if (!contact?.id) continue;
      let from = 0;
      let more = true;
      while (more) {
        const res = await zohoFetch(
          `/contacts/${contact.id}/tickets?from=${from}&limit=100&include=${include}`
        ).then(r => r.ok ? r.json() : null).catch(() => null);
        const tickets = res?.data || [];
        tickets.filter(isStatusMatch).forEach(t => {
          // Force-set email since these tickets come from the matched contact.
          if (!t.email && !t.contact?.email && !t.contact?.emailAddress) {
            t.email = (contact.email || userEmail).toLowerCase();
          }
          addTicket(t);
        });
        more = tickets.length === 100;
        from += 100;
        if (from > 2000) more = false;
      }
    }
  } catch (e) {
    console.error('[computeUserTickets] contact path error:', e?.message || e);
  }

  // ── Path 2: Fallback scan for requester/assignee tickets in global list ──
  {
    const BATCH = 5;
    const PAGE = 100;
    const MAX_OFFSET = 3000;
    let from = 0;
    let keepScanning = true;
    while (keepScanning) {
      const batchPromises = [];
      for (let i = 0; i < BATCH; i++) {
        const offset = from + i * PAGE;
        if (offset > MAX_OFFSET) break;
        batchPromises.push(
          zohoFetch(`/tickets?limit=${PAGE}&from=${offset}&include=${include}`)
            .then(r => r.ok ? r.json() : { data: [] })
            .then(d => ({ data: d.data || [], offset }))
            .catch(() => ({ data: [], offset }))
        );
      }
      if (!batchPromises.length) break;
      const batchResults = await Promise.all(batchPromises);
      batchResults.sort((a, b) => a.offset - b.offset);
      let anyFull = false;
      for (const r of batchResults) {
        for (const t of r.data) {
          const tid = (t.id || '').toString();
          const requesterEmail = (
            t.email ||
            t.contact?.email ||
            t.contact?.emailAddress ||
            t.contact?.secondaryEmail ||
            t.requester?.email ||
            t.customer?.email
          || '').toLowerCase();
          const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || '').toLowerCase();
          const isRequester = requesterEmail === userEmail;
          const isAssignee = assigneeEmail === userEmail || supabaseAssignedIds.has(tid);
          if ((isRequester || isAssignee) && isStatusMatch(t)) {
            addTicket(t);
          }
        }
        if (r.data.length === PAGE) anyFull = true;
      }
      if (!anyFull) break;
      from += BATCH * PAGE;
      if (from > MAX_OFFSET) break;
      keepScanning = true;
    }
  }

  // ── Path 3: Fetch any Supabase-assigned tickets not yet seen ──
  const missingIds = [...supabaseAssignedIds].filter(id => !seenIds.has(id));
  if (missingIds.length) {
    const BATCH_SIZE = 10;
    for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
      const batch = missingIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(tid =>
          zohoFetch(`/tickets/${tid}?include=${include}`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      for (const r of results) {
        const t = r.status === 'fulfilled' ? r.value : null;
        if (t?.id && isStatusMatch(t)) addTicket(t);
      }
    }
  }

  return allUserTickets;
}

// ── Refresh user-tickets cache; deduped per cache key ──
// cacheKey covers (role, email, status) only — filterType ('all'/'assigned'/'raised')
// is derived in-memory from the cached set via deriveUserTicketsView(), so switching
// tabs never triggers another Zoho scan.
async function refreshUserTicketsCache(cacheKey, userEmail, status, allowedDeptIds = []) {
  const inflight = userTicketsRefreshInFlight.get(cacheKey);
  if (inflight) return inflight;

  const promise = (async () => {
    const start = Date.now();
    const tickets = await computeUserTickets(userEmail, status, allowedDeptIds);
    userTicketsCache.set(cacheKey, { tickets, time: Date.now() });
    console.log(`[USER-TICKETS REFRESHED] ${cacheKey} → ${tickets.length} rows in ${Date.now() - start}ms`);
    return tickets;
  })().finally(() => userTicketsRefreshInFlight.delete(cacheKey));

  userTicketsRefreshInFlight.set(cacheKey, promise);
  return promise;
}

function deriveUserTicketsView(tickets, filterType) {
  const source = tickets || [];
  let filtered = source;
  if (filterType === 'assigned') filtered = source.filter(t => t._isAssignee);
  else if (filterType === 'raised') filtered = source.filter(t => t._isRequester);
  return filtered.map(({ _isRequester, _isAssignee, ...rest }) => rest);
}

app.get('/api/tickets', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 27;
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status;
    const search = req.query.search;
    const filterByEmail = req.query.filterByEmail; // Server-side user filter
    const userRole = (req.user?.role || 'user').toLowerCase();
    const allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);
    const from = (page - 1) * limit;
    const include = 'contacts,assignee';

    if (filterByEmail) {
      const userEmail = filterByEmail.toLowerCase();
      const filterType = req.query.filterType || 'all'; // 'all' | 'assigned' | 'raised'
      const forceRefresh = req.query.refresh === 'true';
      // Cache key intentionally excludes filterType — the underlying scan already
      // captures both requester and assignee tickets, so all three tabs share one
      // cached scan per (role, email, status) and just filter it in memory below.
      const cacheKey = `${userRole}_${userEmail}_${status || 'all'}`;
      const startIdx = (page - 1) * limit;
      const cached = userTicketsCache.get(cacheKey);
      const age = cached ? Date.now() - cached.time : Infinity;

      let rawUserTickets;

      if (!forceRefresh && cached && age < USER_TICKETS_CACHE_MS) {
        // Fresh — instant
        rawUserTickets = cached.tickets;
      } else if (cached && age < USER_TICKETS_STALE_MS) {
        // Stale — serve cached + refresh in background
        rawUserTickets = cached.tickets;
        refreshUserTicketsCache(cacheKey, userEmail, status, allowedDeptIds).catch(err =>
          console.error(`Background user-tickets refresh failed for ${cacheKey}:`, err?.message || err)
        );
      } else {
        // Cold — must compute synchronously
        rawUserTickets = await refreshUserTicketsCache(cacheKey, userEmail, status, allowedDeptIds);
      }

      const allUserTickets = deriveUserTicketsView(rawUserTickets, filterType);
      const pageData = allUserTickets.slice(startIdx, startIdx + limit);
      const hasMore = startIdx + limit < allUserTickets.length;

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

    // Department filter by role scope + optional admin filter
    const deptFilter = req.query.departmentId;
    if (userRole === 'admin' && deptFilter) {
      endpoint += `&departmentId=${deptFilter}`;
    } else if (allowedDeptIds.length === 1) {
      endpoint += `&departmentId=${allowedDeptIds[0]}`;
    } else if (deptFilter) {
      // non-admin roles cannot override their scoped department access
    }

    const baseEndpoint = endpoint;
    const searchEndpoint = search
      ? `${endpoint}&searchText=${encodeURIComponent(search)}`
      : endpoint;

    // Preserve the fallback behavior for invalid search values while caching by final endpoint.
    let effectiveEndpoint = searchEndpoint;
    if (search) {
      const probe = await zohoFetch(searchEndpoint);
      if (probe.status === 422) {
        effectiveEndpoint = baseEndpoint;
      }
    }

    const cacheKey = `${userRole}|${effectiveEndpoint}`;
    const cached = standardTicketsCache.get(cacheKey);
    const age = cached ? Date.now() - cached.time : Infinity;

    let payload;
    if (cached && age < STANDARD_TICKETS_CACHE_MS) {
      payload = cached.payload;
      res.set('X-ITSM-Tickets-Cache', 'HIT');
    } else if (cached && age < STANDARD_TICKETS_STALE_MS) {
      payload = cached.payload;
      res.set('X-ITSM-Tickets-Cache', 'STALE');
      refreshStandardTicketsCache(cacheKey, effectiveEndpoint, limit, allowedDeptIds).catch(err =>
        console.error(`Background standard tickets refresh failed for ${cacheKey}:`, err?.message || err)
      );
    } else {
      try {
        payload = await refreshStandardTicketsCache(cacheKey, effectiveEndpoint, limit, allowedDeptIds);
        res.set('X-ITSM-Tickets-Cache', 'MISS');
      } catch (refreshErr) {
        const message = refreshErr?.message || 'Unknown error';
        console.error('Standard tickets refresh error:', message);
        return res.status(502).json({
          error: 'Failed to fetch tickets from Zoho',
          details: message
        });
      }
    }

    res.json({
      page,
      limit,
      count: payload.count,
      hasMore: payload.hasMore,
      data: payload.data
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
    const data = await response.json();

    if (!isUnrestrictedTicketRole(req.user?.role)) {
      const requestingEmail = (req.user?.email || '').toString().trim().toLowerCase();
      let assignedUsers = [];
      try {
        const a = await pool.query('SELECT assigned_users FROM ticket_assignments WHERE zoho_ticket_id = $1', [req.params.id]);
        assignedUsers = a.rows?.[0]?.assigned_users || [];
      } catch (e) {
        console.warn('[Ticket access check] assignment lookup failed:', e?.message);
      }
      if (!ticketOwnerEmails(data, assignedUsers).includes(requestingEmail)) {
        return res.status(403).json({ error: 'You do not have access to this ticket' });
      }
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

app.patch('/api/tickets/:id', authenticateToken, async (req, res) => {
  try {
    if (!(await userCanAccessTicket(req.user, req.params.id))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }

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

    // If Zoho rejects status with 422, try common alternate spellings/casing
    if (!response.ok && response.status === 422 && payload.status) {
      const alternates = {
        'in progress': ['In-Progress', 'InProgress', 'in progress', 'In progress'],
        'open': ['Open'],
        'closed': ['Closed', 'Resolved'],
        'resolved': ['Resolved', 'Closed'],
        'on hold': ['On Hold', 'On-Hold']
      };
      const key = (payload.status || '').toLowerCase();
      const variants = alternates[key] || [];
      for (const v of variants) {
        if (v === payload.status) continue;
        const retry = await zohoFetch(`/tickets/${req.params.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...payload, status: v })
        });
        if (retry.ok) {
          const retryData = await retry.json().catch(() => null);
          invalidateRuntimeCaches();
          return res.json(retryData || { status: 'ok' });
        }
      }
      return res.status(response.status).json(data || { error: 'Failed to update ticket' });
    }

    if (!response.ok) {
      return res.status(response.status).json(data || { error: 'Failed to update ticket' });
    }

    // Invalidate counts caches on ticket update (status changes affect counts)
    invalidateRuntimeCaches();

    return res.json(data || { status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticket', details: err?.message || String(err) });
  }
});

// ── Zoho ticket statuses (dynamic, cached 10 min) ──
let _zohoStatusesCache = null;
let _zohoStatusesCacheTime = 0;
const ZOHO_STATUSES_CACHE_MS = 10 * 60 * 1000;
app.get('/api/zoho/statuses', authenticateToken, async (req, res) => {
  if (_zohoStatusesCache && Date.now() - _zohoStatusesCacheTime < ZOHO_STATUSES_CACHE_MS) {
    return res.json(_zohoStatusesCache);
  }
  try {
    const r = await zohoFetch('/fields?module=tickets');
    if (r.ok) {
      const body = await r.json();
      const fields = body?.fields || body?.data || [];
      const statusField = fields.find(f =>
        (f.fieldName || f.apiName || '').toLowerCase() === 'status' ||
        (f.displayLabel || f.label || '').toLowerCase() === 'status'
      );
      if (statusField?.allowedValues?.length) {
        const statuses = statusField.allowedValues.map(v => v.displayValue || v.value || v).filter(Boolean);
        _zohoStatusesCache = statuses;
        _zohoStatusesCacheTime = Date.now();
        return res.json(statuses);
      }
    }
  } catch {}
  // Fallback defaults
  const defaults = ['Open', 'In Progress', 'On Hold', 'Escalated', 'Closed'];
  _zohoStatusesCache = defaults;
  _zohoStatusesCacheTime = Date.now();
  return res.json(defaults);
});

// ── Zoho Departments endpoint (cached 10 min) ──
let _zohoDepartmentsCache = null;
let _zohoDepartmentsCacheTime = 0;
app.get('/api/zoho/departments', authenticateToken, async (req, res) => {
  if (_zohoDepartmentsCache && Date.now() - _zohoDepartmentsCacheTime < 600000) {
    return res.json(_zohoDepartmentsCache);
  }
  try {
    const r = await zohoFetch('/departments');
    if (r.ok) {
      const body = await r.json();
      const depts = (body?.data || []).map(d => ({ id: d.id, name: d.name }));
      _zohoDepartmentsCache = depts;
      _zohoDepartmentsCacheTime = Date.now();
      return res.json(depts);
    }
  } catch {}
  _zohoDepartmentsCache = [];
  _zohoDepartmentsCacheTime = Date.now();
  return res.json([]);
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

    // ── Ticket access check (also drives private-note visibility below) ──
    // Resolved up front, before enrichment, so a caller with no relationship to this
    // ticket at all is rejected immediately instead of seeing its public conversations.
    const requestingEmail = (req.user?.email || '').toLowerCase();
    const isUnrestricted = isUnrestrictedTicketRole(req.user?.role);
    let hasTicketRelationship = false;
    if (!isUnrestricted) {
      try {
        const [ticketFetch, assignmentFetch] = await Promise.allSettled([
          zohoFetch(`/tickets/${req.params.id}?include=contacts,assignee`).then(r => r.ok ? r.json() : {}),
          pool.query('SELECT assigned_users FROM ticket_assignments WHERE zoho_ticket_id = $1', [req.params.id])
        ]);
        const ticketData = ticketFetch.status === 'fulfilled' ? ticketFetch.value : {};
        const assignedUsers = assignmentFetch.status === 'fulfilled' ? (assignmentFetch.value?.rows?.[0]?.assigned_users || []) : [];
        hasTicketRelationship = ticketOwnerEmails(ticketData, assignedUsers).includes(requestingEmail);
      } catch (e) {
        console.warn('[Ticket access check] conversations lookup failed:', e?.message);
      }
      if (!hasTicketRelationship) {
        return res.status(403).json({ error: 'You do not have access to this ticket' });
      }
    }
    const canSeePrivate = isUnrestricted || hasTicketRelationship;

    // Enrich every conversation entry with detailed comment/thread payload.
    // Some older email records only expose a truncated description on the list endpoint,
    // so enriching just the recent items causes the first part to be clipped.
    const CONV_ENRICH_BATCH = 5;
    const enrichOne = async (conv) => {
      try {
        const convType = (conv.type || '').toLowerCase();
        const detailEndpoint = convType === 'comment'
          ? `/tickets/${req.params.id}/comments/${conv.id}`
          : `/tickets/${req.params.id}/threads/${conv.id}`;

        const detailRes = await zohoFetch(detailEndpoint);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          const detailData = detail?.data || detail;
          return { ...conv, ...detailData };
        }

        const fallbackEndpoint = convType === 'comment'
          ? `/tickets/${req.params.id}/threads/${conv.id}`
          : `/tickets/${req.params.id}/comments/${conv.id}`;
        const fallbackRes = await zohoFetch(fallbackEndpoint);
        if (fallbackRes.ok) {
          const fallback = await fallbackRes.json();
          const fallbackData = fallback?.data || fallback;
          return { ...conv, ...fallbackData };
        }
      } catch {
        // ignore enrichment errors, fall back to original
      }
      return conv;
    };

    const allConvs = data.data || [];
    const enrichedConvs = [];
    for (let i = 0; i < allConvs.length; i += CONV_ENRICH_BATCH) {
      const slice = allConvs.slice(i, i + CONV_ENRICH_BATCH);
      const enrichedSlice = await Promise.all(slice.map(enrichOne));
      enrichedConvs.push(...enrichedSlice);
    }

    const resultData = enrichedConvs;

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

    const visibleData = canSeePrivate
      ? resultData
      : resultData.filter(conv => conv.isPublic !== false);

    res.json({ ...data, data: visibleData });
  } catch {
    res.status(500).json({ error: 'Failed to fetch ticket conversations' });
  }
});

app.get('/api/tickets/:id/attachments',  authenticateToken,async (req, res) => {
  try {
    if (!(await userCanAccessTicket(req.user, req.params.id))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }
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
    if (!(await userCanAccessTicket(req.user, id))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }
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

app.post('/api/tickets/:id/attachments', authenticateToken, upload.array('attachments'), async (req, res) => {
  try {
    if (!(await userCanAccessTicket(req.user, req.params.id))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }
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

app.post("/api/msal-login", authRateLimiter, async (req, res) => {
  try {
    const { email, accessToken } = req.body;

    if (!email || !accessToken) {
      return res.status(400).json({ message: "Missing data" });
    }

    const normalize = (v) => (v || '').toString().trim().toLowerCase();
    const normalizedEmail = normalize(email);
    const requestedRole = normalize(req.body?.selectedRole || '');
    const rolesSet = new Set();
    let roleSource = 'default';

    // Verify accessToken is a real, currently-valid Microsoft token for this exact
    // email before trusting anything else in this request (admin allowlist, roles,
    // etc.). Without this, the group-membership lookup below fails silently on an
    // invalid/garbage token (it just continues with zero groups), which previously
    // let anyone claim an arbitrary `email` — including an allowlisted admin's —
    // with no real Microsoft credentials at all.
    try {
      const meResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!meResponse.ok) {
        console.warn(`[MSAL LOGIN] Access token verification failed for ${normalizedEmail}: ${meResponse.status}`);
        return res.status(401).json({ message: "Invalid or expired access token" });
      }
      const me = await meResponse.json();
      // The frontend sends MSAL's `account.username` (the preferred_username/UPN claim),
      // which doesn't always equal Graph's `mail` attribute in every tenant, so accept
      // either verified field rather than requiring a specific one to match.
      const verifiedMail = normalize(me?.mail);
      const verifiedUpn = normalize(me?.userPrincipalName);
      const identityVerified = (!!verifiedMail && verifiedMail === normalizedEmail)
        || (!!verifiedUpn && verifiedUpn === normalizedEmail);
      if (!identityVerified) {
        console.warn(`[MSAL LOGIN] Claimed email ${normalizedEmail} does not match token identity (mail=${verifiedMail || '(none)'}, upn=${verifiedUpn || '(none)'})`);
        return res.status(401).json({ message: "Access token does not match the provided email" });
      }
    } catch (verifyErr) {
      console.warn(`[MSAL LOGIN] Access token verification error for ${normalizedEmail}:`, verifyErr?.message || verifyErr);
      return res.status(401).json({ message: "Invalid or expired access token" });
    }

    if (isAllowlistedAdminEmail(normalizedEmail)) {
      rolesSet.add('admin');
      roleSource = 'admin-email-allowlist';
    }

    const graphGroups = [];
    try {
      let url = 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=mail,displayName,mailNickname';

      while (url) {
        const graphResponse = await fetch(url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (!graphResponse.ok) {
          console.warn(`[MSAL LOGIN] Graph API check failed for ${normalizedEmail}: ${graphResponse.status}`);
          break;
        }

        const data = await graphResponse.json();
        const groups = Array.isArray(data?.value) ? data.value : [];
        graphGroups.push(...groups);
        url = data['@odata.nextLink'] || '';
      }
    } catch (graphErr) {
      console.warn(`[MSAL LOGIN] Graph API error for ${normalizedEmail}:`, graphErr?.message || graphErr);
    }

    for (const roleFromGroup of rolesFromGraphGroups(graphGroups)) {
      rolesSet.add(roleFromGroup);
    }
    if (graphGroups.length > 0 && roleSource === 'default') {
      roleSource = 'graph-groups';
    }

    try {
      const identifiers = [...new Set(
        graphGroups.flatMap(g => [g?.mail, g?.displayName, g?.mailNickname])
          .map(v => normalize(v))
          .filter(Boolean)
      )];

      if (identifiers.length > 0) {
        const groupBindings = await pool.query(
          `SELECT group_identifier, roles
           FROM group_role_bindings
           WHERE LOWER(group_identifier) = ANY($1)`,
          [identifiers]
        );
        for (const row of groupBindings.rows || []) {
          for (const role of normalizeRoleList(row.roles || [])) {
            rolesSet.add(role);
          }
        }
        if ((groupBindings.rows || []).length > 0) {
          roleSource = 'group_role_bindings-db';
        }
      }
    } catch (groupErr) {
      console.warn(`[MSAL LOGIN] group role bindings check failed for ${normalizedEmail}:`, groupErr?.message || groupErr);
    }

    // Legacy single-role override table (kept for backward compatibility)
    try {
      const roleResult = await pool.query(
        `SELECT role FROM user_roles WHERE LOWER(microsoft_email) = $1 LIMIT 1`,
        [normalizedEmail]
      );
      if (roleResult.rows.length > 0) {
        const legacyRole = normalizeRole(roleResult.rows[0]?.role);
        if (legacyRole) {
          rolesSet.add(legacyRole);
          roleSource = 'user_roles-db';
        }
      }
    } catch (dbErr) {
      console.warn(`[MSAL LOGIN] DB role check failed for ${normalizedEmail}:`, dbErr?.message || dbErr);
    }

    // Multi-role bindings table
    try {
      const bindingResult = await pool.query(
        `SELECT roles FROM user_role_bindings WHERE LOWER(microsoft_email) = $1 LIMIT 1`,
        [normalizedEmail]
      );
      if (bindingResult.rows.length > 0) {
        const dbRoles = normalizeRoleList(bindingResult.rows[0]?.roles || []);
        for (const r of dbRoles) rolesSet.add(r);
        roleSource = 'user_role_bindings-db';
      }
    } catch (dbErr) {
      console.warn(`[MSAL LOGIN] role bindings check failed for ${normalizedEmail}:`, dbErr?.message || dbErr);
    }

    const roles = normalizeRoleList([...rolesSet], null);

    // Check if user is a member of cloudops group
    const cloudopsGroupIdentifiers = ROLE_GROUP_MAP['cloudops'] || [];
    const isCloudOpsMember = graphGroups.some(g => {
      const values = [g?.mail, g?.displayName, g?.mailNickname]
        .map(v => (v || '').toString().trim().toLowerCase())
        .filter(Boolean);
      return values.some(v => cloudopsGroupIdentifiers.includes(v));
    });

    // If user is NOT in cloudops group, force role to 'user' regardless of DB assignment
    let effectiveRoles = roles;
    let effectiveRole;
    if (!isCloudOpsMember && !isAllowlistedAdminEmail(normalizedEmail)) {
      effectiveRoles = ['user'];
      effectiveRole = 'user';
      console.log(`[MSAL LOGIN] ${normalizedEmail} NOT in cloudops group - forcing role=user`);
    } else {
      effectiveRole = pickDefaultRole(roles, requestedRole, null);
    }

    console.log(`[MSAL LOGIN] ${normalizedEmail} resolved role=${effectiveRole} roles=[${effectiveRoles.join(',')}] isCloudOps=${isCloudOpsMember} via ${roleSource}`);

    const newAccessToken = jwt.sign(
      { email: normalizedEmail, role: effectiveRole, roles: effectiveRoles, isCloudOps: isCloudOpsMember },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const refreshToken = jwt.sign(
      { email: normalizedEmail, role: effectiveRole, roles: effectiveRoles, isCloudOps: isCloudOpsMember },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // Start warming the My Tickets cache now so it's ready before the user navigates there.
    prewarmUserTickets(normalizedEmail, effectiveRole);

    res.json({ accessToken: newAccessToken, refreshToken, role: effectiveRole, roles: effectiveRoles, isCloudOps: isCloudOpsMember });

  } catch (err) {
    console.error('MSAL login error:', err?.message);
    res.status(500).json({ error: "MSAL login failed" });
  }
});


app.post('/api/tickets/:id/reply', authenticateToken, upload.array('attachments'), async (req, res) => {
  try {
    if (!(await userCanAccessTicket(req.user, req.params.id))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }
    const files = Array.isArray(req.files) ? req.files : [];
    const content = req.body?.content || '';
    const senderName = req.body?.senderName || req.user?.email?.split('@')[0] || '';
    const senderEmail = req.user?.email || '';
    const isPublicStr = req.body?.isPublic === 'true' ? 'true' : 'false';
    const isPublicBool = req.body?.isPublic === 'true';

    // Zoho Desk: public replies → /sendReply (JSON preferred), private notes → /comments
    // Try JSON first (Zoho Desk v1 documented approach), fall back to form-data.
    const attempts = isPublicBool ? [
      { type: 'json', path: `/tickets/${req.params.id}/sendReply`, includeContentType: true },
      { type: 'json', path: `/tickets/${req.params.id}/sendReply`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/reply`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
      { type: 'form', path: `/tickets/${req.params.id}/sendReply`, includeContentType: true },
      { type: 'form', path: `/tickets/${req.params.id}/sendReply`, includeContentType: false },
      { type: 'form', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
    ] : [
      { type: 'json', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
      { type: 'json', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
      { type: 'form', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
      { type: 'form', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
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

app.post('/api/tickets', authenticateToken, upload.array('attachments'), async (req, res) => {
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
    if (!payload.departmentId && ZOHO_DEPARTMENT_ID) {
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

    const allowedRoles = SUPPORTED_ROLES.filter(r => r !== 'user');
    const normalizedRole = normalizeRole(role);
    if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role", allowed: allowedRoles });
    }

    await pool.query(
      "UPDATE users SET role = $1 WHERE id = $2",
      [normalizedRole, req.params.id]
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
// IHUB CERTIFICATE API
// -------------------------------------------------------

app.get('/api/ihub-certificate', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        a.*,
        (a.license_expiry::date - CURRENT_DATE) AS days_to_expiry
       FROM ihub_certificate_assets a
       ORDER BY a.license_expiry ASC, a.client ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch IHUB Certificate assets:', err);
    res.status(500).json({ message: 'Failed to fetch IHUB Certificate assets' });
  }
});

app.post('/api/ihub-certificate', authenticateToken, authorizeAdmin, async (req, res) => {
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
      return res.status(400).json({ message: 'Missing required IHUB Certificate fields' });
    }

    if (!isValidDateInput(license_expiry)) {
      return res.status(400).json({ message: 'Invalid license expiry date' });
    }

    const result = await pool.query(
      `INSERT INTO ihub_certificate_assets
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

    await processIhubCertificateAlerts();
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to create IHUB Certificate asset:', err);
    res.status(500).json({ message: 'Failed to create IHUB Certificate asset' });
  }
});

app.put('/api/ihub-certificate/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assetId)) {
      return res.status(400).json({ message: 'Invalid IHUB Certificate asset id' });
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
      return res.status(400).json({ message: 'Missing required IHUB Certificate fields' });
    }

    if (!isValidDateInput(license_expiry)) {
      return res.status(400).json({ message: 'Invalid license expiry date' });
    }

    const result = await pool.query(
      `UPDATE ihub_certificate_assets SET
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
      return res.status(404).json({ message: 'IHUB Certificate asset not found' });
    }

    await pool.query(
      `UPDATE ihub_certificate_alert_tickets
       SET status = 'Superseded', closed_at = NOW()
       WHERE ihub_certificate_asset_id = $1 AND status = 'Open'`,
      [assetId]
    );

    await processIhubCertificateAlerts();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update IHUB Certificate asset:', err);
    res.status(500).json({ message: 'Failed to update IHUB Certificate asset' });
  }
});

app.delete('/api/ihub-certificate/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const assetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(assetId)) {
      return res.status(400).json({ message: 'Invalid IHUB Certificate asset id' });
    }

    const existingAsset = await pool.query(
      'SELECT id FROM ihub_certificate_assets WHERE id = $1 LIMIT 1',
      [assetId]
    );

    if (existingAsset.rows.length === 0) {
      return res.status(404).json({ message: 'IHUB Certificate asset not found' });
    }

    const alertTicketIdsResult = await pool.query(
      `SELECT zoho_ticket_id
       FROM ihub_certificate_alert_tickets
       WHERE ihub_certificate_asset_id = $1`,
      [assetId]
    );
    const alertTicketIds = alertTicketIdsResult.rows
      .map(r => r.zoho_ticket_id)
      .filter(Boolean);

    await pool.query('DELETE FROM ihub_certificate_assets WHERE id = $1', [assetId]);

    if (alertTicketIds.length > 0) {
      await pool.query(
        `UPDATE ticket_assignments
         SET status = 'Closed',
             closed_at = NOW(),
             closed_by = $1,
             updated_at = NOW()
         WHERE zoho_ticket_id = ANY($2::text[])
           AND category = 'IHUB_CERTIFICATE'`,
        [(req.user?.email || '').toLowerCase() || null, alertTicketIds]
      );
    }

    res.json({ message: 'IHUB Certificate asset deleted successfully' });
  } catch (err) {
    console.error('Failed to delete IHUB Certificate asset:', err);
    res.status(500).json({ message: 'Failed to delete IHUB Certificate asset' });
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

app.get('/api/automation-ssl', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const statusFilter = (req.query.status || '').toString().trim().toLowerCase();
    const status = statusFilter && statusFilter !== 'all' ? statusFilter : null;

    const result = await pool.query(
      `SELECT
        a.id,
        a.alertname,
        a.milestone_days,
        a.client,
        a.environment,
        a.application,
        a.instance AS ssl_url,
        a.responsible,
        a.responsible_email,
        a.zoho_ticket_id,
        a.zoho_ticket_number,
        a.status,
        a.created_at,
        a.updated_at,
        a.closed_at,
        (a.created_at::date + make_interval(days => a.milestone_days))::date AS estimated_expiry_on,
        ((a.created_at::date + make_interval(days => a.milestone_days))::date - CURRENT_DATE) AS estimated_days_to_expiry
       FROM alertmanager_ssl_tickets a
       WHERE ($1::text IS NULL OR LOWER(a.status) = $1)
       ORDER BY estimated_days_to_expiry ASC NULLS LAST, a.created_at DESC`,
      [status]
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch automation SSL entries:', err);
    return res.status(500).json({ message: 'Failed to fetch automation SSL entries' });
  }
});

app.get('/api/automation-ssl/monitored-urls', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const monitoredRows = await fetchAutomationSslMonitoredUrls();
    return res.json(monitoredRows);
  } catch (err) {
    if (err?.message === 'AUTOMATION_PROMETHEUS_URL is not configured') {
      return res.status(400).json({ message: err.message });
    }
    if (err?.message === 'Failed to fetch SSL expiry metrics from Prometheus') {
      return res.status(502).json({ message: err.message });
    }
    console.error('Failed to fetch monitored automation SSL URLs:', err);
    return res.status(500).json({ message: 'Failed to fetch monitored automation SSL URLs' });
  }
});

app.post('/api/automation-ssl/process-now', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await processAutomationSslAlerts();
    return res.json({
      message: 'Automation SSL processing completed',
      ...result
    });
  } catch (err) {
    console.error('Failed to process Automation SSL alerts:', err);
    return res.status(500).json({ message: 'Failed to process Automation SSL alerts' });
  }
});

app.get('/api/automation-ssl/diagnostics', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const diagnostics = global.lastAutomationSslDiagnostics || {
      message: 'No diagnostics available yet. Run /api/automation-ssl/monitored-urls first.'
    };
    return res.json(diagnostics);
  } catch (err) {
    console.error('Failed to fetch diagnostics:', err);
    return res.status(500).json({ message: 'Failed to fetch diagnostics' });
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

app.post('/api/ihub-certificate/run-expiry-check', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    await processIhubCertificateAlerts();
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

app.post('/api/ihub-certificate/tickets/:zohoTicketId/close', authenticateToken, async (req, res) => {
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

    if (!assignment || (assignment.category || '').toUpperCase() !== 'IHUB_CERTIFICATE') {
      return res.status(404).json({ message: 'IHUB Certificate ticket assignment not found' });
    }

    const assignedUsers = Array.isArray(assignment.assigned_users)
      ? assignment.assigned_users.map(u => (u || '').toLowerCase())
      : [];

    if (!isAdmin && !assignedUsers.includes(userEmail)) {
      return res.status(403).json({ message: 'Only responsible person or admin can close IHUB Certificate ticket' });
    }

    const alertResult = await pool.query(
      `SELECT * FROM ihub_certificate_alert_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
      [ticketId]
    );
    const alert = alertResult.rows[0];

    if (!alert) {
      return res.status(404).json({ message: 'IHUB Certificate alert record not found for this ticket' });
    }

    const closedInZoho = await closeZohoTicketWithFallback(ticketId);
    if (!closedInZoho) {
      return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
    }

    const normalizedDate = normalizeDateOnly(newExpiryDate);

    await pool.query(
      `UPDATE ihub_certificate_assets
       SET license_expiry = $1,
           updated_by = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [normalizedDate, userEmail || null, alert.ihub_certificate_asset_id]
    );

    await pool.query(
      `UPDATE ihub_certificate_alert_tickets
       SET status = 'Closed', closed_at = NOW()
       WHERE zoho_ticket_id = $1`,
      [ticketId]
    );

    await pool.query(
      `UPDATE ihub_certificate_alert_tickets
       SET status = 'Superseded', closed_at = NOW()
       WHERE ihub_certificate_asset_id = $1 AND status = 'Open'`,
      [alert.ihub_certificate_asset_id]
    );

    await pool.query(
      `UPDATE ticket_assignments
       SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
       WHERE zoho_ticket_id = $2`,
      [userEmail || null, ticketId]
    );

    await processIhubCertificateAlerts();

    return res.json({
      message: 'IHUB Certificate ticket closed and license expiry updated',
      license_expiry: normalizedDate
    });
  } catch (err) {
    console.error('Failed to close IHUB Certificate ticket:', err);
    return res.status(500).json({ message: 'Failed to close IHUB Certificate ticket' });
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

    markPortalAssignment(zoho_ticket_id);
    notifyCloudOpsTeamsOnAssignment({
      zohoTicketId: zoho_ticket_id,
      zohoTicketNumber: zoho_ticket_number,
      zohoDepartmentId: zoho_department_id,
      assignedUsers: normalizedUsers,
      assignedBy: assigned_by,
      category
    }).catch(() => {});

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
    const { zoho_ticket_id, new_assigned_users, reassigned_by, category } = req.body;

    if (!zoho_ticket_id || !new_assigned_users || new_assigned_users.length === 0 || !reassigned_by) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const new_primary = new_assigned_users[0].toLowerCase();
    const normalizedUsers = new_assigned_users.map(u => u.toLowerCase());
    const normalizedCategory = (category || '').trim() || null;

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
         category = COALESCE($5, category),
         updated_at = NOW()
       WHERE zoho_ticket_id = $6
       RETURNING *`,
      [normalizedUsers, new_primary, old_primary, reassigned_by.toLowerCase(), normalizedCategory, zoho_ticket_id]
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

    // This PATCH can trigger the Zoho-side workflow rule that calls our
    // ticket-assigned webhook — mark it so that handler treats it as an echo
    // of our own action rather than a fresh Zoho-side assignment.
    markPortalAssignment(zoho_ticket_id);

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
    const { ticket_ids, assigned_users, assigned_by, ticket_categories, ticket_department_ids } = req.body;

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
        const departmentId = ticket_department_ids?.[ticketId] || null;
        // Insert/update assignment
        await pool.query(
          `INSERT INTO ticket_assignments
            (zoho_ticket_id, assigned_users, primary_assignee, assigned_by, status, category, zoho_department_id)
           VALUES ($1, $2, $3, $4, 'Open', $5, $6)
           ON CONFLICT (zoho_ticket_id) DO UPDATE SET
             assigned_users = EXCLUDED.assigned_users,
             primary_assignee = EXCLUDED.primary_assignee,
             reassigned_user = ticket_assignments.primary_assignee,
             reassigned_at = NOW(),
             reassigned_by = EXCLUDED.assigned_by,
             category = COALESCE(EXCLUDED.category, ticket_assignments.category),
             zoho_department_id = COALESCE(EXCLUDED.zoho_department_id, ticket_assignments.zoho_department_id),
             updated_at = NOW()`,
          [ticketId, [primaryAssignee], primaryAssignee, assigned_by.toLowerCase(), category, departmentId]
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

        markPortalAssignment(ticketId);
        notifyCloudOpsTeamsOnAssignment({
          zohoTicketId: ticketId,
          zohoDepartmentId: departmentId,
          assignedUsers: [primaryAssignee],
          assignedBy: assigned_by,
          category,
          isBulk: true
        }).catch(() => {});

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
app.get("/api/admin/group-members", authenticateToken, authorizeElevated, async (req, res) => {
  try {
    const groupEmail = (req.query.groupEmail || '').toString().trim().toLowerCase();
    if (!groupEmail) {
      return res.status(400).json({ message: "Missing groupEmail" });
    }
    // Escape single quotes per OData string-literal syntax so groupEmail can't break
    // out of the $filter expression below.
    const odataGroupEmail = groupEmail.replace(/'/g, "''");

    const token = getGraphToken(req);
    if (!token) {
      return res.status(401).json({ message: "Missing access token" });
    }

    const groupLookupUrl =
      `https://graph.microsoft.com/v1.0/groups?$filter=mail eq '${odataGroupEmail}'&$select=id,displayName,mail`;

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
        `https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${odataGroupEmail}'&$select=id,displayName,mail`;
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

app.get('/api/admin/group-roles', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, group_identifier, roles, assigned_by, assigned_at, updated_at, notes
       FROM group_role_bindings
       ORDER BY updated_at DESC`
    );
    return res.json({ groups: result.rows, count: result.rows.length });
  } catch (err) {
    console.error('Failed to fetch group roles:', err?.message || err);
    return res.status(500).json({ error: 'Failed to fetch group roles' });
  }
});

app.post('/api/admin/group-roles', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const groupIdentifier = (req.body?.groupIdentifier || '').toString().trim().toLowerCase();
    const roles = normalizeRoleList(req.body?.roles || []);
    const notes = (req.body?.notes || '').toString().trim() || null;
    const adminEmail = (req.user?.email || '').toLowerCase();

    if (!groupIdentifier) {
      return res.status(400).json({ error: 'groupIdentifier is required' });
    }

    const result = await pool.query(
      `INSERT INTO group_role_bindings (group_identifier, roles, assigned_by, notes, assigned_at, updated_at)
       VALUES ($1, $2::text[], $3, $4, NOW(), NOW())
       ON CONFLICT (group_identifier)
       DO UPDATE SET
         roles = EXCLUDED.roles,
         assigned_by = EXCLUDED.assigned_by,
         notes = EXCLUDED.notes,
         updated_at = NOW()
       RETURNING id, group_identifier, roles, assigned_by, assigned_at, updated_at, notes`,
      [groupIdentifier, roles, adminEmail, notes]
    );

    return res.json({ success: true, group: result.rows[0] });
  } catch (err) {
    console.error('Failed to upsert group roles:', err?.message || err);
    return res.status(500).json({ error: 'Failed to upsert group roles' });
  }
});

app.delete('/api/admin/group-roles/:groupIdentifier', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const groupIdentifier = (req.params.groupIdentifier || '').toString().trim().toLowerCase();
    const result = await pool.query(
      `DELETE FROM group_role_bindings WHERE LOWER(group_identifier) = $1 RETURNING group_identifier, roles`,
      [groupIdentifier]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Group role assignment not found' });
    }
    return res.json({ success: true, group: result.rows[0] });
  } catch (err) {
    console.error('Failed to delete group roles:', err?.message || err);
    return res.status(500).json({ error: 'Failed to delete group roles' });
  }
});

// Admin: assignments report (for cloudops group members)
app.get("/api/admin/assignments-report", authenticateToken, authorizeElevated, async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const requestedDeptId = (req.query.departmentId || '').toString().trim();
    const allowedDeptIds = getAllowedDepartmentIdsForRole(userRole); // [] for admin means "all"

    let query, params;
    if (userRole === 'admin') {
      if (requestedDeptId) {
        query = 'SELECT * FROM ticket_assignments WHERE zoho_department_id = $1 ORDER BY assigned_at DESC';
        params = [requestedDeptId];
      } else {
        query = 'SELECT * FROM ticket_assignments ORDER BY assigned_at DESC';
        params = [];
      }
    } else if (allowedDeptIds.length > 0) {
      query = 'SELECT * FROM ticket_assignments WHERE zoho_department_id = ANY($1) ORDER BY assigned_at DESC';
      params = [allowedDeptIds];
    } else {
      query = 'SELECT * FROM ticket_assignments ORDER BY assigned_at DESC';
      params = [];
    }

    const result = await pool.query(query, params);
    res.json({ assignments: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch assignments report" });
  }
});

// Admin/elevated: live Zoho ticket report source (assignment-shaped payload)
app.get('/api/admin/tickets-report', authenticateToken, authorizeElevated, async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase();
    const requestedDeptId = (req.query.departmentId || '').toString().trim();
    const isAdmin = userRole === 'admin';

    let allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);
    if (isAdmin && requestedDeptId) {
      allowedDeptIds = [requestedDeptId];
    }

    const hasSingleDept = Array.isArray(allowedDeptIds) && allowedDeptIds.length === 1;
    const deptQuery = hasSingleDept ? `&departmentId=${encodeURIComponent(allowedDeptIds[0])}` : '';
    const include = 'contacts,assignee';
    const pageSize = 100;
    const maxFrom = 10000;
    const statuses = ['Open', 'In Progress', 'On Hold', 'Escalated', 'Closed', 'Resolved'];

    const recycledTicketIds = await getActiveRecycledTicketIds();
    const seen = new Set();
    const normalizedRows = [];

    const toCategory = (ticket) => {
      const direct = [
        ticket?.category,
        ticket?.ticketCategory,
        ticket?.issueCategory,
        ticket?.subCategory,
        ticket?.subcategory
      ];
      for (const candidate of direct) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
      return extractCategoryFromZohoTicket(ticket) || 'Uncategorized';
    };

    for (const status of statuses) {
      for (let from = 0; from <= maxFrom; from += pageSize) {
        const endpoint = `/tickets?limit=${pageSize}&from=${from}&status=${encodeURIComponent(status)}&include=${include}${deptQuery}`;
        let response;
        try {
          response = await zohoFetch(endpoint);
        } catch (err) {
          console.error(`[tickets-report] fetch failed for status=${status}, from=${from}:`, err?.message || err);
          break;
        }

        if (!response.ok) {
          // Treat status-specific failures as partial and continue with others.
          console.warn(`[tickets-report] Zoho returned ${response.status} for status=${status}, from=${from}`);
          break;
        }

        let data;
        try {
          data = await response.json();
        } catch {
          break;
        }

        const tickets = Array.isArray(data?.data) ? data.data : [];
        for (const t of tickets) {
          const tid = (t?.id || '').toString();
          if (!tid || seen.has(tid) || recycledTicketIds.has(tid)) continue;
          if (!isDepartmentAllowed(t, allowedDeptIds)) continue;

          seen.add(tid);

          const assigneeEmail = (
            t?.assignee?.email ||
            t?.assignee?.emailId ||
            t?.assignedTo ||
            ''
          ).toString().trim().toLowerCase();

          const assignedUsers = assigneeEmail ? [assigneeEmail] : [];
          const createdTime = (
            t?.createdTime ||
            t?.createdAt ||
            t?.created_at ||
            t?.createdDate ||
            ''
          ).toString();

          const ticketStatus = (t?.status || '').toString();
          const lowerStatus = ticketStatus.toLowerCase();
          const modifiedTime = (
            t?.modifiedTime ||
            t?.updatedTime ||
            t?.updated_at ||
            ''
          ).toString();

          const closedAt = (lowerStatus.includes('closed') || lowerStatus.includes('resolved'))
            ? (t?.closedTime || modifiedTime || '')
            : '';

          normalizedRows.push({
            zoho_ticket_id: tid,
            zoho_ticket_number: (t?.ticketNumber || t?.ticket_number || '').toString(),
            assigned_users: assignedUsers,
            primary_assignee: assigneeEmail,
            assigned_by: (
              t?.email ||
              t?.contact?.email ||
              t?.contact?.emailAddress ||
              t?.requester?.email ||
              ''
            ).toString().trim().toLowerCase(),
            assigned_at: createdTime,
            closed_at: closedAt,
            closed_by: assigneeEmail,
            zoho_department_id: extractTicketDepartmentId(t),
            category: toCategory(t),
            status: ticketStatus
          });
        }

        const more = data?.info?.moreRecords ?? (tickets.length >= pageSize);
        if (!more) break;
      }
    }

    res.json({ assignments: normalizedRows });
  } catch (err) {
    console.error('Tickets report error:', err?.message || err);
    res.status(500).json({ message: 'Failed to fetch tickets report' });
  }
});

function extractCategoryFromZohoTicket(rawTicket) {
  const ticket = rawTicket?.data || rawTicket || {};

  const readValue = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'object') {
      const candidate = value.name || value.displayName || value.label || value.value;
      return typeof candidate === 'string' ? candidate.trim() : '';
    }
    return '';
  };

  const directCandidates = [
    ticket.category,
    ticket.ticketCategory,
    ticket.issueCategory,
    ticket.subCategory,
    ticket.subcategory
  ];

  for (const candidate of directCandidates) {
    const val = readValue(candidate);
    if (val) return val;
  }

  const fieldContainers = [
    ticket.customFields,
    ticket.custom_fields,
    ticket.cf,
    ticket.fields
  ].filter(Boolean);

  for (const container of fieldContainers) {
    for (const [key, value] of Object.entries(container)) {
      if (!/category/i.test(key)) continue;
      const val = readValue(value);
      if (val) return val;
    }
  }

  return '';
}

// Admin: backfill categories AND department ids from Zoho for assignments that are
// missing either. Historically, ticket assignment (single + bulk) never recorded
// zoho_department_id, so department-scoped reports (e.g. the CloudOps dashboard)
// silently excluded those rows via `WHERE zoho_department_id = ANY(...)`. This
// shares one Zoho fetch per ticket to fix both fields without doubling API calls.
app.post("/api/admin/backfill-categories", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT zoho_ticket_id, category, zoho_department_id FROM ticket_assignments
       WHERE category IS NULL
          OR TRIM(category) = ''
          OR LOWER(TRIM(category)) IN ('uncategorized', 'uncategorised', 'uncategory')
          OR zoho_department_id IS NULL
          OR TRIM(zoho_department_id) = ''
       ORDER BY assigned_at DESC`
    );

    const rows = result.rows;
    let updated = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const ticketRes = await zohoFetch(`/tickets/${row.zoho_ticket_id}`);
        if (!ticketRes.ok) { failed++; continue; }
        const ticket = await ticketRes.json();

        const currentCategory = (row.category || '').trim();
        const needsCategory = !currentCategory
          || ['uncategorized', 'uncategorised', 'uncategory'].includes(currentCategory.toLowerCase());
        const category = needsCategory ? extractCategoryFromZohoTicket(ticket) : currentCategory;

        const needsDepartmentId = !(row.zoho_department_id || '').trim();
        const departmentId = needsDepartmentId ? extractTicketDepartmentId(ticket) : row.zoho_department_id;

        if (!category && !departmentId) { failed++; continue; }

        await pool.query(
          `UPDATE ticket_assignments SET
             category = COALESCE(NULLIF($1, ''), category),
             zoho_department_id = COALESCE(NULLIF($2, ''), zoho_department_id),
             updated_at = NOW()
           WHERE zoho_ticket_id = $3`,
          [category || '', departmentId || '', row.zoho_ticket_id]
        );
        updated++;
      } catch (innerErr) {
        failed++;
      }
    }

    res.json({ total: rows.length, updated, failed });
  } catch (err) {
    console.error("Backfill categories failed:", err);
    res.status(500).json({ message: "Backfill failed" });
  }
});

// -------------------------------------------------------
// ADMIN: USER ROLE MANAGEMENT API
// -------------------------------------------------------

// GET /api/admin/user-roles - List all stored user roles from database
app.get('/api/admin/user-roles', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const [bindingsRes, legacyRes] = await Promise.all([
      pool.query(
        `SELECT
           id,
           microsoft_email,
           roles,
           assigned_by,
           assigned_at,
           updated_at,
           notes
         FROM user_role_bindings
         ORDER BY updated_at DESC`
      ),
      pool.query(
        `SELECT microsoft_email, role, assigned_by, assigned_at, updated_at, notes
         FROM user_roles`
      )
    ]);

    const merged = new Map();
    for (const row of legacyRes.rows || []) {
      const email = (row.microsoft_email || '').toLowerCase();
      if (!email) continue;
      merged.set(email, {
        id: null,
        microsoft_email: email,
        roles: normalizeRoleList([row.role], null),
        role: normalizeRole(row.role) || null,
        assigned_by: row.assigned_by || null,
        assigned_at: row.assigned_at || null,
        updated_at: row.updated_at || null,
        notes: row.notes || null
      });
    }

    for (const row of bindingsRes.rows || []) {
      const email = (row.microsoft_email || '').toLowerCase();
      if (!email) continue;
      const roles = normalizeRoleList(row.roles || [], null);
      merged.set(email, {
        id: row.id,
        microsoft_email: email,
        roles,
        role: pickDefaultRole(roles, null, null),
        assigned_by: row.assigned_by || null,
        assigned_at: row.assigned_at || null,
        updated_at: row.updated_at || null,
        notes: row.notes || null
      });
    }

    const users = [...merged.values()].sort((a, b) =>
      new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    );

    return res.json({ users, count: users.length });
  } catch (err) {
    console.error('Failed to fetch user roles:', err?.message || err);
    return res.status(500).json({ error: 'Failed to fetch user roles' });
  }
});

// POST /api/admin/users/:email/role - Assign/update role for a user
app.post('/api/admin/users/:email/role', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { role: newRole, roles: incomingRoles, notes } = req.body;
    const userEmail = (req.params.email || '').toString().toLowerCase().trim();
    const adminEmail = (req.user?.email || '').toLowerCase();

    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required' });
    }

    const resolvedRoles = Array.isArray(incomingRoles)
      ? normalizeRoleList(incomingRoles, null)
      : normalizeRoleList([newRole], null);

    const invalidInputRoles = Array.isArray(incomingRoles)
      ? incomingRoles.filter(r => !normalizeRole(r))
      : (newRole && !normalizeRole(newRole) ? [newRole] : []);

    if (invalidInputRoles.length > 0) {
      return res.status(400).json({
        error: `Invalid roles: ${invalidInputRoles.join(', ')}`,
        allowed: SUPPORTED_ROLES
      });
    }

    const primaryRole = pickDefaultRole(resolvedRoles, null, null);

    if (!resolvedRoles.length || !primaryRole) {
      return res.status(400).json({
        error: 'At least one valid application role is required',
        allowed: SUPPORTED_ROLES.filter(role => role !== 'user')
      });
    }

    const [bindingResult, legacyResult] = await Promise.all([
      pool.query(
        `INSERT INTO user_role_bindings (microsoft_email, roles, assigned_by, notes, assigned_at, updated_at)
         VALUES ($1, $2::text[], $3, $4, NOW(), NOW())
         ON CONFLICT (microsoft_email)
         DO UPDATE SET
           roles = EXCLUDED.roles,
           assigned_by = EXCLUDED.assigned_by,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING id, microsoft_email, roles, assigned_by, assigned_at, updated_at, notes`,
        [userEmail, resolvedRoles, adminEmail, notes || null]
      ),
      // Keep legacy table in sync for backward compatibility.
      pool.query(
        `INSERT INTO user_roles (microsoft_email, role, assigned_by, notes, assigned_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (microsoft_email)
         DO UPDATE SET
           role = EXCLUDED.role,
           assigned_by = EXCLUDED.assigned_by,
           notes = EXCLUDED.notes,
           updated_at = NOW()
         RETURNING microsoft_email, role`,
        [userEmail, primaryRole, adminEmail, notes || null]
      )
    ]);

    console.log(`[ADMIN] Roles assigned: ${userEmail} → [${resolvedRoles.join(',')}] by ${adminEmail}`);

    return res.json({
      success: true,
      message: `Roles updated for ${userEmail}`,
      user: {
        ...bindingResult.rows[0],
        role: legacyResult.rows[0]?.role || primaryRole,
        roles: normalizeRoleList(bindingResult.rows[0]?.roles || resolvedRoles)
      }
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
      const [bindingRes, legacyRes] = await Promise.all([
        pool.query(
          `SELECT microsoft_email, roles, assigned_by, assigned_at, updated_at
           FROM user_role_bindings
           WHERE LOWER(microsoft_email) = ANY($1)`,
          [userEmails]
        ),
        pool.query(
          `SELECT microsoft_email, role, assigned_by, assigned_at, updated_at
           FROM user_roles
           WHERE LOWER(microsoft_email) = ANY($1)`,
          [userEmails]
        )
      ]);

      legacyRes.rows.forEach(row => {
        storedRoles.set((row.microsoft_email || '').toLowerCase(), {
          ...row,
          roles: normalizeRoleList([row.role], null)
        });
      });
      bindingRes.rows.forEach(row => {
        storedRoles.set((row.microsoft_email || '').toLowerCase(), {
          ...row,
          roles: normalizeRoleList(row.roles || [], null)
        });
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
        currentRole: pickDefaultRole(storedRole?.roles || [storedRole?.role], null, null),
        roles: normalizeRoleList(storedRole?.roles || [storedRole?.role], null),
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

    const [bindingDelete, legacyDelete] = await Promise.all([
      pool.query(
        `DELETE FROM user_role_bindings
         WHERE LOWER(microsoft_email) = $1
         RETURNING microsoft_email, roles`,
        [userEmail]
      ),
      pool.query(
        `DELETE FROM user_roles
         WHERE LOWER(microsoft_email) = $1
         RETURNING microsoft_email, role`,
        [userEmail]
      )
    ]);

    if (bindingDelete.rowCount === 0 && legacyDelete.rowCount === 0) {
      return res.status(404).json({ error: 'No role assignment found for this user' });
    }

    console.log(`[ADMIN] Role assignment deleted: ${userEmail} by ${adminEmail}`);

    return res.json({
      success: true,
      message: `Role assignment removed for ${userEmail}. User will revert to Graph group-based role.`,
      user: bindingDelete.rows[0] || legacyDelete.rows[0]
    });
  } catch (err) {
    console.error('Failed to delete role assignment:', err?.message || err);
    return res.status(500).json({ error: 'Failed to delete role assignment' });
  }
});

// Report / Suggestion email endpoint
app.post('/api/feedback/report', authenticateToken, async (req, res) => {
  try {
    const content = (req.body?.content || '').toString().trim();
    const includeName = Boolean(req.body?.includeName);
    const userEmail = (req.user?.email || '').toString().trim();

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const targetEmail = process.env.FEEDBACK_TARGET_EMAIL || 'sutharsan.t@muraai.com';
    const fromEmail = process.env.FEEDBACK_FROM_EMAIL || 'no-reply@muraai.com';
    const submitter = includeName && userEmail ? userEmail : 'Anonymous';
    const role = (req.user?.role || 'user').toString();
    const submittedAt = new Date().toISOString();

    const mailContent = [
      'New report/suggestion submitted from Influx web app.',
      '',
      `Submitted By: ${submitter}`,
      `User Role: ${role}`,
      `Submitted At: ${submittedAt}`,
      `Application: Influx ITSM`,
      '',
      'Content:',
      content
    ].join('\n');

    console.log(`[FEEDBACK] Report received from ${submitter}:\n${mailContent}\n`);

    // Send via Azure Graph API
    const emailSent = await sendEmailViaAzure(
      fromEmail,
      targetEmail,
      'Influx App - Report/Suggestion',
      mailContent,
      { email: userEmail, role }
    );

    return res.json({ 
      success: true, 
      message: emailSent 
        ? 'Feedback sent successfully' 
        : 'Feedback received (email delivery skipped due to configuration)'
    });
  } catch (error) {
    console.error('Feedback processing failed:', error?.message || error);
    return res.status(500).json({ error: 'Failed to process feedback' });
  }
});

const AZURE_BACKUP_TIME_ZONE = process.env.AZURE_BACKUP_TIME_ZONE || 'Asia/Kolkata';
const AZURE_BACKUP_DIR = path.join(__dirname, 'azure-monitoring');
let azureBackupJob = null;
let azureBackupLastAttempt = null;
let azureBackupLastSuccess = null;
let azureBackupLastError = '';
let azureBackupLastTrigger = '';
let azureBackupLastScheduledSlot = '';
let latestAzureBackupReport = null;

function latestAzureBackupFile(prefix, extension) {
  if (!fs.existsSync(AZURE_BACKUP_DIR)) return null;
  return fs.readdirSync(AZURE_BACKUP_DIR)
    .filter(name => name.startsWith(prefix) && name.toLowerCase().endsWith(extension))
    .map(name => ({ name, path: path.join(AZURE_BACKUP_DIR, name), mtime: fs.statSync(path.join(AZURE_BACKUP_DIR, name)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0] || null;
}

function readLatestAzureBackupReport() {
  return latestAzureBackupReport;
}

function normalizeAzureBackupType(item) {
  const backupType = String(item.BackupType || '').toLowerCase();
  const recoveryType = String(item.RecoveryType || '').toLowerCase();
  const resourceName = String(item.ResourceName || item.RawResourceName || '').toLowerCase();

  if (recoveryType === 'azurestorage' || resourceName.startsWith('azurefileshare;') || backupType.includes('file share')) {
    return 'File Share';
  }
  if (recoveryType === 'azureiaasvm' || resourceName.startsWith('vm;') || backupType.includes('vm')) {
    return 'Azure VM';
  }
  return item.BackupType || 'N/A';
}

function normalizeAzureResourceName(item, type) {
  const resourceName = String(item.ResourceName || 'N/A');
  const rawResourceName = String(item.RawResourceName || resourceName);

  if (type === 'Azure VM' && resourceName.toLowerCase().startsWith('vm;')) {
    return resourceName.split(';').filter(Boolean).pop() || resourceName;
  }
  if (type === 'File Share' && resourceName.toLowerCase().startsWith('azurefileshare;')) {
    return 'Azure File Share';
  }
  return resourceName || rawResourceName || 'N/A';
}

function normalizeAzureConsistency(item, type) {
  const consistency = String(item.ConsistencyType || '').trim();
  const lowered = consistency.toLowerCase();

  if (lowered.includes('application') || lowered === 'appconsistent') return 'Application Consistent';
  if (lowered.includes('crash') || lowered === 'crashconsistent') return 'Crash Consistent';
  if (lowered.includes('file') || lowered === 'filesystemconsistent') return 'File-System Consistent';
  if (type === 'File Share') return 'File-System Consistent';
  if (['passed', 'success', 'succeeded', 'healthy'].includes(lowered)) return 'N/A';
  return consistency || 'N/A';
}

function normalizeAzureRecoveryType(item, type) {
  const recoveryType = String(item.RecoveryType || '').trim();
  const lowered = recoveryType.toLowerCase();

  if (!recoveryType || lowered === 'n/a') return 'N/A';
  if (lowered.includes('snapshot') && lowered.includes('vault')) return 'Snapshot and Vault-Standard';
  if (lowered.includes('snapshot')) return 'Snapshot';
  if (lowered.includes('vault')) return 'Vault-Standard';
  if (lowered === 'azurestorage' || type === 'File Share') return 'Snapshot';
  if (lowered === 'azureiaasvm' || lowered === 'iaasvm') return 'Snapshot and Vault-Standard';
  return recoveryType;
}

// Safety-net dedup, applied every time a report is built (not just at collection time).
// The Azure Backup listing APIs commonly return the *same* protected item more than once per
// vault (soft-deleted + live copies, paginated overlap, or the item being visible under both its
// "friendly" and container-qualified resource id). We collapse those here using the most specific
// identity we have (subscription + resource group + vault + raw resource id + storage account),
// keeping the record with the most recent recovery point so the UI always reflects the latest state.
function dedupeAzureBackupItems(items) {
  const latestByKey = new Map();
  const order = [];

  for (const item of items) {
    // Only file shares have shown duplication so far, but the same key logic is safe for VMs too.
    const identity = (item.rawResource || item.resource || '').toLowerCase();
    const key = [
      item.subscription,
      item.resourceGroup,
      item.vault,
      item.storageAccount || '',
      identity
    ].join('|').toLowerCase();

    const existing = latestByKey.get(key);
    if (!existing) {
      latestByKey.set(key, item);
      order.push(key);
      continue;
    }

    const existingTime = new Date(existing.latestRecoveryPoint || existing.lastBackupTime || 0).getTime() || 0;
    const currentTime = new Date(item.latestRecoveryPoint || item.lastBackupTime || 0).getTime() || 0;
    if (currentTime >= existingTime) {
      latestByKey.set(key, item);
    }
  }

  return order.map(key => latestByKey.get(key));
}

function buildAzureBackupReport(records, sourceFile, generatedAt) {
  const source = Array.isArray(records) ? records : records ? [records] : [];
  const mappedItems = source
    .filter(item => item && !['N/A', ''].includes(String(item.BackupType || '')))
    .map(item => {
      const type = normalizeAzureBackupType(item);
      return {
        tenantId: item.TenantId || '',
        tenantName: item.TenantName || '',
        subscription: item.SubscriptionName || 'Unknown',
        resourceGroup: item.ResourceGroup || 'N/A',
        vault: item.VaultName || 'N/A',
        type,
        resource: normalizeAzureResourceName(item, type),
        rawResource: item.RawResourceName || item.ResourceName || '',
        status: item.BackupStatus || 'Warning',
        lastBackupStatus: item.LastBackupStatus || 'N/A',
        preBackupStatus: item.PreBackupStatus || 'N/A',
        consistency: normalizeAzureConsistency(item, type),
        recoveryType: normalizeAzureRecoveryType(item, type),
        latestRecoveryPoint: item.LatestRPTime || 'N/A',
        lastBackupTime: item.LastBackupTime || 'N/A',
        backupAge: item.BackupAge || 'N/A',
        backupAgeHours: Number(item.BackupAgeHours ?? -1),
        policyName: item.PolicyName || 'N/A',
        protectionState: item.ProtectionState || 'N/A',
        storageAccount: item.StorageAccount || ''
      };
    });

  const items = dedupeAzureBackupItems(mappedItems);
  if (items.length !== mappedItems.length) {
    console.log(`[AZ-DEDUP] Removed ${mappedItems.length - items.length} duplicate backup records (${mappedItems.length} -> ${items.length})`);
  }

  const subscriptionsByName = new Map();
  for (const item of items) {
    if (!subscriptionsByName.has(item.subscription)) {
      subscriptionsByName.set(item.subscription, {
        name: item.subscription,
        id: '',
        totalItems: 0,
        healthy: 0,
        warning: 0,
        failed: 0,
        vmCount: 0,
        fileShareCount: 0,
        vaults: []
      });
    }
    const subscription = subscriptionsByName.get(item.subscription);
    subscription.totalItems++;
    const statusKey = String(item.status).toLowerCase();
    if (statusKey === 'healthy') subscription.healthy++;
    else if (statusKey === 'failed') subscription.failed++;
    else subscription.warning++;
    if (item.type === 'Azure VM') subscription.vmCount++;
    if (item.type === 'File Share') subscription.fileShareCount++;

    let vault = subscription.vaults.find(entry => entry.name === item.vault && entry.resourceGroup === item.resourceGroup);
    if (!vault) {
      vault = { name: item.vault, resourceGroup: item.resourceGroup, items: [], vmBackupsProcessed: 0, fileShareBackupsProcessed: 0 };
      subscription.vaults.push(vault);
    }
    vault.items.push(item);
    if (item.type === 'Azure VM') vault.vmBackupsProcessed++;
    if (item.type === 'File Share') vault.fileShareBackupsProcessed++;
  }

const countStatus = status => items.filter(item => item.status === status).length;
  const appItems = items.filter(item => item.consistency === 'Application Consistent');
  const crashItems = items.filter(item => item.consistency === 'Crash Consistent');
  const fsItems = items.filter(item => item.consistency === 'File-System Consistent');
  return {
    file: sourceFile,
    generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
    scheduleTimeZone: AZURE_BACKUP_TIME_ZONE,
    refreshSchedule: 'Every 3 hours at 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00',
    totalRecords: items.length,
    healthy: countStatus('Healthy'),
    warning: countStatus('Warning'),
    failed: countStatus('Failed'),
    totalVms: items.filter(item => item.type === 'Azure VM').length,
    totalFileShares: items.filter(item => item.type === 'File Share').length,
    consistencyCounts: {
      application: appItems.length,
      crash: crashItems.length,
      filesystem: fsItems.length
    },
    consistencyDetails: {
      application: { count: appItems.length, items: appItems },
      crash: { count: crashItems.length, items: crashItems },
      filesystem: { count: fsItems.length, items: fsItems }
    },
    alerts: items.filter(item => item.status !== 'Healthy'),
    subscriptions: [...subscriptionsByName.values()],
    items
  };
}

function readLatestAzureBackupReport() {
  const latest = latestAzureBackupFile('AzureBackupData_', '.json');
  if (!latest) return null;
  const raw = fs.readFileSync(latest.path, 'utf8').replace(/^\uFEFF/, '');
  return buildAzureBackupReport(JSON.parse(raw), latest.name, latest.mtime);
}

// Persists the RAW collector records (PascalCase Azure fields, e.g. BackupType/SubscriptionName) —
// NOT report.items. readLatestAzureBackupReport() re-parses this file straight back through
// buildAzureBackupReport(), which expects that raw shape; saving the already-normalized
// (camelCase) report.items here silently produced 0 records on every restart-triggered re-read.
function saveAzureBackupReport(records, filename) {
  if (!fs.existsSync(AZURE_BACKUP_DIR)) {
    fs.mkdirSync(AZURE_BACKUP_DIR, { recursive: true });
  }
  const filepath = path.join(AZURE_BACKUP_DIR, filename);
  const data = records || [];
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[AZ-REPORT] Saved report to ${filepath} (${data.length} items)`);
}

function generateSeedBackupData() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const subscriptions = ['Conduent', 'FLSmidth', 'MuraaiInfra', 'Allegion', 'Stellantis'];
  const vaults = [
    { sub: 'Conduent', name: 'cndt-nonprod-vault', rg: 'cndt-nonprod' },
    { sub: 'Conduent', name: 'cndt-prod-asr', rg: 'conduent-prod-rg' },
    { sub: 'Conduent', name: 'cndt-dev-asr', rg: 'cndt-dev-rg' },
    { sub: 'FLSmidth', name: 'fls-prod-asr', rg: 'flsmidth-prod-rg' },
    { sub: 'FLSmidth', name: 'flsmidth-recovery-service-vault', rg: 'flsmidth-dr-rg' },
    { sub: 'MuraaiInfra', name: 'muraai-backup-vault', rg: 'muraai-controller-rg' },
    { sub: 'Allegion', name: 'allegion-prod-asr', rg: 'allegion-prod-rg' },
    { sub: 'Allegion', name: 'allegion-prod-rsv', rg: 'allegion-rsv-rg' },
    { sub: 'Stellantis', name: 'stellantis-prod-rsv', rg: 'stellantis-prod-rg' }
  ];
  const vms = [
    // cndt-nonprod-vault (0)
    { name: 'cndt-nonprod-ic-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-nonprod-mbir-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-nonprod-db-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-nonprod-web-vm', sub: 'Conduent', vault: 0, consistency: 'File-System Consistent', status: 'Healthy' },
    { name: 'cndt-nonprod-app-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-nonprod-util-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
    // cndt-prod-asr (1)
    { name: 'cndt-prod-awp-node1', sub: 'Conduent', vault: 1, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-prod-awp-node2', sub: 'Conduent', vault: 1, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-prod-ds-vm', sub: 'Conduent', vault: 1, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'conduent-prod-app-vmss-0', sub: 'Conduent', vault: 1, consistency: 'Crash Consistent', status: 'Warning' },
    { name: 'conduent-prod-app-vmss-1', sub: 'Conduent', vault: 1, consistency: 'Crash Consistent', status: 'Warning' },
    // cndt-dev-asr (2)
    { name: 'cndt-dev-appworks-vm', sub: 'Conduent', vault: 2, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'cndt-dev-cs-vm', sub: 'Conduent', vault: 2, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'conduent-dev-db-vm', sub: 'Conduent', vault: 2, consistency: 'File-System Consistent', status: 'Healthy' },
    // fls-prod-asr (3)
    { name: 'fls-prod-ic-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'flsmidth-prod-mbir-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'flsmidth-prod-db-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'fls-prod-web-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
    // flsmidth-recovery-service-vault (4)
    { name: 'fls-dev-ic-vm', sub: 'FLSmidth', vault: 4, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'fls-nonprod-mbir-vm', sub: 'FLSmidth', vault: 4, consistency: 'Crash Consistent', status: 'Warning' },
    { name: 'fls-scs-vm', sub: 'FLSmidth', vault: 4, consistency: 'Crash Consistent', status: 'Warning' },
    { name: 'fls-dr-util-vm', sub: 'FLSmidth', vault: 4, consistency: 'Application Consistent', status: 'Healthy' },
    // muraai-backup-vault (5)
    { name: 'muraaisims-demo-ic-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'muraaisims-demo-mbir-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'muraaisims-demo-occ-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'muraaisims-demo-db-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
    // allegion-prod-asr (6)
    { name: 'allegion-prod-ic-vm', sub: 'Allegion', vault: 6, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'allegion-prod-mbir-vm', sub: 'Allegion', vault: 6, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'allegion-prod-db-vm', sub: 'Allegion', vault: 6, consistency: 'Application Consistent', status: 'Healthy' },
    // allegion-prod-rsv (7)
    { name: 'allegion-prod-web-vm', sub: 'Allegion', vault: 7, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'allegion-prod-app-vm', sub: 'Allegion', vault: 7, consistency: 'Crash Consistent', status: 'Warning' },
    { name: 'allegion-prod-util-vm', sub: 'Allegion', vault: 7, consistency: 'File-System Consistent', status: 'Healthy' },
    // stellantis-prod-rsv (8)
    { name: 'stellantis-prod-mbir-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'stellantis-prod-ic-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'stellantis-prod-db-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'stellantis-prod-web-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
    { name: 'stellantis-prod-app-vm', sub: 'Stellantis', vault: 8, consistency: 'Crash Consistent', status: 'Warning' }
  ];

  const records = vms.map((vm, i) => {
    const v = vaults[vm.vault];
    const backupDate = new Date(now.getTime() - (i * 3600000));
    const ageHours = Math.round((now - backupDate) / 3600000);
    return {
      TenantId: '583bbc8b-b4b7-4e5f-900d-c0554b41e2eb',
      TenantName: 'Muraai Information Technologies Pvt Ltd',
      SubscriptionName: vm.sub,
      ResourceGroup: v.rg,
      VaultName: v.name,
      BackupType: 'Azure VM',
      ResourceName: vm.name,
      BackupStatus: vm.status,
      LastBackupStatus: vm.status === 'Healthy' ? 'Completed' : 'Warning',
      PreBackupStatus: vm.status === 'Healthy' ? 'Succeeded' : 'Failed',
      ConsistencyType: vm.consistency,
      RecoveryType: vm.status === 'Healthy' ? 'Snapshot and Vault-Standard' : 'N/A',
      LatestRPTime: backupDate.toISOString(),
      LastBackupTime: backupDate.toISOString(),
      BackupAge: `${ageHours}h ago`,
      BackupAgeHours: ageHours,
      PolicyName: 'DailyBackupPolicy',
      ProtectionState: vm.status === 'Healthy' ? 'Protected' : 'Unprotected',
      StorageAccount: `${vm.name.replace(/-/g, '')}sa`
    };
  });

  const fileShares = [
    { name: 'pvc-72bd4775-2a93-45c4-aa87-61b9b2060b85', sub: 'MuraaiInfra', vault: 5, status: 'Healthy' },
    { name: 'pvc-a1f2e3d4-b5c6-7890-abcd-ef1234567890', sub: 'Conduent', vault: 0, status: 'Healthy' },
    { name: 'pvc-f3e4d5c6-b7a8-9012-bcde-f13579111314', sub: 'FLSmidth', vault: 3, status: 'Warning' },
    { name: 'pvc-9a8b7c6d-5e4f-3210-fedc-ba9876543210', sub: 'Allegion', vault: 6, status: 'Failed' },
    { name: 'pvc-12345678-1234-1234-1234-123456789012', sub: 'Stellantis', vault: 8, status: 'Healthy' }
  ];

  const fsRecords = fileShares.map((fs, i) => {
    const v = vaults[fs.vault];
    const backupDate = new Date(now.getTime() - ((i + vms.length) * 3600000));
    const ageHours = Math.round((now - backupDate) / 3600000);
    return {
      TenantId: '583bbc8b-b4b7-4e5f-900d-c0554b41e2eb',
      TenantName: 'Muraai Information Technologies Pvt Ltd',
      SubscriptionName: fs.sub,
      ResourceGroup: v.rg,
      VaultName: v.name,
      BackupType: 'File Share',
      ResourceName: fs.name,
      BackupStatus: fs.status,
      LastBackupStatus: fs.status === 'Healthy' ? 'Completed' : (fs.status === 'Warning' ? 'Warning' : 'Failed'),
      PreBackupStatus: fs.status === 'Healthy' ? 'Succeeded' : 'Failed',
      ConsistencyType: 'File-System Consistent',
      RecoveryType: 'Snapshot',
      LatestRPTime: backupDate.toISOString(),
      LastBackupTime: backupDate.toISOString(),
      BackupAge: `${ageHours}h ago`,
      BackupAgeHours: ageHours,
      PolicyName: 'AzureFileSharePolicy',
      ProtectionState: fs.status === 'Healthy' ? 'Protected' : 'Unprotected',
      StorageAccount: fs.name.replace(/-/g, '').toLowerCase() + 'sa'
    };
  });

  const allRecords = [...records, ...fsRecords];

  const nowStr = now.toISOString();
  const filename = `AzureBackupData_${timestamp}.json`;
  const report = buildAzureBackupReport(allRecords, filename, nowStr);
  latestAzureBackupReport = report;
  console.log(`[AZ-SEED] Generated sample backup data: ${filename} (${allRecords.length} items: ${records.length} VMs, ${fsRecords.length} File Shares)`);
  return { file: filename, generatedAt: nowStr, records: allRecords };
}

function runAzureBackupCollection(trigger = 'manual') {
  if (azureBackupJob) return azureBackupJob;
  azureBackupLastAttempt = new Date().toISOString();
  azureBackupLastTrigger = trigger;
  azureBackupLastError = '';

  azureBackupJob = new Promise(async (resolve, reject) => {
    const userToken = typeof trigger === 'object' && trigger.userToken ? trigger.userToken : null;
    const triggerName = typeof trigger === 'string' ? trigger : 'manual';
    const collectionErrors = [];

    // Priority 1: Try with user-delegated Azure token (from MSAL frontend)
    if (userToken) {
      try {
        const collector = require('./azure-backup-collector');
        let records = await collector.collectAzureBackupData(userToken);
        records = collector.deduplicateFileShares(records);
        if (records && records.length > 0) {
          const nowStr = new Date().toISOString();
          const filename = `AzureBackupData_${nowStr.replace(/[:.]/g, '-').slice(0, 19)}.json`;
          const report = buildAzureBackupReport(records, filename, nowStr);
          latestAzureBackupReport = report;
          saveAzureBackupReport(records, filename);
          console.log(`[AZ-SDK] Generated ${records.length} records (user token)`);
          resolve({ report, stdout: '', stderr: '' });
          return;
        }
        console.warn('[AZ-SDK] User token collector returned no records, falling back...');
        collectionErrors.push('User Azure token collector returned 0 records.');
      } catch (sdkErr) {
        console.warn('[AZ-SDK] User token collector failed:', sdkErr.message);
        collectionErrors.push(`User Azure token collector failed: ${sdkErr.message}`);
      }
    }

    // Priority 2: Try Azure SDK collector with service principal (manual refresh only)
    if (triggerName !== 'scheduled' && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
      try {
        const collector = require('./azure-backup-collector');
        let records = await collector.collectAzureBackupData();
        records = collector.deduplicateFileShares(records);
        if (records && records.length > 0) {
          const nowStr = new Date().toISOString();
          const filename = `AzureBackupData_${nowStr.replace(/[:.]/g, '-').slice(0, 19)}.json`;
          const report = buildAzureBackupReport(records, filename, nowStr);
          latestAzureBackupReport = report;
          saveAzureBackupReport(records, filename);
          console.log(`[AZ-SDK] Generated ${records.length} records`);
          resolve({ report, stdout: '', stderr: '' });
          return;
        }
        console.warn('[AZ-SDK] Collector returned no records, falling back...');
        collectionErrors.push('Service principal Azure collector returned 0 records.');
      } catch (sdkErr) {
        console.warn('[AZ-SDK] SDK collector failed:', sdkErr.message);
        collectionErrors.push(`Service principal Azure collector failed: ${sdkErr.message}`);
      }
    }

    // No data source available
    reject(new Error(collectionErrors.length
      ? collectionErrors.join(' ')
      : 'No Azure backup data source is available. Live refresh did not collect records.'));
  })
    .then(result => {
      azureBackupLastSuccess = new Date().toISOString();
      return result;
    })
    .catch(error => {
      azureBackupLastError = error?.message || String(error);
      console.error('[AZ-RUN] Collection failed:', azureBackupLastError);
      throw error;
    })
    .finally(() => {
      azureBackupJob = null;
    });

  return azureBackupJob;
}

function getZonedDateParts(date = new Date()) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: AZURE_BACKUP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function checkAzureBackupSchedule() {
  if (String(process.env.ENABLE_AZURE_BACKUP_SCHEDULE || 'true').toLowerCase() === 'false') return;
  // Only run scheduled refresh if a previous report file exists (don't create empty reports)
  const latest = readLatestAzureBackupReport();
  if (!latest) return;
  const parts = getZonedDateParts();
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const slot = `${parts.year}-${parts.month}-${parts.day}-${String(Math.floor(hour / 3)).padStart(2, '0')}`;
  if (hour % 3 === 0 && minute < 5 && slot !== azureBackupLastScheduledSlot) {
    azureBackupLastScheduledSlot = slot;
    runAzureBackupCollection('scheduled').catch(() => {});
  }
}

// Periodic presence sync
let presenceSyncTimer = null;
async function runPresenceSync() {
  try {
    const token = await getGraphToken();
    const usersResult = await pool.query(`
      SELECT DISTINCT LOWER(TRIM(user_email)) as email FROM monitoring_devices
      WHERE user_email IS NOT NULL AND TRIM(user_email) != ''
    `);
    const emails = usersResult.rows.map(r => r.email).filter(Boolean);
    for (const email of emails) {
      try {
        const userResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!userResp.ok) continue;
        const userData = await userResp.json();
        if (!userData.id) continue;
        const presenceResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${userData.id}/presence`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!presenceResp.ok) continue;
        const presence = await presenceResp.json();
        await pool.query(
          `INSERT INTO monitoring_presence_log (user_email, user_id, activity, timestamp) VALUES ($1,$2,$3,NOW())`,
          [email, userData.id, presence.activity || 'PresenceUnknown']
        );
      } catch (e) { /* skip user */ }
    }
  } catch (e) { /* skip cycle */ }
}

// Periodic CloudOps assignment poll — replaces the need for a Zoho Desk workflow
// rule. Scans the CloudOps department's most-recently-modified tickets, and for
// any whose assignee isn't yet reflected in ticket_assignments (assigned/reassigned
// directly in Zoho Desk, not through this portal), mirrors it into our DB and
// notifies the CloudOps Teams channel — same handling as portal assignments.
let cloudOpsAssignmentPollTimer = null;
const CLOUDOPS_POLL_PAGE_SIZE = 100;
const CLOUDOPS_POLL_MAX_PAGES = 3;

async function runCloudOpsAssignmentPoll() {
  const deptId = DEPARTMENT_IDS.itsm;
  if (!deptId) return;

  try {
    const tickets = [];
    for (let page = 0; page < CLOUDOPS_POLL_MAX_PAGES; page++) {
      const from = page * CLOUDOPS_POLL_PAGE_SIZE;
      const res = await zohoFetch(
        `/tickets?limit=${CLOUDOPS_POLL_PAGE_SIZE}&from=${from}&departmentId=${deptId}&sortBy=-modifiedTime&include=contacts,assignee`
      );
      if (!res.ok) break;
      const data = await res.json();
      const batch = Array.isArray(data?.data) ? data.data : [];
      tickets.push(...batch);
      if (batch.length < CLOUDOPS_POLL_PAGE_SIZE) break;
    }
    if (!tickets.length) return;

    const ticketIds = tickets.map(t => (t.id || '').toString()).filter(Boolean);
    const now = Date.now();
    // Only ping Teams for things that actually just happened. A ticket assigned
    // (or created) in Zoho weeks ago that we're only now discovering (because it
    // never went through the portal) is backlog to record quietly, not a live event.
    const NOTIFY_RECENCY_MS = 20 * 60 * 1000;

    // ── New-ticket "arrival" pass — fires once per ticket regardless of assignee ──
    const arrivalRes = await pool.query(
      `SELECT zoho_ticket_id FROM ticket_arrival_notifications WHERE zoho_ticket_id = ANY($1)`,
      [ticketIds]
    );
    const knownArrivals = new Set(arrivalRes.rows.map(r => r.zoho_ticket_id));

    for (const t of tickets) {
      const zohoTicketId = (t.id || '').toString();
      if (!zohoTicketId || knownArrivals.has(zohoTicketId)) continue;

      try {
        await pool.query(
          `INSERT INTO ticket_arrival_notifications (zoho_ticket_id, zoho_department_id) VALUES ($1, $2)
           ON CONFLICT (zoho_ticket_id) DO NOTHING`,
          [zohoTicketId, deptId]
        );

        const createdRaw = t.createdTime || t.modifiedTime || null;
        const createdDate = createdRaw && !Number.isNaN(new Date(createdRaw).getTime()) ? new Date(createdRaw) : null;
        const isRecentlyCreated = createdDate && (now - createdDate.getTime()) < NOTIFY_RECENCY_MS;

        if (isRecentlyCreated) {
          const requesterEmail = (t.email || t.contact?.email || t.contact?.emailAddress || '').toString().trim().toLowerCase();
          const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || '').toString().trim().toLowerCase();
          notifyCloudOpsTeamsOnNewTicket({
            zohoTicketId,
            zohoTicketNumber: t.ticketNumber,
            subject: t.subject,
            requesterEmail,
            assigneeEmail,
            category: extractCategoryFromZohoTicket(t) || null
          }).catch(() => {});
        }
      } catch (err) {
        console.error(`[CloudOps poll] Failed to record arrival for ${zohoTicketId}:`, err?.message || err);
      }
    }

    // ── Assignment pass — existing logic, unchanged ──
    const existingRes = await pool.query(
      `SELECT zoho_ticket_id, primary_assignee FROM ticket_assignments WHERE zoho_ticket_id = ANY($1)`,
      [ticketIds]
    );
    const knownAssignee = new Map(existingRes.rows.map(r => [r.zoho_ticket_id, (r.primary_assignee || '').toLowerCase()]));

    for (const t of tickets) {
      const zohoTicketId = (t.id || '').toString();
      const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || '').toString().trim().toLowerCase();
      if (!zohoTicketId || !assigneeEmail) continue;
      if (isRecentPortalAssignment(zohoTicketId)) continue;

      const isNewDiscovery = !knownAssignee.has(zohoTicketId);
      const previousAssignee = knownAssignee.get(zohoTicketId);
      if (!isNewDiscovery && previousAssignee === assigneeEmail) continue; // already known — nothing changed

      const assignedBy = (t.modifiedBy?.email || t.modifiedBy?.emailId || '').toString().trim().toLowerCase() || 'zoho-desk';
      const category = extractCategoryFromZohoTicket(t) || null;

      // Ground truth for "when did this happen" comes from Zoho's own timestamps,
      // never from our poll time — otherwise every backlog ticket we discover
      // today gets misdated as "assigned today".
      const rawTimestamp = t.modifiedTime || t.createdTime || null;
      const assignedAtDate = rawTimestamp && !Number.isNaN(new Date(rawTimestamp).getTime())
        ? new Date(rawTimestamp)
        : new Date();
      const isRecentEvent = (now - assignedAtDate.getTime()) < NOTIFY_RECENCY_MS;
      const isReassignment = !isNewDiscovery && previousAssignee !== assigneeEmail;

      try {
        await pool.query(
          `INSERT INTO ticket_assignments
            (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, status, category, zoho_department_id, assigned_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (zoho_ticket_id) DO UPDATE SET
             assigned_users = EXCLUDED.assigned_users,
             primary_assignee = EXCLUDED.primary_assignee,
             reassigned_user = ticket_assignments.primary_assignee,
             reassigned_at = NOW(),
             reassigned_by = EXCLUDED.assigned_by,
             category = COALESCE(ticket_assignments.category, EXCLUDED.category),
             zoho_department_id = COALESCE(ticket_assignments.zoho_department_id, EXCLUDED.zoho_department_id),
             updated_at = NOW()`,
          [zohoTicketId, t.ticketNumber || null, [assigneeEmail], assigneeEmail, assignedBy, t.status || 'Open', category, deptId, assignedAtDate.toISOString()]
        );

        if (isReassignment || (isNewDiscovery && isRecentEvent)) {
          notifyCloudOpsTeamsOnAssignment({
            zohoTicketId,
            zohoTicketNumber: t.ticketNumber,
            zohoDepartmentId: deptId,
            assignedUsers: [assigneeEmail],
            assignedBy,
            category,
            isBulk: false
          }).catch(() => {});
        }

        invalidateRuntimeCaches();
      } catch (err) {
        console.error(`[CloudOps poll] Failed to record assignment for ${zohoTicketId}:`, err?.message || err);
      }
    }
  } catch (err) {
    console.error('[CloudOps poll] Cycle failed:', err?.message || err);
  }
}

// ------------------------
// Multer upload error handler (must be registered after all routes)
// ------------------------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Attachment exceeds the maximum allowed size (25MB)'
      : 'Attachment upload failed';
    return res.status(413).json({ message });
  }
  next(err);
});

// ------------------------
// Start server
// ------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  checkAzureBackupSchedule();
  setInterval(checkAzureBackupSchedule, 30 * 1000).unref();

  // Schedule automatic presence sync every 15 minutes
  runPresenceSync().catch(() => {});
  presenceSyncTimer = setInterval(() => runPresenceSync().catch(() => {}), 15 * 60 * 1000).unref();

  // Poll for CloudOps ticket assignments made directly in Zoho Desk every 5 minutes.
  // Gated by ENABLE_ALERT_JOBS — production runs this app as multiple replicas
  // (see zoho-itsm Deployment) plus one dedicated zoho-itsm-scheduler replica for
  // single-instance jobs. Running unconditionally here would poll Zoho and post
  // to Teams once per replica in parallel, duplicating every notification.
  if (ENABLE_ALERT_JOBS) {
    runCloudOpsAssignmentPoll().catch(() => {});
    cloudOpsAssignmentPollTimer = setInterval(() => runCloudOpsAssignmentPoll().catch(() => {}), 5 * 60 * 1000).unref();
  }

  // Per-user counts caches are warmed on each user's first dashboard request
  // via the SWR pattern. No shared pre-warm needed (it caused wrong 0-counts
  // for assigned/SLA metrics because no real userEmail was available at boot).
});

// Run a fresh live Azure Backup collection. Concurrent clicks share one job.
app.post('/api/monitoring/azure/run-report', authenticateToken, authorizeElevated, async (req, res) => {
  try {
    const userToken = req.headers['x-azure-token'] || null;
    const result = await runAzureBackupCollection({ trigger: 'manual', userToken });
    res.json({ status: 'ok', report: result.report });
  } catch (err) {
    res.status(500).json({
      message: 'Live Azure backup collection failed',
      error: err?.message || String(err),
      stderr: err?.stderr || ''
    });
  }
});

app.get('/api/monitoring/azure/report-status', authenticateToken, authorizeElevated, (req, res) => {
  // report-status is polled frequently (every 15-60s) — only pay the cost of parsing the full
  // report JSON when we don't already have lastSuccess in memory. Otherwise just stat the file.
  let fallbackGeneratedAt = null;
  if (!azureBackupLastSuccess) {
    const latestFile = latestAzureBackupFile('AzureBackupData_', '.json');
    fallbackGeneratedAt = latestFile ? latestFile.mtime.toISOString() : null;
  }
  res.json({
    running: Boolean(azureBackupJob),
    lastAttempt: azureBackupLastAttempt,
    lastSuccess: azureBackupLastSuccess || fallbackGeneratedAt,
    lastError: azureBackupLastError,
    lastTrigger: azureBackupLastTrigger,
    scheduleTimeZone: AZURE_BACKUP_TIME_ZONE,
    refreshSchedule: '00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00'
  });
});

// Parse the latest AzureBackupMonitor_*.log into structured JSON
app.get('/api/monitoring/azure/report-log', authenticateToken, authorizeElevated, async (req, res) => {
  try {
    const structuredReport = readLatestAzureBackupReport();
    if (structuredReport) {
      res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
      return res.json(structuredReport);
    }
    // Fallback: return seed data so UI has something to display
    console.log('[AZ-REPORT] No cached report found, returning seed data');
    const seedData = generateSeedBackupData();
    const seedReport = buildAzureBackupReport(seedData, 'seed-data.json', new Date().toISOString());
    res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return res.json(seedReport);
  } catch (err) {
    console.error('Report-log parse error:', err);
    res.status(500).json({ message: 'Failed to parse report log', error: err?.message || err });
  }
});

app.get('/api/monitoring/azure/report-html', authenticateToken, authorizeElevated, async (req, res) => {
  // HTML reports are no longer generated (file storage removed)
  return res.status(404).json({ message: 'HTML reports are no longer generated. Use /api/monitoring/azure/report-log for JSON data.' });
});

// -------------------------------------------------------
// CLOUDOPS PROJECTS & TASKS API
// -------------------------------------------------------

// Configurable so the group can be corrected without a code change once a
// dedicated "Services - Managed Services" group exists. Until then, this falls
// back to the same AD group (CLOUDOPS_GROUP_MAIL) already used to gate CloudOps
// login/role access, since no separate roster group exists in this tenant yet.
const CLOUDOPS_TEAM_GROUP = (process.env.CLOUDOPS_TEAM_GROUP || CLOUDOPS_GROUP_MAIL || 'Services - Managed Services').trim();

// Looks up the CloudOps AD group and returns its members (with jobTitle/department
// so the manager can be identified). Throws on a hard Graph failure; returns
// { groupFound: false } if the group itself can't be located (distinct from a
// group that exists but has zero members).
async function fetchCloudOpsGroupMembers(graphToken) {
  // CLOUDOPS_TEAM_GROUP may be a mail address (e.g. "cloudops@muraai.com") or a
  // display name — match on either so the fallback default above resolves correctly.
  const groupUrl = `https://graph.microsoft.com/v1.0/groups?$filter=mail eq '${encodeURIComponent(CLOUDOPS_TEAM_GROUP)}' or displayName eq '${encodeURIComponent(CLOUDOPS_TEAM_GROUP)}'&$select=id,displayName,mail`;
  const groupRes = await fetch(groupUrl, {
    headers: { Authorization: `Bearer ${graphToken}` }
  });
  if (!groupRes.ok) {
    const body = await groupRes.text().catch(() => '');
    throw new Error(`Graph group lookup failed (HTTP ${groupRes.status}): ${body.slice(0, 300)}`);
  }
  const groupData = await groupRes.json();
  let group = (groupData.value || [])[0];

  if (!group?.id) {
    // Fall back to a fuzzy search in case the exact display name differs slightly
    // (e.g. trailing space, different dash character) from what's configured.
    try {
      const fallbackUrl = `https://graph.microsoft.com/v1.0/groups?$search="displayName:${encodeURIComponent(CLOUDOPS_TEAM_GROUP)}"&$select=id,displayName,mail&$top=5`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { Authorization: `Bearer ${graphToken}`, ConsistencyLevel: 'eventual' }
      });
      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        group = (fallbackData.value || [])[0];
        if (group) {
          console.warn(`[CloudOps] Group "${CLOUDOPS_TEAM_GROUP}" had no exact match; using closest match "${group.displayName}" (id: ${group.id}). Set CLOUDOPS_TEAM_GROUP to silence this.`);
        }
      }
    } catch (fallbackErr) {
      console.warn('[CloudOps] Fallback group search failed:', fallbackErr?.message);
    }
  }

  if (!group?.id) {
    console.error(`[CloudOps] Azure AD group "${CLOUDOPS_TEAM_GROUP}" was not found. Verify the group name and that the signed-in user's Graph token includes Group.Read.All / GroupMember.Read.All consent.`);
    return { members: [], groupFound: false };
  }

  const members = [];
  let membersUrl = `https://graph.microsoft.com/v1.0/groups/${group.id}/members?$select=mail,userPrincipalName,displayName,jobTitle,department&$top=100`;
  while (membersUrl) {
    const mRes = await fetch(membersUrl, {
      headers: { Authorization: `Bearer ${graphToken}` }
    });
    if (!mRes.ok) {
      const body = await mRes.text().catch(() => '');
      throw new Error(`Graph group-members lookup failed (HTTP ${mRes.status}): ${body.slice(0, 300)}`);
    }
    const mData = await mRes.json();
    (mData.value || []).forEach((u) => {
      const email = (u.mail || u.userPrincipalName || '').trim().toLowerCase();
      const displayName = (u.displayName || '').trim();
      if (email && !email.includes('#ext#')) {
        members.push({
          email,
          displayName,
          jobTitle: (u.jobTitle || '').trim(),
          department: (u.department || '').trim()
        });
      }
    });
    membersUrl = mData['@odata.nextLink'] || '';
  }

  members.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
  return { members, groupFound: true };
}

// The CloudOps group manager is identified by job title (e.g. "Manager - Managed
// Services") rather than by whoever happens to be logged in.
function pickCloudOpsManager(members) {
  return members.find((m) => /manager/i.test(m.jobTitle || '')) || null;
}

// Get all CloudOps team members (from the CloudOps AD group via Graph)
app.get('/api/cloudops/team-members', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const graphToken = req.headers['x-graph-token'];
    if (!graphToken) {
      return res.status(400).json({ message: 'x-graph-token header required' });
    }

    const { members, groupFound } = await fetchCloudOpsGroupMembers(graphToken);
    if (!groupFound) {
      return res.status(404).json({
        message: `Azure AD group "${CLOUDOPS_TEAM_GROUP}" was not found or its members aren't visible to this account. Verify the group name and Graph permissions.`,
        members: []
      });
    }
    res.json({ members });
  } catch (err) {
    console.error('Failed to fetch cloudops team members:', err);
    res.status(502).json({ message: err.message || 'Failed to fetch team members from Microsoft Graph' });
  }
});

// Get the CloudOps group manager (identified by job title, from the same AD group)
app.get('/api/cloudops/manager', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const graphToken = req.headers['x-graph-token'];
    if (!graphToken) {
      return res.status(400).json({ message: 'x-graph-token header required' });
    }

    const { members, groupFound } = await fetchCloudOpsGroupMembers(graphToken);
    if (!groupFound) {
      return res.status(404).json({ message: `Azure AD group "${CLOUDOPS_TEAM_GROUP}" was not found.` });
    }

    const manager = pickCloudOpsManager(members);
    if (!manager) {
      return res.status(404).json({ message: `No member of "${CLOUDOPS_TEAM_GROUP}" has a job title containing "Manager".` });
    }

    res.json({
      displayName: manager.displayName || '',
      email: manager.email || '',
      jobTitle: manager.jobTitle || '',
      department: manager.department || CLOUDOPS_TEAM_GROUP
    });
  } catch (err) {
    console.error('Failed to fetch manager info:', err);
    res.status(502).json({ message: err.message || 'Failed to fetch manager info from Microsoft Graph' });
  }
});

// Get employee hierarchy (manager excluded, remaining members sorted ascending by name)
app.get('/api/cloudops/employees', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const graphToken = req.headers['x-graph-token'];
    if (!graphToken) {
      return res.status(400).json({ message: 'x-graph-token header required' });
    }

    const { members, groupFound } = await fetchCloudOpsGroupMembers(graphToken);
    if (!groupFound) {
      return res.status(404).json({
        message: `Azure AD group "${CLOUDOPS_TEAM_GROUP}" was not found or its members aren't visible to this account. Verify the group name and Graph permissions.`,
        employees: []
      });
    }

    const manager = pickCloudOpsManager(members);
    const employees = members.filter((m) => !manager || m.email !== manager.email);

    // Enrich each employee with project and task counts
    const enriched = await Promise.all(employees.map(async (emp) => {
      const projectCount = await pool.query(
        `SELECT COUNT(*) AS count FROM cloudops_project_members WHERE LOWER(email) = $1`,
        [emp.email.toLowerCase()]
      );
      const taskCount = await pool.query(
        `SELECT COUNT(*) AS count FROM cloudops_task_assignees WHERE LOWER(email) = $1`,
        [emp.email.toLowerCase()]
      );
      return {
        ...emp,
        project_count: parseInt(projectCount.rows[0]?.count || '0', 10),
        task_count: parseInt(taskCount.rows[0]?.count || '0', 10)
      };
    }));

    res.json({ employees: enriched });
  } catch (err) {
    console.error('Failed to fetch employees:', err);
    res.status(502).json({ message: err.message || 'Failed to fetch employees from Microsoft Graph' });
  }
});

// Get projects for a specific employee
app.get('/api/cloudops/employees/:email/projects', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const result = await pool.query(
      `SELECT p.* FROM cloudops_projects p
       INNER JOIN cloudops_project_members pm ON pm.project_id = p.id
       WHERE LOWER(pm.email) = $1
       ORDER BY p.name ASC`,
      [email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch employee projects:', err);
    res.status(500).json({ message: 'Failed to fetch employee projects' });
  }
});

// Get tasks for a specific employee
app.get('/api/cloudops/employees/:email/tasks', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase();
    const result = await pool.query(
      `SELECT t.*, p.name AS project_name FROM cloudops_tasks t
       INNER JOIN cloudops_projects p ON p.id = t.project_id
       INNER JOIN cloudops_task_assignees ta ON ta.task_id = t.id
       WHERE LOWER(ta.email) = $1
       ORDER BY t.status ASC, t.name ASC`,
      [email]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch employee tasks:', err);
    res.status(500).json({ message: 'Failed to fetch employee tasks' });
  }
});

// ---- PROJECTS CRUD ----

// Get all projects (with optional status filter)
app.get('/api/cloudops/projects', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const statusFilter = (req.query.status || '').toString().trim();
    let query = `
      SELECT p.*,
        COALESCE(
          (SELECT json_agg(json_build_object('email', pm.email, 'display_name', pm.display_name))
           FROM cloudops_project_members pm WHERE pm.project_id = p.id),
          '[]'::json
        ) AS members,
        COALESCE(
          (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'status', t.status))
           FROM cloudops_tasks t WHERE t.project_id = p.id),
          '[]'::json
        ) AS tasks
      FROM cloudops_projects p
    `;
    const params = [];
    if (statusFilter && statusFilter !== 'all') {
      query += ` WHERE LOWER(p.status) = $1`;
      params.push(statusFilter.toLowerCase());
    }
    query += ` ORDER BY p.created_at DESC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch projects:', err);
    res.status(500).json({ message: 'Failed to fetch projects' });
  }
});

// Get single project with full details
app.get('/api/cloudops/projects/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const projectResult = await pool.query('SELECT * FROM cloudops_projects WHERE id = $1', [projectId]);
    if (projectResult.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }
    const project = projectResult.rows[0];

    const membersResult = await pool.query(
      'SELECT * FROM cloudops_project_members WHERE project_id = $1 ORDER BY display_name ASC',
      [projectId]
    );
    project.members = membersResult.rows;

    const tasksResult = await pool.query(
      'SELECT * FROM cloudops_tasks WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );

    // Enrich tasks with assignee details
    const tasksWithAssignees = await Promise.all(tasksResult.rows.map(async (task) => {
      const assigneesResult = await pool.query(
        'SELECT * FROM cloudops_task_assignees WHERE task_id = $1 ORDER BY display_name ASC',
        [task.id]
      );
      return { ...task, assignees: assigneesResult.rows };
    }));

    project.tasks = tasksWithAssignees;

    res.json(project);
  } catch (err) {
    console.error('Failed to fetch project:', err);
    res.status(500).json({ message: 'Failed to fetch project' });
  }
});

// Create project (optionally with an owner and initial team members)
app.post('/api/cloudops/projects', authenticateToken, authorizeAdmin, async (req, res) => {
  const { name, description, status, ownerEmail, ownerName, members } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Project name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO cloudops_projects (name, description, status, owner_email, owner_name, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING *`,
      [
        name.trim(),
        (description || '').trim(),
        (status || 'Open').trim(),
        (ownerEmail || '').trim().toLowerCase() || null,
        (ownerName || '').trim() || null,
        (req.user?.email || '').toLowerCase()
      ]
    );
    const project = result.rows[0];

    // De-dupe by email so the owner isn't inserted twice if also present in `members`.
    const memberMap = new Map();
    if (ownerEmail && ownerEmail.trim()) {
      memberMap.set(ownerEmail.trim().toLowerCase(), {
        email: ownerEmail.trim().toLowerCase(),
        display_name: (ownerName || '').trim() || null,
        role: 'owner'
      });
    }
    (Array.isArray(members) ? members : []).forEach((m) => {
      const email = (m?.email || '').trim().toLowerCase();
      if (!email || memberMap.has(email)) return;
      memberMap.set(email, {
        email,
        display_name: (m.display_name || m.displayName || '').trim() || null,
        role: 'member'
      });
    });

    for (const m of memberMap.values()) {
      await client.query(
        `INSERT INTO cloudops_project_members (project_id, email, display_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, email) DO NOTHING`,
        [project.id, m.email, m.display_name, m.role]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(project);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to create project:', err);
    res.status(500).json({ message: 'Failed to create project' });
  } finally {
    client.release();
  }
});

// Update project
app.put('/api/cloudops/projects/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const { name, description, status, ownerEmail, ownerName } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Project name is required' });
    }

    const result = await pool.query(
      `UPDATE cloudops_projects SET
         name = $1, description = $2, status = $3,
         owner_email = $4, owner_name = $5,
         updated_by = $6, updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [
        name.trim(),
        (description || '').trim(),
        (status || 'Open').trim(),
        (ownerEmail || '').trim().toLowerCase() || null,
        (ownerName || '').trim() || null,
        (req.user?.email || '').toLowerCase(),
        projectId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update project:', err);
    res.status(500).json({ message: 'Failed to update project' });
  }
});

// Delete project
app.delete('/api/cloudops/projects/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const result = await pool.query('DELETE FROM cloudops_projects WHERE id = $1 RETURNING id', [projectId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }
    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    console.error('Failed to delete project:', err);
    res.status(500).json({ message: 'Failed to delete project' });
  }
});

// ---- PROJECT MEMBERS ----

// Add member to project
app.post('/api/cloudops/projects/:id/members', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const { email, display_name } = req.body || {};
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const result = await pool.query(
      `INSERT INTO cloudops_project_members (project_id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, email) DO NOTHING
       RETURNING *`,
      [projectId, email.trim().toLowerCase(), display_name || null]
    );
    res.status(201).json(result.rows[0] || { message: 'Member already exists' });
  } catch (err) {
    console.error('Failed to add project member:', err);
    res.status(500).json({ message: 'Failed to add project member' });
  }
});

// Remove member from project
app.delete('/api/cloudops/projects/:id/members/:email', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const email = decodeURIComponent(req.params.email).toLowerCase();
    await pool.query(
      'DELETE FROM cloudops_project_members WHERE project_id = $1 AND LOWER(email) = $2',
      [projectId, email]
    );
    res.json({ message: 'Member removed successfully' });
  } catch (err) {
    console.error('Failed to remove project member:', err);
    res.status(500).json({ message: 'Failed to remove project member' });
  }
});

// ---- TASKS CRUD ----

// Get tasks for a project
app.get('/api/cloudops/projects/:id/tasks', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const result = await pool.query(
      'SELECT * FROM cloudops_tasks WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );

    const tasksWithAssignees = await Promise.all(result.rows.map(async (task) => {
      const assigneesResult = await pool.query(
        'SELECT * FROM cloudops_task_assignees WHERE task_id = $1 ORDER BY display_name ASC',
        [task.id]
      );
      return { ...task, assignees: assigneesResult.rows };
    }));

    res.json(tasksWithAssignees);
  } catch (err) {
    console.error('Failed to fetch tasks:', err);
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

// Create task
app.post('/api/cloudops/projects/:id/tasks', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const projectId = parseInt(req.params.id, 10);
    if (!Number.isInteger(projectId)) {
      return res.status(400).json({ message: 'Invalid project id' });
    }

    const { name, description, status } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Task name is required' });
    }

    const result = await pool.query(
      `INSERT INTO cloudops_tasks (project_id, name, description, status, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $5) RETURNING *`,
      [
        projectId,
        name.trim(),
        (description || '').trim(),
        (status || 'Open').trim(),
        (req.user?.email || '').toLowerCase()
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to create task:', err);
    res.status(500).json({ message: 'Failed to create task' });
  }
});

// Update task
app.put('/api/cloudops/tasks/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }

    const { name, description, status } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Task name is required' });
    }

    const result = await pool.query(
      `UPDATE cloudops_tasks SET
         name = $1, description = $2, status = $3,
         updated_by = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [
        name.trim(),
        (description || '').trim(),
        (status || 'Open').trim(),
        (req.user?.email || '').toLowerCase(),
        taskId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update task:', err);
    res.status(500).json({ message: 'Failed to update task' });
  }
});

// Delete task
app.delete('/api/cloudops/tasks/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }

    const result = await pool.query('DELETE FROM cloudops_tasks WHERE id = $1 RETURNING id', [taskId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json({ message: 'Task deleted successfully' });
  } catch (err) {
    console.error('Failed to delete task:', err);
    res.status(500).json({ message: 'Failed to delete task' });
  }
});

// ---- TASK ASSIGNEES ----

// Add assignee to task
app.post('/api/cloudops/tasks/:id/assignees', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }

    const { email, display_name } = req.body || {};
    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const result = await pool.query(
      `INSERT INTO cloudops_task_assignees (task_id, email, display_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id, email) DO NOTHING
       RETURNING *`,
      [taskId, email.trim().toLowerCase(), display_name || null]
    );

    // Also update the assigned_to array on the task
    await pool.query(
      `UPDATE cloudops_tasks SET assigned_to = ARRAY(
        SELECT email FROM cloudops_task_assignees WHERE task_id = $1
      ) WHERE id = $1`,
      [taskId]
    );

    res.status(201).json(result.rows[0] || { message: 'Assignee already exists' });
  } catch (err) {
    console.error('Failed to add task assignee:', err);
    res.status(500).json({ message: 'Failed to add task assignee' });
  }
});

// Remove assignee from task
app.delete('/api/cloudops/tasks/:id/assignees/:email', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const taskId = parseInt(req.params.id, 10);
    if (!Number.isInteger(taskId)) {
      return res.status(400).json({ message: 'Invalid task id' });
    }

    const email = decodeURIComponent(req.params.email).toLowerCase();
    await pool.query(
      'DELETE FROM cloudops_task_assignees WHERE task_id = $1 AND LOWER(email) = $2',
      [taskId, email]
    );

    // Update assigned_to array on the task
    await pool.query(
      `UPDATE cloudops_tasks SET assigned_to = ARRAY(
        SELECT email FROM cloudops_task_assignees WHERE task_id = $1
      ) WHERE id = $1`,
      [taskId]
    );

    res.json({ message: 'Assignee removed successfully' });
  } catch (err) {
    console.error('Failed to remove task assignee:', err);
    res.status(500).json({ message: 'Failed to remove task assignee' });
  }
});

// ---- PROJECT STATUS COUNTS ----
app.get('/api/cloudops/stats', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'open' THEN 1 ELSE 0 END), 0)::int AS open,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'in progress' THEN 1 ELSE 0 END), 0)::int AS in_progress,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'testing' THEN 1 ELSE 0 END), 0)::int AS testing,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'closed' THEN 1 ELSE 0 END), 0)::int AS closed
      FROM cloudops_projects
    `);
    res.json(result.rows[0] || { total: 0, open: 0, in_progress: 0, testing: 0, closed: 0 });
  } catch (err) {
    console.error('Failed to fetch project stats:', err);
    res.status(500).json({ message: 'Failed to fetch project stats' });
  }
});

// ============================================================
// CLOUDOPS ASSETS PAGES API
// ============================================================

// Get all asset pages (with columns and row counts)
app.get('/api/cloudops/assets/pages', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pagesResult = await pool.query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM cloudops_asset_page_columns c WHERE c.page_id = p.id) AS column_count,
        (SELECT COUNT(*) FROM cloudops_asset_page_rows r WHERE r.page_id = p.id) AS row_count
      FROM cloudops_asset_pages p
      ORDER BY p.page_order ASC, p.display_name ASC
    `);
    
    // Get columns for each page
    for (const page of pagesResult.rows) {
      const columnsResult = await pool.query(`
        SELECT * FROM cloudops_asset_page_columns 
        WHERE page_id = $1 
        ORDER BY column_order ASC
      `, [page.id]);
      page.columns = columnsResult.rows;
    }
    
    res.json(pagesResult.rows);
  } catch (err) {
    console.error('Failed to fetch asset pages:', err);
    res.status(500).json({ message: 'Failed to fetch asset pages' });
  }
});

// Get single asset page with full details (columns + rows)
app.get('/api/cloudops/assets/pages/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const pageResult = await pool.query('SELECT * FROM cloudops_asset_pages WHERE id = $1', [pageId]);
    if (pageResult.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }
    const page = pageResult.rows[0];

    const columnsResult = await pool.query(`
      SELECT * FROM cloudops_asset_page_columns 
      WHERE page_id = $1 
      ORDER BY column_order ASC
    `, [pageId]);
    page.columns = columnsResult.rows;

    const rowsResult = await pool.query(`
      SELECT * FROM cloudops_asset_page_rows 
      WHERE page_id = $1 
      ORDER BY row_order ASC, created_at ASC
    `, [pageId]);
    page.rows = rowsResult.rows;

    res.json(page);
  } catch (err) {
    console.error('Failed to fetch asset page:', err);
    res.status(500).json({ message: 'Failed to fetch asset page' });
  }
});

// Create new asset page (custom page)
app.post('/api/cloudops/assets/pages', authenticateToken, authorizeAdmin, async (req, res) => {
  const { name, display_name, description, columns } = req.body || {};
  
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Page name is required' });
  }
  if (!display_name || !display_name.trim()) {
    return res.status(400).json({ message: 'Display name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get max page_order
    const orderResult = await client.query('SELECT COALESCE(MAX(page_order), 0) + 1 AS next_order FROM cloudops_asset_pages');
    const nextOrder = parseInt(orderResult.rows[0]?.next_order || '1', 10);

    const pageResult = await client.query(
      `INSERT INTO cloudops_asset_pages (name, display_name, description, is_system_page, page_order, created_by, updated_by)
       VALUES ($1, $2, $3, FALSE, $4, $5, $5) RETURNING *`,
      [
        name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
        display_name.trim(),
        (description || '').trim(),
        nextOrder,
        (req.user?.email || '').toLowerCase()
      ]
    );
    const page = pageResult.rows[0];

    // Create columns if provided
    if (Array.isArray(columns) && columns.length > 0) {
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        if (!col.name || !col.display_name) continue;
        
        await client.query(
          `INSERT INTO cloudops_asset_page_columns (page_id, name, display_name, data_type, column_order, is_required, default_value, select_options, validation_regex, is_visible, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)`,
          [
            page.id,
            col.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
            col.display_name.trim(),
            col.data_type || 'text',
            i + 1,
            col.is_required || false,
            col.default_value || null,
            col.select_options ? JSON.stringify(col.select_options) : null,
            col.validation_regex || null,
            col.is_visible !== false,
            (req.user?.email || '').toLowerCase()
          ]
        );
      }
    }

    await client.query('COMMIT');
    
    // Fetch the complete page with columns
    const fullPageResult = await pool.query('SELECT * FROM cloudops_asset_pages WHERE id = $1', [page.id]);
    const fullPage = fullPageResult.rows[0];
    const fullColumnsResult = await pool.query('SELECT * FROM cloudops_asset_page_columns WHERE page_id = $1 ORDER BY column_order ASC', [page.id]);
    fullPage.columns = fullColumnsResult.rows;
    fullPage.rows = [];
    
    res.status(201).json(fullPage);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to create asset page:', err);
    if (err.code === '23505') { // Unique violation
      return res.status(400).json({ message: 'Page name already exists' });
    }
    res.status(500).json({ message: 'Failed to create asset page' });
  } finally {
    client.release();
  }
});

// Update asset page (name, display_name, description, page_order)
app.put('/api/cloudops/assets/pages/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    // Check if it's a system page
    const pageCheck = await pool.query('SELECT is_system_page FROM cloudops_asset_pages WHERE id = $1', [pageId]);
    if (pageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }
    if (pageCheck.rows[0].is_system_page) {
      return res.status(403).json({ message: 'Cannot modify system pages' });
    }

    const { display_name, description, page_order } = req.body || {};
    if (!display_name || !display_name.trim()) {
      return res.status(400).json({ message: 'Display name is required' });
    }

    const result = await pool.query(
      `UPDATE cloudops_asset_pages SET
         display_name = $1, description = $2, page_order = $3,
         updated_by = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [
        display_name.trim(),
        (description || '').trim(),
        page_order || 0,
        (req.user?.email || '').toLowerCase(),
        pageId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update asset page:', err);
    res.status(500).json({ message: 'Failed to update asset page' });
  }
});

// Delete asset page (any page, including default pages)
app.delete('/api/cloudops/assets/pages/:id', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.id, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const result = await pool.query('DELETE FROM cloudops_asset_pages WHERE id = $1 RETURNING id', [pageId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }
    res.json({ message: 'Page deleted successfully' });
  } catch (err) {
    console.error('Failed to delete asset page:', err);
    res.status(500).json({ message: 'Failed to delete asset page' });
  }
});

// ============================================================
// ASSET PAGE COLUMNS API
// ============================================================

// Add column to page
app.post('/api/cloudops/assets/pages/:pageId/columns', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const pageCheck = await pool.query('SELECT is_system_page FROM cloudops_asset_pages WHERE id = $1', [pageId]);
    if (pageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }

    const { name, display_name, data_type, is_required, default_value, select_options, validation_regex, is_visible } = req.body || {};
    if (!name || !name.trim() || !display_name || !display_name.trim()) {
      return res.status(400).json({ message: 'Column name and display name are required' });
    }

    // Get max column_order
    const orderResult = await pool.query('SELECT COALESCE(MAX(column_order), 0) + 1 AS next_order FROM cloudops_asset_page_columns WHERE page_id = $1', [pageId]);
    const nextOrder = parseInt(orderResult.rows[0]?.next_order || '1', 10);

    const result = await pool.query(
      `INSERT INTO cloudops_asset_page_columns (page_id, name, display_name, data_type, column_order, is_required, default_value, select_options, validation_regex, is_visible, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11) RETURNING *`,
      [
        pageId,
        name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'),
        display_name.trim(),
        data_type || 'text',
        nextOrder,
        is_required || false,
        default_value || null,
        select_options ? JSON.stringify(select_options) : null,
        validation_regex || null,
        is_visible !== false,
        (req.user?.email || '').toLowerCase()
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to add column:', err);
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Column name already exists in this page' });
    }
    res.status(500).json({ message: 'Failed to add column' });
  }
});

// Update column
app.put('/api/cloudops/assets/pages/:pageId/columns/:columnId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    const columnId = parseInt(req.params.columnId, 10);
    if (!Number.isInteger(pageId) || !Number.isInteger(columnId)) {
      return res.status(400).json({ message: 'Invalid page or column id' });
    }

    const pageCheck = await pool.query('SELECT is_system_page FROM cloudops_asset_pages WHERE id = $1', [pageId]);
    if (pageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }
    // Allow updating columns on system pages, but not deleting system columns (handled in delete)

    const { display_name, data_type, is_required, default_value, select_options, validation_regex, is_visible, column_order } = req.body || {};
    if (!display_name || !display_name.trim()) {
      return res.status(400).json({ message: 'Display name is required' });
    }

    const result = await pool.query(
      `UPDATE cloudops_asset_page_columns SET
         display_name = $1, data_type = $2, is_required = $3,
         default_value = $4, select_options = $5, validation_regex = $6,
         is_visible = $7, column_order = $8,
         updated_by = $9, updated_at = NOW()
       WHERE id = $10 AND page_id = $11 RETURNING *`,
      [
        display_name.trim(),
        data_type || 'text',
        is_required || false,
        default_value || null,
        select_options ? JSON.stringify(select_options) : null,
        validation_regex || null,
        is_visible !== false,
        column_order || 0,
        (req.user?.email || '').toLowerCase(),
        columnId,
        pageId
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Column not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update column:', err);
    res.status(500).json({ message: 'Failed to update column' });
  }
});

// Delete column
app.delete('/api/cloudops/assets/pages/:pageId/columns/:columnId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    const columnId = parseInt(req.params.columnId, 10);
    if (!Number.isInteger(pageId) || !Number.isInteger(columnId)) {
      return res.status(400).json({ message: 'Invalid page or column id' });
    }

    const pageCheck = await pool.query('SELECT is_system_page FROM cloudops_asset_pages WHERE id = $1', [pageId]);
    if (pageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }

    // Check if column belongs to system page and is a system column
    // We'll allow deleting custom columns on system pages but not system columns
    // For simplicity, we'll just check if page is system - allow deletion of any column
    // but in production you might want to track which columns are system-defined

    const result = await pool.query(
      'DELETE FROM cloudops_asset_page_columns WHERE id = $1 AND page_id = $2 RETURNING id',
      [columnId, pageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Column not found' });
    }
    res.json({ message: 'Column deleted successfully' });
  } catch (err) {
    console.error('Failed to delete column:', err);
    res.status(500).json({ message: 'Failed to delete column' });
  }
});

// Reorder columns
app.put('/api/cloudops/assets/pages/:pageId/columns/reorder', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const { columnIds } = req.body || {};
    if (!Array.isArray(columnIds)) {
      return res.status(400).json({ message: 'columnIds array is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (let i = 0; i < columnIds.length; i++) {
        await client.query(
          'UPDATE cloudops_asset_page_columns SET column_order = $1, updated_at = NOW() WHERE id = $2 AND page_id = $3',
          [i + 1, columnIds[i], pageId]
        );
      }
      
      await client.query('COMMIT');
      res.json({ message: 'Columns reordered successfully' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to reorder columns:', err);
    res.status(500).json({ message: 'Failed to reorder columns' });
  }
});

// ============================================================
// ASSET PAGE ROWS API
// ============================================================

// Get rows for a page (with pagination)
app.get('/api/cloudops/assets/pages/:pageId/rows', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
    const offset = parseInt(req.query.offset || '0', 10);

    const result = await pool.query(`
      SELECT * FROM cloudops_asset_page_rows 
      WHERE page_id = $1 
      ORDER BY row_order ASC, created_at ASC
      LIMIT $2 OFFSET $3
    `, [pageId, limit, offset]);

    const countResult = await pool.query('SELECT COUNT(*)::int AS total FROM cloudops_asset_page_rows WHERE page_id = $1', [pageId]);

    res.json({
      rows: result.rows,
      total: countResult.rows[0]?.total || 0,
      limit,
      offset
    });
  } catch (err) {
    console.error('Failed to fetch rows:', err);
    res.status(500).json({ message: 'Failed to fetch rows' });
  }
});

// Create row
app.post('/api/cloudops/assets/pages/:pageId/rows', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const pageCheck = await pool.query('SELECT id FROM cloudops_asset_pages WHERE id = $1', [pageId]);
    if (pageCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Page not found' });
    }

    const { row_data, row_order } = req.body || {};
    if (!row_data || typeof row_data !== 'object') {
      return res.status(400).json({ message: 'Row data is required' });
    }

    // Get max row_order if not provided
    let order = row_order;
    if (order === undefined || order === null) {
      const orderResult = await pool.query('SELECT COALESCE(MAX(row_order), 0) + 1 AS next_order FROM cloudops_asset_page_rows WHERE page_id = $1', [pageId]);
      order = parseInt(orderResult.rows[0]?.next_order || '1', 10);
    }

    const result = await pool.query(
      `INSERT INTO cloudops_asset_page_rows (page_id, row_data, row_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4) RETURNING *`,
      [pageId, JSON.stringify(row_data), order, (req.user?.email || '').toLowerCase()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Failed to create row:', err);
    res.status(500).json({ message: 'Failed to create row' });
  }
});

// Update row
app.put('/api/cloudops/assets/pages/:pageId/rows/:rowId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    const rowId = parseInt(req.params.rowId, 10);
    if (!Number.isInteger(pageId) || !Number.isInteger(rowId)) {
      return res.status(400).json({ message: 'Invalid page or row id' });
    }

    const { row_data, row_order } = req.body || {};
    if (!row_data || typeof row_data !== 'object') {
      return res.status(400).json({ message: 'Row data is required' });
    }

    const result = await pool.query(
      `UPDATE cloudops_asset_page_rows SET
         row_data = $1, row_order = $2,
         updated_by = $3, updated_at = NOW()
       WHERE id = $4 AND page_id = $5 RETURNING *`,
      [JSON.stringify(row_data), row_order || 0, (req.user?.email || '').toLowerCase(), rowId, pageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Row not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Failed to update row:', err);
    res.status(500).json({ message: 'Failed to update row' });
  }
});

// Delete row
app.delete('/api/cloudops/assets/pages/:pageId/rows/:rowId', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    const rowId = parseInt(req.params.rowId, 10);
    if (!Number.isInteger(pageId) || !Number.isInteger(rowId)) {
      return res.status(400).json({ message: 'Invalid page or row id' });
    }

    const result = await pool.query(
      'DELETE FROM cloudops_asset_page_rows WHERE id = $1 AND page_id = $2 RETURNING id',
      [rowId, pageId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Row not found' });
    }
    res.json({ message: 'Row deleted successfully' });
  } catch (err) {
    console.error('Failed to delete row:', err);
    res.status(500).json({ message: 'Failed to delete row' });
  }
});

// Bulk delete rows
app.delete('/api/cloudops/assets/pages/:pageId/rows', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const { rowIds } = req.body || {};
    if (!Array.isArray(rowIds) || rowIds.length === 0) {
      return res.status(400).json({ message: 'rowIds array is required' });
    }

    const placeholders = rowIds.map((_, i) => `$${i + 2}`).join(',');
    const result = await pool.query(
      `DELETE FROM cloudops_asset_page_rows WHERE page_id = $1 AND id IN (${placeholders})`,
      [pageId, ...rowIds]
    );

    res.json({ message: `${result.rowCount} rows deleted successfully` });
  } catch (err) {
    console.error('Failed to bulk delete rows:', err);
    res.status(500).json({ message: 'Failed to bulk delete rows' });
  }
});

// Reorder rows
app.put('/api/cloudops/assets/pages/:pageId/rows/reorder', authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const pageId = parseInt(req.params.pageId, 10);
    if (!Number.isInteger(pageId)) {
      return res.status(400).json({ message: 'Invalid page id' });
    }

    const { rowIds } = req.body || {};
    if (!Array.isArray(rowIds)) {
      return res.status(400).json({ message: 'rowIds array is required' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      for (let i = 0; i < rowIds.length; i++) {
        await client.query(
          'UPDATE cloudops_asset_page_rows SET row_order = $1, updated_at = NOW() WHERE id = $2 AND page_id = $3',
          [i + 1, rowIds[i], pageId]
        );
      }
      
      await client.query('COMMIT');
      res.json({ message: 'Rows reordered successfully' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Failed to reorder rows:', err);
    res.status(500).json({ message: 'Failed to reorder rows' });
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


















// // server.js
// require("dotenv").config();

// const express = require("express");
// const fetch = require("node-fetch");
// const crypto = require("crypto");
// const path = require("path");
// const { execFile } = require('child_process');
// const bodyParser = require("body-parser");
// const cors = require("cors");
// const compression = require("compression");
// const fs = require("fs");
// const multer = require("multer");
// const FormData = require("form-data");
// const bcrypt = require("bcrypt");
// const jwt = require("jsonwebtoken");
// const pool = require("./db");

// const app = express();
// const PORT = process.env.PORT || 3000;
// const upload = multer({ storage: multer.memoryStorage() });
// const NODE_ID = process.env.HOSTNAME || 'local-node';

// // ===============================
// // Middleware
// // ===============================
// app.use(cors());
// app.use(compression()); // 🚀 Enable gzip compression for responses
// app.use(express.json());
// app.use(bodyParser.json());

// // 🚀 Production: Smart caching headers
// app.use((req, res, next) => {
//   res.set('X-ITSM-Node', NODE_ID);
//   // Static assets: 1 year (immutable)
//   if (req.url.match(/\.(js|css|woff|woff2|ttf|eot|svg)$/i)) {
//     res.set('Cache-Control', 'public, max-age=31536000, immutable');
//   }
//   // API responses: use cache-control from individual endpoints
//   // HTML: no cache
//   else if (!req.url.startsWith('/api/')) {
//     res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
//   }
//   next();
// });

// // 🏥 Health check
// app.get('/api/health', (req, res) => {
//   res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// // ------------------------
// // DB Connection + Auto Migration
// // ------------------------
// async function runMigrations() {
//   try {
//     // Create ticket_assignments table if not exists
//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS ticket_assignments (
//         id SERIAL PRIMARY KEY,
//         zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
//         zoho_ticket_number VARCHAR(50),
//         zoho_department_id VARCHAR(50),
//         assigned_users TEXT[] NOT NULL DEFAULT '{}',
//         primary_assignee VARCHAR(255) NOT NULL,
//         assigned_by VARCHAR(255) NOT NULL,
//         assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         reassigned_user VARCHAR(255),
//         reassigned_at TIMESTAMP WITH TIME ZONE,
//         reassigned_by VARCHAR(255),
//         status VARCHAR(50) NOT NULL DEFAULT 'Open',
//         closed_at TIMESTAMP WITH TIME ZONE,
//         closed_by VARCHAR(255),
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
//       )
//     `);
    
//     // Add category column if not exists
//     await pool.query(`
//       ALTER TABLE ticket_assignments 
//       ADD COLUMN IF NOT EXISTS category VARCHAR(255)
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS ihub_assets (
//         id SERIAL PRIMARY KEY,
//         client VARCHAR(255) NOT NULL,
//         environment VARCHAR(100) NOT NULL,
//         hostname VARCHAR(255) NOT NULL,
//         ip_address VARCHAR(100) NOT NULL,
//         ihub_version VARCHAR(100),
//         license_expiry DATE NOT NULL,
//         responsible_person_email VARCHAR(255) NOT NULL,
//         responsible_person_name VARCHAR(255),
//         created_by VARCHAR(255),
//         updated_by VARCHAR(255),
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS ihub_alert_tickets (
//         id SERIAL PRIMARY KEY,
//         ihub_asset_id INTEGER NOT NULL REFERENCES ihub_assets(id) ON DELETE CASCADE,
//         milestone_days INTEGER NOT NULL,
//         license_expiry_on DATE NOT NULL,
//         zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
//         zoho_ticket_number VARCHAR(50),
//         status VARCHAR(50) NOT NULL DEFAULT 'Open',
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         closed_at TIMESTAMP WITH TIME ZONE,
//         UNIQUE (ihub_asset_id, milestone_days, license_expiry_on)
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS ssl_assets (
//         id SERIAL PRIMARY KEY,
//         client VARCHAR(255) NOT NULL,
//         environment VARCHAR(100) NOT NULL,
//         hostname VARCHAR(255) NOT NULL,
//         ip_address VARCHAR(100) NOT NULL,
//         application VARCHAR(255) NOT NULL,
//         version VARCHAR(100),
//         ssl_url TEXT NOT NULL,
//         responsible_person_email VARCHAR(255) NOT NULL,
//         responsible_person_name VARCHAR(255),
//         ssl_expiry DATE NOT NULL,
//         created_by VARCHAR(255),
//         updated_by VARCHAR(255),
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS ssl_expiry_alert_tickets (
//         id SERIAL PRIMARY KEY,
//         ssl_asset_id INTEGER NOT NULL REFERENCES ssl_assets(id) ON DELETE CASCADE,
//         milestone_days INTEGER NOT NULL,
//         ssl_expiry_on DATE NOT NULL,
//         zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
//         zoho_ticket_number VARCHAR(50),
//         status VARCHAR(50) NOT NULL DEFAULT 'Open',
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         closed_at TIMESTAMP WITH TIME ZONE,
//         UNIQUE (ssl_asset_id, milestone_days, ssl_expiry_on)
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS alertmanager_ssl_tickets (
//         id SERIAL PRIMARY KEY,
//         alert_fingerprint VARCHAR(255) NOT NULL UNIQUE,
//         alertname VARCHAR(255),
//         milestone_days INTEGER NOT NULL,
//         client VARCHAR(255),
//         environment VARCHAR(100),
//         application VARCHAR(255),
//         instance TEXT,
//         responsible VARCHAR(255),
//         responsible_email VARCHAR(255),
//         zoho_ticket_id VARCHAR(50) UNIQUE,
//         zoho_ticket_number VARCHAR(50),
//         status VARCHAR(50) NOT NULL DEFAULT 'Open',
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         closed_at TIMESTAMP WITH TIME ZONE
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS recycled_tickets (
//         id SERIAL PRIMARY KEY,
//         zoho_ticket_id VARCHAR(50) NOT NULL UNIQUE,
//         zoho_ticket_number VARCHAR(50),
//         subject TEXT,
//         email VARCHAR(255),
//         priority VARCHAR(100),
//         deleted_by VARCHAR(255) NOT NULL,
//         deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
//         restored_at TIMESTAMP WITH TIME ZONE,
//         snapshot JSONB,
//         created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
//       )
//     `);

//     // Optional SSL fields should be nullable/optional in API usage.
//     await pool.query(`
//       ALTER TABLE ssl_assets
//       ALTER COLUMN hostname DROP NOT NULL,
//       ALTER COLUMN ip_address DROP NOT NULL,
//       ALTER COLUMN application DROP NOT NULL
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS reply_authors (
//         id SERIAL PRIMARY KEY,
//         zoho_ticket_id TEXT NOT NULL,
//         zoho_conversation_id TEXT NOT NULL UNIQUE,
//         user_email TEXT NOT NULL,
//         user_name TEXT NOT NULL,
//         created_at TIMESTAMPTZ DEFAULT NOW()
//       )
//     `);
//     await pool.query(`CREATE INDEX IF NOT EXISTS idx_reply_authors_ticket ON reply_authors(zoho_ticket_id)`);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS user_role_bindings (
//         id SERIAL PRIMARY KEY,
//         microsoft_email VARCHAR(255) NOT NULL UNIQUE,
//         roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
//         assigned_by VARCHAR(255),
//         notes TEXT,
//         assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
//       )
//     `);
//     await pool.query(`CREATE INDEX IF NOT EXISTS idx_user_role_bindings_email ON user_role_bindings(microsoft_email)`);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS group_role_bindings (
//         id SERIAL PRIMARY KEY,
//         group_identifier VARCHAR(255) NOT NULL UNIQUE,
//         roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
//         assigned_by VARCHAR(255),
//         notes TEXT,
//         assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
//       )
//     `);
//     await pool.query(`CREATE INDEX IF NOT EXISTS idx_group_role_bindings_identifier ON group_role_bindings(group_identifier)`);

//     // Seed test account with all roles for profile role-switch validation.
//     await pool.query(
//       `INSERT INTO user_role_bindings (microsoft_email, roles, assigned_by, notes, assigned_at, updated_at)
//        VALUES ($1, $2::text[], $3, $4, NOW(), NOW())
//        ON CONFLICT (microsoft_email)
//        DO UPDATE SET
//          roles = EXCLUDED.roles,
//          assigned_by = EXCLUDED.assigned_by,
//          notes = EXCLUDED.notes,
//          updated_at = NOW()`,
//       [
//         'automation.cloudops@muraai.com',
//         ['admin', 'cloudops', 'itsm', 'product', 'hr', 'support', 'muraai'],
//         'system-seed',
//         'Seeded all roles for testing role switching'
//       ]
//     );

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS monitoring_devices (
//         device_id VARCHAR(100) PRIMARY KEY,
//         hostname VARCHAR(200) NOT NULL,
//         user_name VARCHAR(200),
//         user_email VARCHAR(200),
//         ip_address VARCHAR(50),
//         os_name VARCHAR(200),
//         os_version VARCHAR(100),
//         os_build VARCHAR(50),
//         last_seen TIMESTAMPTZ,
//         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS monitoring_telemetry (
//         id SERIAL PRIMARY KEY,
//         device_id VARCHAR(100) NOT NULL REFERENCES monitoring_devices(device_id) ON DELETE CASCADE,
//         screen_on BOOLEAN NOT NULL DEFAULT TRUE,
//         screen_on_duration INTEGER NOT NULL DEFAULT 0,
//         active_apps JSONB NOT NULL DEFAULT '[]'::jsonb,
//         all_processes JSONB NOT NULL DEFAULT '[]'::jsonb,
//         cpu_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
//         memory_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
//         disk_percent NUMERIC(6,2) NOT NULL DEFAULT 0,
//         reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE INDEX IF NOT EXISTS idx_monitoring_telemetry_device_time
//         ON monitoring_telemetry (device_id, reported_at DESC)
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS monitoring_azure_resources (
//         resource_id VARCHAR(255) PRIMARY KEY,
//         resource_name VARCHAR(255) NOT NULL,
//         resource_type VARCHAR(255) NOT NULL,
//         status VARCHAR(100) NOT NULL DEFAULT 'Unknown',
//         region VARCHAR(100) NOT NULL DEFAULT 'Unknown',
//         cpu_percent NUMERIC(6,2) DEFAULT 0,
//         memory_percent NUMERIC(6,2) DEFAULT 0,
//         storage_gb NUMERIC(10,2) DEFAULT 0,
//         last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//         owner_email VARCHAR(255) NOT NULL,
//         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE INDEX IF NOT EXISTS idx_monitoring_azure_resources_owner_email
//         ON monitoring_azure_resources (owner_email);
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS monitoring_presence_log (
//         id SERIAL PRIMARY KEY,
//         user_email VARCHAR(255) NOT NULL,
//         user_id VARCHAR(255),
//         activity VARCHAR(50) NOT NULL,
//         timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE INDEX IF NOT EXISTS idx_presence_log_user_date
//         ON monitoring_presence_log (user_email, timestamp DESC)
//     `);

//     await pool.query(`
//       CREATE TABLE IF NOT EXISTS monitoring_intune_devices (
//         device_id VARCHAR(200) PRIMARY KEY,
//         hostname VARCHAR(200) NOT NULL,
//         azure_ad_device_id VARCHAR(200),
//         compliance_state VARCHAR(50),
//         manufacturer VARCHAR(200),
//         model VARCHAR(200),
//         serial_number VARCHAR(200),
//         os_version VARCHAR(100),
//         bitlocker_status VARCHAR(50),
//         ownership VARCHAR(50),
//         last_sync_date TIMESTAMPTZ,
//         enrolled_date TIMESTAMPTZ,
//         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
//       )
//     `);

//     await pool.query(`
//       CREATE INDEX IF NOT EXISTS idx_intune_devices_hostname
//         ON monitoring_intune_devices (hostname)
//     `);

//     // 🚀 Production performance indexes (007). Idempotent.
//     try {
//       await pool.query(`
//         CREATE INDEX IF NOT EXISTS idx_ticket_assignments_status_open
//           ON ticket_assignments (status)
//           WHERE status IS NULL OR LOWER(status) NOT IN ('closed', 'resolved');
//         CREATE INDEX IF NOT EXISTS idx_ticket_assignments_assigned_users_gin
//           ON ticket_assignments USING GIN (assigned_users);
//         CREATE INDEX IF NOT EXISTS idx_ticket_assignments_primary_assignee
//           ON ticket_assignments (primary_assignee);
//         CREATE INDEX IF NOT EXISTS idx_ticket_assignments_zoho_ticket_id
//           ON ticket_assignments (zoho_ticket_id);
//         CREATE INDEX IF NOT EXISTS idx_recycled_tickets_active
//           ON recycled_tickets (zoho_ticket_id) WHERE restored_at IS NULL;
//         CREATE INDEX IF NOT EXISTS idx_reply_authors_conv_id
//           ON reply_authors (zoho_conversation_id);
//         CREATE INDEX IF NOT EXISTS idx_reply_authors_ticket_conv
//           ON reply_authors (zoho_ticket_id, zoho_conversation_id);
//       `);
//     } catch (e) {
//       console.warn('⚠️ Performance index creation warning:', e?.message);
//     }

//     // Drop legacy CHECK constraints that restrict role values to old set.
//     // These constraints block saving cloudops/hr/product/muraai/support roles.
//     try {
//       await pool.query(`ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check`);
//       await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
//     } catch (e) {
//       console.warn('⚠️ Role constraint drop warning:', e?.message);
//     }

//     console.log("✅ Database migrations applied");
//   } catch (err) {
//     console.error("⚠️ Migration warning:", err.message);
//   }
// }

// pool.connect()
//   .then(async () => {
//     console.log("✅ Connected to Supabase DB");
//     await runMigrations();
//   })
//   .catch(err => console.error("❌ DB Connection Failed:", err));

// // =======================================================
// // 🔐 AUTH APIs (ADD BEFORE ALL OTHER ROUTES)
// // =======================================================
// // ---------------------------
// // 🔐 JWT AUTH MIDDLEWARE
// // ---------------------------
// function authenticateToken(req, res, next) {
//   const authHeader = req.headers["authorization"];
//   const token = authHeader && authHeader.split(" ")[1];

//   if (!token) return res.sendStatus(401);

//   jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
//     if (err) return res.sendStatus(403);
//     req.user = user;
//     next();
//   });
// }

// // ===================================
// // Azure Graph API - Send Email Function
// // ===================================
// async function sendEmailViaAzure(fromEmail, toEmail, subject, content, userInfo) {
//   try {
//     let clientId = process.env.CLIENT_ID || process.env.AZURE_CLIENT_ID;
//     let clientSecret = process.env.CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET;
//     let tenantId = process.env.TENANT_ID || process.env.AZURE_TENANT_ID;

//     // Decode TENANT_ID if it's base64 encoded (contains only alphanumeric, +, /, =)
//     if (tenantId && /^[A-Za-z0-9+/=]+$/.test(tenantId) && !tenantId.includes('-')) {
//       try {
//         tenantId = Buffer.from(tenantId, 'base64').toString('utf-8');
//         console.log('[EMAIL] Decoded TENANT_ID from base64');
//       } catch (e) {
//         // Not base64 or decoding failed, use as-is
//       }
//     }

//     console.log(`[EMAIL] Attempting to send email from ${fromEmail} to ${toEmail}`);

//     if (!clientId || !clientSecret || !tenantId) {
//       console.warn('⚠️ Azure credentials not configured. Feedback logged only.');
//       return false;
//     }

//     // Get access token
//     const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
//     console.log(`[EMAIL] Getting Azure token from: ${tokenUrl}`);
    
//     const tokenResponse = await fetch(tokenUrl, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//       body: new URLSearchParams({
//         client_id: clientId,
//         client_secret: clientSecret,
//         scope: 'https://graph.microsoft.com/.default',
//         grant_type: 'client_credentials'
//       })
//     });

//     if (!tokenResponse.ok) {
//       const tokenError = await tokenResponse.text();
//       console.error(`❌ Failed to get Azure token: ${tokenResponse.status}`);
//       console.error(`Token error response:`, tokenError);
//       return false;
//     }

//     const tokenData = await tokenResponse.json();
//     const accessToken = tokenData.access_token;
//     console.log(`[EMAIL] ✅ Got Azure token successfully`);

//     // Send email via Graph API
//     const mailBody = {
//       message: {
//         subject: subject,
//         body: {
//           contentType: "Text",
//           content: content
//         },
//         toRecipients: [{ emailAddress: { address: toEmail } }]
//       },
//       saveToSentItems: true
//     };

//     const graphUrl = `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`;
//     console.log(`[EMAIL] Sending via Graph API: ${graphUrl}`);
    
//     const mailResponse = await fetch(graphUrl, {
//       method: 'POST',
//       headers: {
//         'Authorization': `Bearer ${accessToken}`,
//         'Content-Type': 'application/json'
//       },
//       body: JSON.stringify(mailBody)
//     });

//     if (mailResponse.ok) {
//       console.log(`✅ Email sent via Azure Graph API to ${toEmail}`);
//       return true;
//     } else {
//       const mailError = await mailResponse.text();
//       console.error(`❌ Failed to send email: ${mailResponse.status}`);
//       console.error(`Mail error response:`, mailError);
//       return false;
//     }
//   } catch (error) {
//     console.error('❌ Azure email error:', error?.message || error);
//     console.error('Stack trace:', error?.stack);
//     return false;
//   }
// }
// // ===================================
// // Reusable Graph API token helper
// // ===================================
// async function getGraphToken() {
//   const clientId = process.env.AZURE_CLIENT_ID;
//   const clientSecret = process.env.AZURE_CLIENT_SECRET;
//   let tenantId = process.env.AZURE_TENANT_ID;

//   if (tenantId && /^[A-Za-z0-9+/=]+$/.test(tenantId) && !tenantId.includes('-')) {
//     try { tenantId = Buffer.from(tenantId, 'base64').toString('utf-8'); } catch (e) { }
//   }

//   if (!clientId || !clientSecret || !tenantId) {
//     throw new Error('Azure credentials not configured');
//   }

//   const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
//   const response = await fetch(tokenUrl, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: new URLSearchParams({
//       client_id: clientId,
//       client_secret: clientSecret,
//       scope: 'https://graph.microsoft.com/.default',
//       grant_type: 'client_credentials'
//     })
//   });

//   if (!response.ok) {
//     throw new Error(`Graph token failed: ${response.status} ${await response.text()}`);
//   }

//   const data = await response.json();
//   return data.access_token;
// }

// // ---------------------------
// // 🔐 ADMIN ROLE MIDDLEWARE
// // ---------------------------
// function authorizeAdmin(req, res, next) {
//   const role = req.user.role;
//   if (role !== "admin" && role !== "cloudops") {
//     return res.status(403).json({ message: "Admin only access" });
//   }
//   next();
// }

// const ELEVATED_ROLES = new Set(['admin', 'cloudops', 'product', 'hr', 'support', 'muraai']);
// function authorizeElevated(req, res, next) {
//   const role = (req.user?.role || '').toLowerCase();
//   if (!ELEVATED_ROLES.has(role)) {
//     return res.status(403).json({ message: 'Elevated role required' });
//   }
//   next();
// }

// function parseJsonArray(value) {
//   if (Array.isArray(value)) return value;
//   if (typeof value === 'string' && value.trim()) {
//     try {
//       const parsed = JSON.parse(value);
//       return Array.isArray(parsed) ? parsed : [];
//     } catch {
//       return [];
//     }
//   }
//   return [];
// }

// function toNumber(value, fallback = 0) {
//   const parsed = Number(value);
//   return Number.isFinite(parsed) ? parsed : fallback;
// }

// function normalizeDeviceRow(row) {
//   return {
//     ...row,
//     active_apps: parseJsonArray(row.active_apps),
//     all_processes: parseJsonArray(row.all_processes),
//     cpu_percent: toNumber(row.cpu_percent),
//     memory_percent: toNumber(row.memory_percent),
//     disk_percent: toNumber(row.disk_percent)
//   };
// }

// function canUseMonitoringKey() {
//   return Boolean(process.env.MONITORING_API_KEY);
// }

// function validateMonitoringKey(req, res, next) {
//   if (!canUseMonitoringKey()) {
//     return next();
//   }

//   const key = String(req.headers['x-monitoring-key'] || '');
//   if (key !== process.env.MONITORING_API_KEY) {
//     return res.status(401).json({ message: 'Unauthorized' });
//   }

//   next();
// }

// app.post('/api/monitoring/telemetry', validateMonitoringKey, async (req, res) => {
//   try {
//     const {
//       device_id,
//       hostname,
//       user_name,
//       user_email,
//       ip_address,
//       os_name,
//       os_version,
//       os_build,
//       screen_on,
//       screen_on_duration,
//       active_apps,
//       all_processes,
//       cpu_percent,
//       memory_percent,
//       disk_percent,
//       reported_at
//     } = req.body || {};

//     if (!device_id || !hostname) {
//       return res.status(400).json({ message: 'device_id and hostname are required' });
//     }

//     const normalizedActiveApps = parseJsonArray(active_apps);
//     const normalizedAllProcesses = parseJsonArray(all_processes);
//     const reportedAt = reported_at ? new Date(reported_at) : new Date();

//     await pool.query(`
//       INSERT INTO monitoring_devices (
//         device_id, hostname, user_name, user_email, ip_address, os_name, os_version, os_build, last_seen, updated_at
//       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
//       ON CONFLICT (device_id) DO UPDATE SET
//         hostname = EXCLUDED.hostname,
//         user_name = EXCLUDED.user_name,
//         user_email = EXCLUDED.user_email,
//         ip_address = EXCLUDED.ip_address,
//         os_name = EXCLUDED.os_name,
//         os_version = EXCLUDED.os_version,
//         os_build = EXCLUDED.os_build,
//         last_seen = EXCLUDED.last_seen,
//         updated_at = NOW()
//     `, [
//       device_id,
//       hostname,
//       user_name || null,
//       user_email || null,
//       ip_address || null,
//       os_name || null,
//       os_version || null,
//       os_build || null,
//       reportedAt
//     ]);

//     await pool.query(`
//       INSERT INTO monitoring_telemetry (
//         device_id, screen_on, screen_on_duration, active_apps, all_processes,
//         cpu_percent, memory_percent, disk_percent, reported_at
//       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
//     `, [
//       device_id,
//       Boolean(screen_on),
//       toNumber(screen_on_duration),
//       JSON.stringify(normalizedActiveApps),
//       JSON.stringify(normalizedAllProcesses),
//       toNumber(cpu_percent),
//       toNumber(memory_percent),
//       toNumber(disk_percent),
//       reportedAt
//     ]);

//     res.json({ status: 'ok' });
//   } catch (err) {
//     console.error('Monitoring telemetry error:', err);
//     res.status(500).json({ message: 'Failed to save telemetry' });
//   }
// });

// app.get('/api/monitoring/devices', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT
//         d.device_id,
//         d.hostname,
//         d.user_name,
//         d.user_email,
//         d.ip_address,
//         d.os_name,
//         d.os_version,
//         d.os_build,
//         d.last_seen,
//         t.screen_on,
//         t.screen_on_duration,
//         t.active_apps,
//         t.all_processes,
//         t.cpu_percent,
//         t.memory_percent,
//         t.disk_percent,
//         t.reported_at
//       FROM monitoring_devices d
//       LEFT JOIN LATERAL (
//         SELECT *
//         FROM monitoring_telemetry t
//         WHERE t.device_id = d.device_id
//         ORDER BY t.reported_at DESC, t.id DESC
//         LIMIT 1
//       ) t ON true
//       ORDER BY d.last_seen DESC NULLS LAST, d.hostname ASC
//     `);

//     res.json(result.rows.map(normalizeDeviceRow));
//   } catch (err) {
//     console.error('Monitoring devices error:', err);
//     res.status(500).json({ message: 'Failed to fetch devices' });
//   }
// });

// app.get('/api/monitoring/devices/:deviceId/history', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT
//         id,
//         device_id,
//         screen_on,
//         screen_on_duration,
//         active_apps,
//         all_processes,
//         cpu_percent,
//         memory_percent,
//         disk_percent,
//         reported_at,
//         created_at
//       FROM monitoring_telemetry
//       WHERE device_id = $1
//       ORDER BY reported_at DESC, id DESC
//       LIMIT 100
//     `, [req.params.deviceId]);

//     res.json(result.rows.map(normalizeDeviceRow));
//   } catch (err) {
//     console.error('Monitoring history error:', err);
//     res.status(500).json({ message: 'Failed to fetch history' });
//   }
// });

// app.get('/api/monitoring/assets', authenticateToken, async (req, res) => {
//   try {
//     const queryEmail = (req.query.userEmail || '').toString().trim().toLowerCase();
//     const effectiveEmail = req.user?.email?.toString().toLowerCase() || '';
//     const targetEmail = req.user?.role === 'admin' && queryEmail ? queryEmail : effectiveEmail;

//     if (!targetEmail) {
//       return res.status(400).json({ message: 'User email is required' });
//     }

//     // Get latest telemetry per device
//     const result = await pool.query(`
//       SELECT
//         d.device_id,
//         d.hostname,
//         d.user_name,
//         d.user_email,
//         d.ip_address,
//         d.os_name,
//         d.os_version,
//         d.os_build,
//         d.last_seen,
//         d.updated_at,
//         t.cpu_percent,
//         t.memory_percent,
//         t.disk_percent,
//         t.reported_at
//       FROM monitoring_devices d
//       LEFT JOIN LATERAL (
//         SELECT cpu_percent, memory_percent, disk_percent, reported_at
//         FROM monitoring_telemetry t
//         WHERE t.device_id = d.device_id
//         ORDER BY t.reported_at DESC, t.id DESC
//         LIMIT 1
//       ) t ON true
//       WHERE LOWER(d.user_email) = $1
//       ORDER BY d.last_seen DESC NULLS LAST, d.hostname ASC
//     `, [targetEmail]);

//     // Get current Teams presence for this user
//     const presenceResult = await pool.query(`
//       SELECT activity, timestamp FROM monitoring_presence_log
//       WHERE LOWER(user_email) = $1
//       ORDER BY timestamp DESC
//       LIMIT 1
//     `, [targetEmail]);

//     const currentPresence = presenceResult.rows.length > 0
//       ? presenceResult.rows[0].activity
//       : null;

//     // Get daily activity (last 5 days)
//     const activityResult = await pool.query(`
//       SELECT
//         DATE(timestamp AT TIME ZONE 'UTC') as date,
//         activity,
//         COUNT(*) as samples
//       FROM monitoring_presence_log
//       WHERE LOWER(user_email) = $1
//         AND timestamp >= NOW() - INTERVAL '5 days'
//       GROUP BY DATE(timestamp AT TIME ZONE 'UTC'), activity
//       ORDER BY date DESC, activity
//     `, [targetEmail]);

//     // Build daily activity breakdown
//     const dailyMap = new Map();
//     for (const row of activityResult.rows) {
//       const dateKey = row.date instanceof Date ? row.date.toISOString().split('T')[0] : String(row.date).split('T')[0];
//       if (!dailyMap.has(dateKey)) {
//         dailyMap.set(dateKey, {
//           date: dateKey,
//           availableHours: 0, awayHours: 0, inCallHours: 0,
//           inMeetingHours: 0, doNotDisturbHours: 0, offlineHours: 0
//         });
//       }
//       const day = dailyMap.get(dateKey);
//       const activity = (row.activity || '').toLowerCase();
//       const hours = Math.round((Number(row.samples) || 0) * 0.25 * 10) / 10;
//       if (activity === 'available' || activity === 'availableidle') day.availableHours += hours;
//       else if (activity === 'away' || activity === 'berightback' || activity === 'offwork') day.awayHours += hours;
//       else if (activity === 'inacall' || activity === 'inaconferencecall') day.inCallHours += hours;
//       else if (activity === 'inameeting') day.inMeetingHours += hours;
//       else if (activity === 'donotdisturb' || activity === 'urgentinterruptionsonly') day.doNotDisturbHours += hours;
//       else if (activity === 'offline' || activity === 'presenceunknown' || activity === 'outofoffice') day.offlineHours += hours;
//     }
//     const dailyActivity = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

//     // Get Intune device data merged by hostname
//     const intuneResult = await pool.query(`
//       SELECT hostname, compliance_state, manufacturer, model, serial_number,
//              os_version as intune_os_version, bitlocker_status, ownership, last_sync_date
//       FROM monitoring_intune_devices
//     `);
//     const intuneByHostname = new Map();
//     for (const row of intuneResult.rows) {
//       const key = (row.hostname || '').toLowerCase().trim();
//       if (key) intuneByHostname.set(key, row);
//     }

//     const rows = result.rows.map(row => {
//       const hostnameLower = (row.hostname || '').toLowerCase().trim();
//       const intune = intuneByHostname.get(hostnameLower) || null;

//       return {
//         asset_id: row.device_id,
//         hostname: row.hostname,
//         owner_email: row.user_email,
//         status: row.last_seen && Date.now() - new Date(row.last_seen).getTime() < 5 * 60 * 1000 ? 'Online' : 'Offline',
//         last_seen: row.last_seen,
//         cpu_percent: Number(row.cpu_percent) || 0,
//         memory_percent: Number(row.memory_percent) || 0,
//         disk_percent: Number(row.disk_percent) || 0,
//         primary_issue: row.cpu_percent > 90 || row.memory_percent > 90 || row.disk_percent > 90 ? 'Resource warning' : 'No issues',
//         teams_presence: currentPresence,
//         daily_activity: dailyActivity,
//         compliance_state: intune?.compliance_state || null,
//         manufacturer: intune?.manufacturer || null,
//         model: intune?.model || null,
//         serial_number: intune?.serial_number || null,
//         intune_os_version: intune?.intune_os_version || null,
//         bitlocker_status: intune?.bitlocker_status || null,
//         ownership: intune?.ownership || null,
//         last_intune_sync: intune?.last_sync_date || null
//       };
//     });

//     res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
//     res.set('Pragma', 'no-cache');
//     res.set('Expires', '0');
//     res.json(rows);
//   } catch (err) {
//     console.error('Monitoring assets error:', err);
//     res.status(500).json({ message: 'Failed to fetch assets' });
//   }
// });

// // ============================================================
// // POST /api/monitoring/presence/sync - Fetch Teams presence for all monitored users
// // ============================================================
// app.post('/api/monitoring/presence/sync', authenticateToken, async (req, res) => {
//   try {
//     const token = await getGraphToken();

//     // Get all unique user emails from monitoring_devices
//     const usersResult = await pool.query(`
//       SELECT DISTINCT LOWER(TRIM(user_email)) as email
//       FROM monitoring_devices
//       WHERE user_email IS NOT NULL AND TRIM(user_email) != ''
//     `);

//     const emails = usersResult.rows.map(r => r.email).filter(Boolean);
//     if (emails.length === 0) {
//       return res.json({ status: 'ok', synced: 0, message: 'No users with devices found' });
//     }

//     // Resolve emails to user IDs via Graph API
//     let synced = 0;
//     for (const email of emails) {
//       try {
//         const userResp = await fetch(
//           `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
//           { headers: { Authorization: `Bearer ${token}` } }
//         );
//         if (!userResp.ok) continue;
//         const userData = await userResp.json();
//         const userId = userData.id;
//         if (!userId) continue;

//         // Get presence for this user
//         const presenceResp = await fetch(
//           `https://graph.microsoft.com/v1.0/users/${userId}/presence`,
//           { headers: { Authorization: `Bearer ${token}` } }
//         );
//         if (!presenceResp.ok) continue;
//         const presence = await presenceResp.json();

//         const activity = presence.activity || 'PresenceUnknown';

//         // Store in presence log
//         await pool.query(`
//           INSERT INTO monitoring_presence_log (user_email, user_id, activity, timestamp)
//           VALUES ($1, $2, $3, NOW())
//         `, [email, userId, activity]);

//         synced++;
//       } catch (e) {
//         console.warn(`[PRESENCE] Failed for ${email}:`, e.message);
//       }
//     }

//     res.json({ status: 'ok', synced, total: emails.length });
//   } catch (err) {
//     console.error('Presence sync error:', err);
//     res.status(500).json({ message: 'Failed to sync presence' });
//   }
// });

// // ============================================================
// // POST /api/monitoring/intune/sync - Fetch Intune managed devices from Graph API
// // ============================================================
// app.post('/api/monitoring/intune/sync', authenticateToken, async (req, res) => {
//   try {
//     const token = await getGraphToken();

//     let url = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select=id,deviceName,azureADDeviceId,complianceState,manufacturer,model,serialNumber,osVersion,encryptionStatus,ownerType,lastSyncDateTime,enrolledDateTime&$top=500';
//     let synced = 0;

//     while (url) {
//       const resp = await fetch(url, {
//         headers: { Authorization: `Bearer ${token}` }
//       });

//       if (!resp.ok) {
//         throw new Error(`Graph API error: ${resp.status} ${await resp.text()}`);
//       }

//       const data = await resp.json();
//       const devices = data.value || [];

//       for (const d of devices) {
//         const hostname = d.deviceName || '';
//         if (!hostname) continue;

//         const bitlockerMap = { 0: 'Unknown', 1: 'Encrypted', 2: 'Not Encrypted', 3: 'Not Supported' };
//         const complianceMap = {
//           'compliant': 'Compliant', 'noncompliant': 'Non-Compliant',
//           'conflict': 'Conflict', 'error': 'Error', 'unknown': 'Unknown',
//           'configmanager': 'ConfigMgr', 'inactive': 'Inactive'
//         };

//         await pool.query(`
//           INSERT INTO monitoring_intune_devices (
//             device_id, hostname, azure_ad_device_id, compliance_state,
//             manufacturer, model, serial_number, os_version,
//             bitlocker_status, ownership, last_sync_date, enrolled_date,
//             updated_at
//           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
//           ON CONFLICT (device_id) DO UPDATE SET
//             hostname = EXCLUDED.hostname,
//             azure_ad_device_id = EXCLUDED.azure_ad_device_id,
//             compliance_state = EXCLUDED.compliance_state,
//             manufacturer = EXCLUDED.manufacturer,
//             model = EXCLUDED.model,
//             serial_number = EXCLUDED.serial_number,
//             os_version = EXCLUDED.os_version,
//             bitlocker_status = EXCLUDED.bitlocker_status,
//             ownership = EXCLUDED.ownership,
//             last_sync_date = EXCLUDED.last_sync_date,
//             enrolled_date = EXCLUDED.enrolled_date,
//             updated_at = NOW()
//         `, [
//           d.id,
//           hostname,
//           d.azureADDeviceId || null,
//           complianceMap[(d.complianceState || '').toLowerCase()] || d.complianceState || 'Unknown',
//           d.manufacturer || null,
//           d.model || null,
//           d.serialNumber || null,
//           d.osVersion || null,
//           bitlockerMap[d.encryptionStatus] || 'Unknown',
//           d.ownerType || null,
//           d.lastSyncDateTime ? new Date(d.lastSyncDateTime) : null,
//           d.enrolledDateTime ? new Date(d.enrolledDateTime) : null
//         ]);
//         synced++;
//       }

//       url = data['@odata.nextLink'] || '';
//     }

//     res.json({ status: 'ok', synced });
//   } catch (err) {
//     console.error('Intune sync error:', err);
//     res.status(500).json({ message: 'Failed to sync Intune devices', error: err.message });
//   }
// });

// // ============================================================
// // GET /api/monitoring/intune-devices - List Intune devices (admin)
// // ============================================================
// app.get('/api/monitoring/intune-devices', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(`
//       SELECT * FROM monitoring_intune_devices
//       ORDER BY hostname ASC
//     `);
//     res.json(result.rows);
//   } catch (err) {
//     console.error('Intune devices error:', err);
//     res.status(500).json({ message: 'Failed to fetch Intune devices' });
//   }
// });

// app.get('/api/monitoring/azure', authenticateToken, async (req, res) => {
//   try {
//     const queryEmail = (req.query.userEmail || '').toString().trim().toLowerCase();
//     const effectiveEmail = req.user?.email?.toString().toLowerCase() || '';
//     const targetEmail = queryEmail || effectiveEmail;

//     if (!targetEmail) {
//       return res.status(400).json({ message: 'User email is required' });
//     }

//     const result = await pool.query(`
//       SELECT
//         resource_id,
//         resource_name,
//         resource_type,
//         status,
//         region,
//         cpu_percent,
//         memory_percent,
//         storage_gb,
//         last_updated
//       FROM monitoring_azure_resources
//       WHERE LOWER(owner_email) = $1
//       ORDER BY last_updated DESC
//       LIMIT 200
//     `, [targetEmail]);

//     res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
//     res.set('Pragma', 'no-cache');
//     res.set('Expires', '0');
//     res.json(result.rows.map(row => ({
//       resource_id: row.resource_id,
//       resource_name: row.resource_name,
//       resource_type: row.resource_type,
//       status: row.status,
//       region: row.region,
//       cpu_percent: Number(row.cpu_percent) || 0,
//       memory_percent: Number(row.memory_percent) || 0,
//       storage_gb: Number(row.storage_gb) || 0,
//       last_updated: row.last_updated
//     })));
//   } catch (err) {
//     console.error('Azure monitoring error:', err);
//     res.status(500).json({ message: 'Failed to fetch Azure resources' });
//   }
// });

// // Temporary: Seed sample Azure resources for the authenticated user (dev helper)
// app.post('/api/monitoring/azure/seed', authenticateToken, async (req, res) => {
//   try {
//     const ownerEmail = (req.user?.email || '').toString().toLowerCase();
//     if (!ownerEmail) return res.status(400).json({ message: 'No authenticated user email available' });

//     const samples = [
//       {
//         resource_id: `${ownerEmail}-vm-01`,
//         resource_name: 'Dev-VM-01',
//         resource_type: 'Virtual Machine',
//         status: 'Healthy',
//         region: 'eastus',
//         cpu_percent: 12.5,
//         memory_percent: 34.2,
//         storage_gb: 128
//       },
//       {
//         resource_id: `${ownerEmail}-sqldb-01`,
//         resource_name: 'AppDB-01',
//         resource_type: 'SQL Database',
//         status: 'Healthy',
//         region: 'eastus2',
//         cpu_percent: 5.1,
//         memory_percent: 21.3,
//         storage_gb: 256
//       },
//       {
//         resource_id: `${ownerEmail}-appsvc-01`,
//         resource_name: 'WebApp-01',
//         resource_type: 'App Service',
//         status: 'Warning',
//         region: 'westus',
//         cpu_percent: 78.4,
//         memory_percent: 65.2,
//         storage_gb: 10
//       }
//     ];

//     const client = await pool.connect();
//     try {
//       for (const s of samples) {
//         await client.query(`
//           INSERT INTO monitoring_azure_resources (
//             resource_id, resource_name, resource_type, status, region,
//             cpu_percent, memory_percent, storage_gb, last_updated, owner_email, created_at, updated_at
//           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,NOW(),NOW())
//           ON CONFLICT (resource_id) DO UPDATE SET
//             resource_name = EXCLUDED.resource_name,
//             resource_type = EXCLUDED.resource_type,
//             status = EXCLUDED.status,
//             region = EXCLUDED.region,
//             cpu_percent = EXCLUDED.cpu_percent,
//             memory_percent = EXCLUDED.memory_percent,
//             storage_gb = EXCLUDED.storage_gb,
//             last_updated = NOW(),
//             owner_email = EXCLUDED.owner_email,
//             updated_at = NOW()
//         `, [
//           s.resource_id,
//           s.resource_name,
//           s.resource_type,
//           s.status,
//           s.region,
//           s.cpu_percent,
//           s.memory_percent,
//           s.storage_gb,
//           ownerEmail
//         ]);
//       }
//     } finally {
//       client.release();
//     }

//     res.json({ status: 'ok', inserted: samples.length });
//   } catch (err) {
//     console.error('Seed Azure error:', err);
//     res.status(500).json({ message: 'Failed to seed Azure resources' });
//   }
// });

// app.post('/api/monitoring/assets/seed', authenticateToken, async (req, res) => {
//   try {
//     const ownerEmail = (req.user?.email || '').toString().toLowerCase();
//     if (!ownerEmail) return res.status(400).json({ message: 'No authenticated user email available' });

//     const devices = [
//       { device_id: `${ownerEmail}-laptop-01`, hostname: 'WORK-LAP-001', ip: '192.168.1.101', os: 'Windows', os_ver: '10.0.19045', os_build: '19045', cpu: 23.5, mem: 45.2, disk: 67.8 },
//       { device_id: `${ownerEmail}-laptop-02`, hostname: 'WORK-LAP-002', ip: '192.168.1.102', os: 'Windows', os_ver: '10.0.19045', os_build: '19045', cpu: 78.1, mem: 82.3, disk: 91.2 },
//       { device_id: `${ownerEmail}-desktop-01`, hostname: 'WORK-DSK-001', ip: '192.168.1.201', os: 'Windows', os_ver: '10.0.22631', os_build: '22631', cpu: 12.0, mem: 34.5, disk: 55.0 },
//       { device_id: `${ownerEmail}-laptop-03`, hostname: 'WORK-LAP-003', ip: '192.168.1.103', os: 'Windows', os_ver: '10.0.19045', os_build: '19045', cpu: 95.2, mem: 88.7, disk: 45.3 },
//     ];

//     const client = await pool.connect();
//     try {
//       for (const d of devices) {
//         const now = new Date();
//         const lastSeen = new Date(now.getTime() - Math.floor(Math.random() * 120000));
//         await client.query(`
//           INSERT INTO monitoring_devices (device_id, hostname, user_name, user_email, ip_address, os_name, os_version, os_build, last_seen, created_at, updated_at)
//           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
//           ON CONFLICT (device_id) DO UPDATE SET
//             hostname = EXCLUDED.hostname, user_name = EXCLUDED.user_name, user_email = EXCLUDED.user_email,
//             ip_address = EXCLUDED.ip_address, os_name = EXCLUDED.os_name, os_version = EXCLUDED.os_version,
//             os_build = EXCLUDED.os_build, last_seen = EXCLUDED.last_seen, updated_at = NOW()
//         `, [d.device_id, d.hostname, ownerEmail.split('@')[0], ownerEmail, d.ip, d.os, d.os_ver, d.os_build, lastSeen]);

//         await client.query(`
//           INSERT INTO monitoring_telemetry (device_id, cpu_percent, memory_percent, disk_percent, screen_on, screen_on_duration, active_apps, all_processes, reported_at, created_at)
//           VALUES ($1,$2,$3,$4,TRUE,3600,'[]'::jsonb,'[]'::jsonb,$5,NOW())
//         `, [d.device_id, d.cpu, d.mem, d.disk, lastSeen]);
//       }
//     } finally {
//       client.release();
//     }

//     res.json({ status: 'ok', inserted: devices.length });
//   } catch (err) {
//     console.error('Seed assets error:', err);
//     res.status(500).json({ message: 'Failed to seed assets' });
//   }
// });

// function getGraphToken(req) {
//   return (req.headers["x-graph-token"] || "").toString();
// }
// app.get("/api/users", authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       "SELECT id, email, role FROM users ORDER BY id DESC"
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Failed to fetch users" });
//   }
// });

// // Create User (Admin)
// app.post("/api/users", authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const { email, password, role } = req.body;

//     if (!email || !password || !role) {
//       return res.status(400).json({ message: "Missing fields" });
//     }

//     const existing = await pool.query(
//       "SELECT 1 FROM users WHERE email = $1",
//       [email.toLowerCase()]
//     );

//     if (existing.rows.length > 0) {
//       return res.status(409).json({ message: "Email already exists" });
//     }

//     const hashed = await bcrypt.hash(password, 10);

//     await pool.query(
//       "INSERT INTO users (email, password, role) VALUES ($1, $2, $3)",
//       [email.toLowerCase(), hashed, role]
//     );

//     res.json({ message: "User created successfully" });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "User creation failed" });
//   }
// });


// // Login
// app.post("/api/login", async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     const result = await pool.query(
//       "SELECT * FROM users WHERE email = $1",
//       [email.toLowerCase()]
//     );

//     if (result.rows.length === 0) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }

//     const user = result.rows[0];

//     const valid = await bcrypt.compare(password, user.password);
//     if (!valid) {
//       return res.status(400).json({ message: "Invalid credentials" });
//     }

//     const normalizedRole = normalizeRole(user.role) || 'user';
//     const roles = normalizeRoleList([normalizedRole]);

//     // 🔥 ACCESS TOKEN (1 hour)
//     const accessToken = jwt.sign(
//       { email: user.email, role: normalizedRole, roles },
//       process.env.JWT_SECRET,
//       { expiresIn: "1h" }
//     );

//     // 🔥 REFRESH TOKEN (7 days)
//     const refreshToken = jwt.sign(
//       { email: user.email, role: normalizedRole, roles },
//       process.env.JWT_REFRESH_SECRET,
//       { expiresIn: "7d" }
//     );

//     res.json({
//       accessToken,
//       refreshToken,
//       role: normalizedRole,
//       roles,
//       email: user.email
//     });

//   } catch (err) {
//     res.status(500).json({ error: "Login failed" });
//   }
// });
// // 🔄 Refresh Token API
// app.post("/api/refresh", (req, res) => {
//   const { refreshToken } = req.body;

//   if (!refreshToken) return res.sendStatus(401);

//   jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, user) => {
//     if (err) return res.sendStatus(403);

//     const newAccessToken = jwt.sign(
//       { email: user.email, role: user.role, roles: normalizeRoleList(user.roles || [user.role]) },
//       process.env.JWT_SECRET,
//       { expiresIn: "1h" }
//     );

//     res.json({ accessToken: newAccessToken });
//   });
// });

// app.post('/api/auth/switch-role', authenticateToken, async (req, res) => {
//   try {
//     const requestedRole = normalizeRole(req.body?.role);
//     if (!requestedRole) {
//       return res.status(400).json({ error: 'Invalid role' });
//     }

//     const tokenRoles = normalizeRoleList(req.user?.roles || [req.user?.role]);
//     if (!tokenRoles.includes(requestedRole)) {
//       return res.status(403).json({ error: 'Role is not assigned to this user' });
//     }

//     const email = (req.user?.email || '').toLowerCase();
//     const accessToken = jwt.sign(
//       { email, role: requestedRole, roles: tokenRoles },
//       process.env.JWT_SECRET,
//       { expiresIn: '1h' }
//     );
//     const refreshToken = jwt.sign(
//       { email, role: requestedRole, roles: tokenRoles },
//       process.env.JWT_REFRESH_SECRET,
//       { expiresIn: '7d' }
//     );

//     return res.json({ accessToken, refreshToken, role: requestedRole, roles: tokenRoles });
//   } catch (err) {
//     console.error('Role switch failed:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to switch role' });
//   }
// });



// // ------------------------
// // Environment / Tokens
// // ------------------------
// let ZOHO_OAUTH_TOKEN = '';
// const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
// const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
// const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
// const ZOHO_ORG_ID = process.env.ZOHO_ORG_ID;
// const ZOHO_BASE_URL = process.env.ZOHO_BASE_URL || 'https://desk.zoho.in/api/v1';
// const ENABLE_ZOHO_OUTBOUND = (process.env.ENABLE_ZOHO_OUTBOUND || 'true').toLowerCase() === 'true';
// const ZOHO_ALLOWED_EGRESS_IPS = new Set(
//   (process.env.ZOHO_ALLOWED_EGRESS_IPS || '')
//     .split(',')
//     .map(ip => ip.trim())
//     .filter(Boolean)
// );
// const ZOHO_DEPARTMENT_ID = process.env.ZOHO_DEPARTMENT_ID;
// const ZOHO_ASSIGNEE_ID = process.env.ZOHO_ASSIGNEE_ID;
// const ENABLE_ALERT_JOBS = (process.env.ENABLE_ALERT_JOBS || 'true').toLowerCase() === 'true';
// const IHUB_ALERT_MILESTONES = [30, 15, 7, 3, 1];
// const SSL_ALERT_MILESTONES = [30, 15, 7, 3, 1];
// const AUTOMATION_SSL_ALERT_MILESTONES = [30, 15, 7, 3, 1];
// const AUTOMATION_PROMETHEUS_URL = (process.env.AUTOMATION_PROMETHEUS_URL || '').trim();
// const ALERTMANAGER_WEBHOOK_SECRET = (process.env.ALERTMANAGER_WEBHOOK_SECRET || '').trim();
// const ALERTMANAGER_FALLBACK_EMAIL = (process.env.ALERTMANAGER_FALLBACK_EMAIL || '').trim().toLowerCase();
// const ADMIN_GROUP_MAIL = (process.env.ADMIN_GROUP_MAIL || 'automation.cloudops@muraai.com').trim().toLowerCase();
// const ADMIN_GROUP_NAME = (process.env.ADMIN_GROUP_NAME || 'automation.cloudops').trim().toLowerCase();
// const CLOUDOPS_GROUP_MAIL = (process.env.CLOUDOPS_GROUP_MAIL || 'cloudops@muraai.com').trim().toLowerCase();
// const CLOUDOPS_GROUP_NAME = (process.env.CLOUDOPS_GROUP_NAME || 'cloudops').trim().toLowerCase();

// const DEFAULT_ADMIN_EMAIL_ALLOWLIST = [
//   'ravi.chadaram@muraai.com',
//   'senthil.n@muraai.com',
//   't.balaji@muraai.com',
//   'akash.yadav@muraai.com',
//   'automation.cloudops@muraai.com'
// ];

// const ADMIN_EMAIL_ALLOWLIST = new Set(
//   (process.env.ADMIN_EMAIL_ALLOWLIST || DEFAULT_ADMIN_EMAIL_ALLOWLIST.join(','))
//     .split(',')
//     .map(v => (v || '').trim().toLowerCase())
//     .filter(Boolean)
// );

// function isAllowlistedAdminEmail(email) {
//   return ADMIN_EMAIL_ALLOWLIST.has((email || '').toString().trim().toLowerCase());
// }

// const SUPPORTED_ROLES = ['admin', 'cloudops', 'product', 'hr', 'support', 'muraai', 'user'];
// const DEPARTMENT_ROLE_KEYS = ['itsm', 'product', 'hr', 'support', 'muraai'];
// const ROLE_PRIORITY = ['admin', 'cloudops', 'support', 'product', 'hr', 'muraai', 'user'];

// const DEPARTMENT_IDS = {
//   itsm: (process.env.DEPT_ITSM_ID || '132475000009937630').trim(),
//   support: (process.env.DEPT_SUPPORT_ID || '132475000009948173').trim(),
//   product: (process.env.DEPT_PRODUCT_ID || '132475000009958716').trim(),
//   hr: (process.env.DEPT_HR_ID || '132475000009925079').trim(),
//   muraai: (process.env.DEPT_MURAAI_ID || '132475000000010772').trim()
// };

// function normalizeRole(role) {
//   const v = (role || '').toString().trim().toLowerCase();
//   if (v === 'itsm') return 'cloudops';
//   return SUPPORTED_ROLES.includes(v) ? v : null;
// }

// function parseRoleCsv(value) {
//   return [...new Set(
//     (value || '')
//       .split(',')
//       .map(v => normalizeRole(v))
//       .filter(Boolean)
//   )];
// }

// function parseRoleJson(value, fallback = {}) {
//   try {
//     const parsed = JSON.parse(value || '');
//     return parsed && typeof parsed === 'object' ? parsed : fallback;
//   } catch {
//     return fallback;
//   }
// }

// const DEFAULT_ROLE_GROUPS = {
//   admin: [ADMIN_GROUP_MAIL, ADMIN_GROUP_NAME],
//   cloudops: [CLOUDOPS_GROUP_MAIL, CLOUDOPS_GROUP_NAME, 'itsm@muraai.com', 'itsm'],
//   product: ['product@muraai.com', 'products@muraai.com', 'product', 'products'],
//   hr: ['hr@muraai.com', 'hr'],
//   support: ['support@muraai.com', 'support'],
//   muraai: ['muraai@muraai.com', 'muraai']
// };

// const ROLE_GROUP_MAP = (() => {
//   const fromEnv = parseRoleJson(process.env.ROLE_GROUP_MAP, {});
//   const merged = { ...DEFAULT_ROLE_GROUPS };
//   for (const [role, entries] of Object.entries(fromEnv || {})) {
//     const nr = normalizeRole(role);
//     if (!nr || !Array.isArray(entries)) continue;
//     merged[nr] = entries.map(v => (v || '').toString().trim().toLowerCase()).filter(Boolean);
//   }
//   return merged;
// })();

// function rolesFromGraphGroups(groups = []) {
//   const found = new Set();
//   for (const g of groups) {
//     const values = [g?.mail, g?.displayName, g?.mailNickname]
//       .map(v => (v || '').toString().trim().toLowerCase())
//       .filter(Boolean);
//     for (const role of Object.keys(ROLE_GROUP_MAP)) {
//       const matches = ROLE_GROUP_MAP[role] || [];
//       if (values.some(v => matches.includes(v))) {
//         found.add(role);
//       }
//     }
//   }
//   return [...found];
// }

// function normalizeRoleList(roles, fallbackRole = 'user') {
//   const arr = Array.isArray(roles) ? roles : [];
//   const normalized = arr.map(r => normalizeRole(r)).filter(Boolean);
//   if (!normalized.length) return fallbackRole ? [fallbackRole] : [];
//   return [...new Set(normalized)];
// }

// function pickDefaultRole(roles, preferredRole, fallbackRole = 'user') {
//   const allowed = new Set(normalizeRoleList(roles, fallbackRole));
//   const preferred = normalizeRole(preferredRole);
//   if (preferred && allowed.has(preferred)) return preferred;
//   for (const role of ROLE_PRIORITY) {
//     if (allowed.has(role)) return role;
//   }
//   return fallbackRole;
// }

// function extractTicketDepartmentId(ticket = {}) {
//   return (
//     ticket.departmentId ||
//     ticket.department?.id ||
//     ticket.department?.departmentId ||
//     ticket.departmentIdStr ||
//     ''
//   ).toString();
// }

// function getAllowedDepartmentIdsForRole(role) {
//   const r = normalizeRole(role) || 'user';
//   if (r === 'admin' || r === 'user') return [];
//   if (r === 'cloudops') {
//     return [DEPARTMENT_IDS.itsm];
//   }
//   return DEPARTMENT_IDS[r] ? [DEPARTMENT_IDS[r]] : [];
// }

// function isDepartmentAllowed(ticket, allowedDeptIds = []) {
//   if (!Array.isArray(allowedDeptIds) || allowedDeptIds.length === 0) return true;
//   const tid = extractTicketDepartmentId(ticket);
//   return !!tid && allowedDeptIds.includes(tid);
// }

// let egressIpCache = { value: '', time: 0 };
// const EGRESS_IP_CACHE_MS = 10 * 60 * 1000;
// let egressIpLookupInFlight = null;

// async function getPublicEgressIp(force = false) {
//   const age = Date.now() - egressIpCache.time;
//   if (!force && egressIpCache.value && age < EGRESS_IP_CACHE_MS) {
//     return egressIpCache.value;
//   }

//   if (egressIpLookupInFlight) {
//     return egressIpLookupInFlight;
//   }

//   egressIpLookupInFlight = (async () => {
//     try {
//       const controller = new AbortController();
//       const timer = setTimeout(() => controller.abort(), 4000);
//       const response = await fetch('https://api.ipify.org', { signal: controller.signal });
//       clearTimeout(timer);
//       if (!response.ok) {
//         throw new Error(`ipify returned ${response.status}`);
//       }
//       const ip = (await response.text()).trim();
//       if (ip) {
//         egressIpCache = { value: ip, time: Date.now() };
//       }
//       return egressIpCache.value;
//     } catch (err) {
//       console.error('Failed to resolve public egress IP:', err?.message || err);
//       return egressIpCache.value;
//     } finally {
//       egressIpLookupInFlight = null;
//     }
//   })();

//   return egressIpLookupInFlight;
// }

// function priorityForIhubAndSslMilestone(milestoneDays) {
//   if (milestoneDays === 3 || milestoneDays === 1) return 'SLA';
//   if (milestoneDays === 7) return 'High';
//   return 'Medium';
// }

// function priorityForAutomationSslMilestone(milestoneDays) {
//   if (milestoneDays === 3 || milestoneDays === 1) return 'SLA';
//   if (milestoneDays === 7) return 'High';
//   return 'Medium';
// }

// // ------------------------
// // Serve Angular build
// // ------------------------
// const angularPath = path.join(__dirname, "dist", "ticket-portal");
// const angularBrowserPath = path.join(angularPath, "browser");

// app.use(express.static(angularBrowserPath));
// app.use(express.static(angularPath));

// // ------------------------
// // ZOHO TOKEN REFRESH
// // ------------------------
// async function refreshZohoToken() {
//   if (!ENABLE_ZOHO_OUTBOUND) return;
//   try {
//     const params = new URLSearchParams({
//       refresh_token: REFRESH_TOKEN,
//       client_id: CLIENT_ID,
//       client_secret: CLIENT_SECRET,
//       grant_type: 'refresh_token'
//     });

//     const response = await fetch(
//       `https://accounts.zoho.in/oauth/v2/token?${params}`,
//       { method: 'POST' }
//     );

//     const data = await response.json();

//     if (data.access_token) {
//       ZOHO_OAUTH_TOKEN = `Zoho-oauthtoken ${data.access_token}`;
//     }
//   } catch (err) {
//     // Token refresh failed silently
//   }
// }

// // Refresh token on startup and every 55 minutes
// if (ENABLE_ZOHO_OUTBOUND) {
//   setInterval(refreshZohoToken, 55 * 60 * 1000);
//   refreshZohoToken();
// } else {
//   console.log('[ZOHO OUTBOUND] Disabled (ENABLE_ZOHO_OUTBOUND=false)');
// }

// // Log outbound egress identity at startup for API access-point tracing.
// setTimeout(async () => {
//   if (!ENABLE_ZOHO_OUTBOUND) {
//     console.log('[ZOHO EGRESS] Skipped (outbound disabled)');
//     return;
//   }
//   const ip = await getPublicEgressIp();
//   if (ZOHO_ALLOWED_EGRESS_IPS.size > 0) {
//     const allowed = Array.from(ZOHO_ALLOWED_EGRESS_IPS).join(', ');
//     console.log(`[ZOHO EGRESS] Current public IP=${ip || 'unknown'} | Allowed=${allowed}`);
//   } else {
//     console.log(`[ZOHO EGRESS] Current public IP=${ip || 'unknown'} | Allowlist=disabled`);
//   }
// }, 3000);

// // IHUB/SSL alert processors should run only on designated deployments.
// if (ENABLE_ALERT_JOBS) {
//   // Startup + every 12 hours
//   setTimeout(() => {
//     processIhubAlerts();
//     processSslAlerts();
//     processAutomationSslAlerts();
//   }, 15 * 1000);
//   setInterval(processIhubAlerts, 12 * 60 * 60 * 1000);
//   setInterval(processSslAlerts, 12 * 60 * 60 * 1000);
//   setInterval(processAutomationSslAlerts, 12 * 60 * 60 * 1000);
// } else {
//   console.log('[ALERT JOBS] Disabled (ENABLE_ALERT_JOBS=false)');
// }

// // ------------------------
// // ZOHO API HELPER
// // ------------------------

// // 🚀 Global rate limiter: max 1200 calls/hour (~20/min) to stay well under 85k/day
// const ZOHO_RATE_LIMIT_PER_HOUR = 1200;
// const zohoRateBucket = {
//   tokens: ZOHO_RATE_LIMIT_PER_HOUR,
//   lastRefill: Date.now(),
//   maxTokens: ZOHO_RATE_LIMIT_PER_HOUR,
//   refillRate: ZOHO_RATE_LIMIT_PER_HOUR / 3600000 // tokens per ms
// };

// function zohoRateLimitCheck() {
//   const now = Date.now();
//   const elapsed = now - zohoRateBucket.lastRefill;
//   zohoRateBucket.tokens = Math.min(
//     zohoRateBucket.maxTokens,
//     zohoRateBucket.tokens + elapsed * zohoRateBucket.refillRate
//   );
//   zohoRateBucket.lastRefill = now;

//   if (zohoRateBucket.tokens < 1) {
//     return false; // rate limited
//   }
//   zohoRateBucket.tokens -= 1;
//   return true;
// }

// // Track API usage for observability
// let zohoApiCallCount = 0;
// let zohoApiCallCountResetTime = Date.now();
// function trackZohoApiCall() {
//   const now = Date.now();
//   if (now - zohoApiCallCountResetTime > 3600000) {
//     console.log(`[ZOHO RATE] ${zohoApiCallCount} API calls in last hour`);
//     zohoApiCallCount = 0;
//     zohoApiCallCountResetTime = now;
//   }
//   zohoApiCallCount++;
// }

// async function zohoFetch(endpoint, options = {}) {
//   // Rate limit check — reject if budget exhausted
//   if (!zohoRateLimitCheck()) {
//     console.warn(`[ZOHO RATE LIMIT] Blocked call to ${endpoint} — hourly budget exhausted`);
//     return new Response(
//       JSON.stringify({ error: 'Zoho API rate limit reached. Try again later.', endpoint }),
//       { status: 429, headers: { 'Content-Type': 'application/json' } }
//     );
//   }
//   trackZohoApiCall();

//   if (!ENABLE_ZOHO_OUTBOUND) {
//     return new Response(
//       JSON.stringify({
//         error: 'Zoho outbound is disabled for this deployment',
//         endpoint
//       }),
//       {
//         status: 503,
//         headers: { 'Content-Type': 'application/json' }
//       }
//     );
//   }

//   if (ZOHO_ALLOWED_EGRESS_IPS.size > 0) {
//     const egressIp = await getPublicEgressIp();
//     if (!egressIp || !ZOHO_ALLOWED_EGRESS_IPS.has(egressIp)) {
//       const allowed = Array.from(ZOHO_ALLOWED_EGRESS_IPS).join(', ');
//       console.error(
//         `[ZOHO BLOCKED] egress IP ${egressIp || 'unknown'} is not in allowlist: ${allowed}`
//       );
//       return new Response(
//         JSON.stringify({
//           error: 'Zoho API blocked by egress IP policy',
//           egressIp: egressIp || null,
//           allowedIps: Array.from(ZOHO_ALLOWED_EGRESS_IPS)
//         }),
//         {
//           status: 503,
//           headers: { 'Content-Type': 'application/json' }
//         }
//       );
//     }
//   }

//   if (!ZOHO_OAUTH_TOKEN) {
//     await refreshZohoToken();
//   }

//   const headers = {
//     Authorization: ZOHO_OAUTH_TOKEN,
//     ...(ZOHO_ORG_ID ? { orgId: ZOHO_ORG_ID } : {}),
//     ...(options.headers || {})
//   };

//   const isFormData = options.body instanceof FormData;
//   if (!headers['Content-Type'] && !headers['content-type'] && !isFormData) {
//     headers['Content-Type'] = 'application/json';
//   }

//   const res = await fetch(`${ZOHO_BASE_URL}${endpoint}`, {
//     ...options,
//     headers
//   });

//   if (res.status === 401) {
//     await refreshZohoToken();
//     return zohoFetch(endpoint, options);
//   }

//   return res;
// }

// async function lookupAgentIdByEmail(email) {
//   if (!email) return '';
//   const target = email.trim().toLowerCase();

//   // 🚀 Use cached agents list first to avoid unnecessary Zoho API calls
//   if (agentsCache && Array.isArray(agentsCache) && agentsCache.length > 0) {
//     const cached = agentsCache.find(a => (a.email || '').toLowerCase() === target);
//     if (cached?.id) return cached.id;
//   }

//   // Fallback: paginate Zoho agents API only if cache miss
//   const limit = 100;
//   let from = 0;
//   let hasMore = true;

//   while (hasMore) {
//     const res = await zohoFetch(`/agents?limit=${limit}&from=${from}`);
//     const data = await res.json();
//     const agents = Array.isArray(data?.data) ? data.data : [];

//     const match = agents.find(a => {
//       const agentEmail = (a.email || a.emailId || a.primaryEmail || '').toLowerCase();
//       return agentEmail === target;
//     });

//     if (match?.id) return match.id;

//     hasMore = agents.length === limit;
//     from += limit;
//   }

//   return '';
// }

// function toStartOfDay(dateInput) {
//   const d = new Date(dateInput);
//   return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
// }

// function daysUntilDate(dateInput) {
//   const today = toStartOfDay(new Date());
//   const target = toStartOfDay(dateInput);
//   return Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
// }

// function isValidDateInput(value) {
//   if (!value) return false;
//   const d = new Date(value);
//   return !Number.isNaN(d.getTime());
// }

// function normalizeDateOnly(value) {
//   const d = toStartOfDay(value);
//   return d.toISOString().slice(0, 10);
// }

// function isLikelyEmail(value) {
//   if (!value) return false;
//   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
// }

// function safeTokenEqual(a, b) {
//   const aa = Buffer.from(a || '', 'utf8');
//   const bb = Buffer.from(b || '', 'utf8');
//   if (aa.length !== bb.length) return false;
//   return crypto.timingSafeEqual(aa, bb);
// }

// function isAlertmanagerAuthorized(req) {
//   if (!ALERTMANAGER_WEBHOOK_SECRET) return true;
//   const provided = (req.headers['x-alertmanager-secret'] || '').toString().trim();
//   return safeTokenEqual(provided, ALERTMANAGER_WEBHOOK_SECRET);
// }

// function parseMilestoneDays(alert) {
//   const labels = alert?.labels || {};
//   const annotations = alert?.annotations || {};
//   const fromLabel = parseInt(labels.milestone_days || labels.days_left || '', 10);
//   if (Number.isInteger(fromLabel)) return fromLabel;

//   // Prefer annotation text because some alert names encode technical windows
//   // (e.g., SSLCert_33Days) while summary/description carry business milestones
//   // (30/15/7/3/1 days) used by ticketing.
//   const sources = [
//     annotations.summary || '',
//     annotations.description || '',
//     labels.alertname || ''
//   ];

//   for (const text of sources) {
//     const match = /(?:^|[^\d])(\d{1,3})\s*[_-]?\s*days?(?=$|[^A-Za-z])/i.exec(text);
//     if (match) {
//       const value = parseInt(match[1], 10);
//       if (Number.isInteger(value)) return value;
//     }
//   }

//   return null;
// }

// function buildAlertFingerprint(alert, milestoneDays) {
//   const labels = alert?.labels || {};
//   // Use a fixed alertname so that the scheduled Prometheus job and the
//   // Alertmanager webhook share the same fingerprint namespace for the same
//   // certificate+milestone combination. Without this, each path generates a
//   // different fingerprint (e.g. 'AutomationSSLExpiry' vs 'SSLCert_30Days')
//   // and both create tickets for the same cert — the primary duplicate vector.
//   const raw = [
//     'SSL_ALERT',
//     labels.client || 'unknown-client',
//     labels.instance || labels.target || labels.url || 'unknown-instance',
//     labels.application || 'unknown-app',
//     String(milestoneDays)
//   ].join('|');
//   return crypto.createHash('sha256').update(raw).digest('hex');
// }

// async function fetchAutomationSslMonitoredUrls() {
//   if (!AUTOMATION_PROMETHEUS_URL) {
//     throw new Error('AUTOMATION_PROMETHEUS_URL is not configured');
//   }

//   const diagnostics = {
//     timestamp: new Date().toISOString(),
//     targetsWithProbeSuccess: 0,
//     targetsWithSslMetric: 0,
//     targetsWithoutSslMetric: [],
//     missingMetricDetails: []
//   };

//   const baseUrl = AUTOMATION_PROMETHEUS_URL.replace(/\/$/, '');
//   const queryPrometheus = async (query, errorMessage) => {
//     const url = `${baseUrl}/api/v1/query?query=${encodeURIComponent(query)}`;
//     const response = await fetch(url, { method: 'GET' });
//     const payload = await response.json().catch(() => null);
//     if (!response.ok || payload?.status !== 'success') {
//       throw new Error(errorMessage);
//     }
//     return Array.isArray(payload?.data?.result) ? payload.data.result : [];
//   };

//   // Use probe_success as the baseline so all configured targets are visible,
//   // even when certificate-expiry metric is unavailable for failed probes.
//   const [successRows, expiryRows] = await Promise.all([
//     queryPrometheus('probe_success', 'Failed to fetch probe availability metrics from Prometheus'),
//     queryPrometheus('probe_ssl_earliest_cert_expiry', 'Failed to fetch SSL expiry metrics from Prometheus')
//   ]);

//   const today = toStartOfDay(new Date());
//   diagnostics.targetsWithProbeSuccess = successRows.length;
//   diagnostics.targetsWithSslMetric = expiryRows.length;

//   const keyFromMetric = (metric = {}) => {
//     const instance = (metric.instance || metric.target || '').trim().toLowerCase();
//     const client = (metric.client || '').trim().toLowerCase();
//     const environment = (metric.environment || '').trim().toLowerCase();
//     const application = (metric.application || '').trim().toLowerCase();
//     return [instance, client, environment, application].join('|');
//   };

//   const mappedByKey = new Map();
//   const expiryKeySet = new Set(expiryRows.map(r => keyFromMetric(r?.metric || {})));

//   for (const row of successRows) {
//     const metric = row?.metric || {};
//     const value = Number(Array.isArray(row?.value) ? row.value[1] : NaN);
//     const key = keyFromMetric(metric);

//     if (!expiryKeySet.has(key)) {
//       const instance = (metric.instance || metric.target || '').trim();
//       diagnostics.targetsWithoutSslMetric.push(instance);
//       diagnostics.missingMetricDetails.push({
//         instance,
//         client: (metric.client || '').trim() || 'Unknown',
//         environment: (metric.environment || '').trim() || 'Unknown',
//         application: (metric.application || '').trim() || 'Unknown',
//         probeSuccess: Number.isFinite(value) ? value === 1 : null
//       });
//     }

//     mappedByKey.set(key, {
//       client: (metric.client || '').trim() || 'Unknown',
//       environment: (metric.environment || '').trim() || 'Unknown',
//       application: (metric.application || '').trim() || 'Unknown',
//       ssl_url: (metric.instance || metric.target || '').trim() || '',
//       responsible: (metric.responsible || '').trim() || null,
//       responsible_email: (metric.responsible_email || metric.owner_email || metric.email || '').trim().toLowerCase() || null,
//       hostname: (metric.hostname || '').trim() || null,
//       ip_address: (metric.ip_address || '').trim() || null,
//       version: (metric.version || '').trim() || null,
//       estimated_expiry_on: null,
//       estimated_days_to_expiry: null,
//       metric_value: null,
//       probe_success: Number.isFinite(value) ? value === 1 : null
//     });
//   }

//   for (const row of expiryRows) {
//     const metric = row?.metric || {};
//     const value = Number(Array.isArray(row?.value) ? row.value[1] : NaN);
//     const expiryDate = Number.isFinite(value) ? toStartOfDay(new Date(value * 1000)) : null;
//     const daysToExpiry = expiryDate
//       ? Math.floor((expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
//       : null;
//     const key = keyFromMetric(metric);

//     const existing = mappedByKey.get(key) || {
//       client: (metric.client || '').trim() || 'Unknown',
//       environment: (metric.environment || '').trim() || 'Unknown',
//       application: (metric.application || '').trim() || 'Unknown',
//       ssl_url: (metric.instance || metric.target || '').trim() || '',
//       responsible: (metric.responsible || '').trim() || null,
//       responsible_email: (metric.responsible_email || metric.owner_email || metric.email || '').trim().toLowerCase() || null,
//       hostname: (metric.hostname || '').trim() || null,
//       ip_address: (metric.ip_address || '').trim() || null,
//       version: (metric.version || '').trim() || null,
//       probe_success: null
//     };

//     mappedByKey.set(key, {
//       ...existing,
//       estimated_expiry_on: expiryDate ? expiryDate.toISOString().slice(0, 10) : null,
//       estimated_days_to_expiry: daysToExpiry,
//       metric_value: Number.isFinite(value) ? value : null
//     });
//   }

//   console.log('[Automation SSL] Diagnostics:', JSON.stringify(diagnostics, null, 2));
//   global.lastAutomationSslDiagnostics = diagnostics;

//   return Array.from(mappedByKey.values())
//     .sort((a, b) => {
//       const aDays = Number.isFinite(a.estimated_days_to_expiry) ? a.estimated_days_to_expiry : Number.MAX_SAFE_INTEGER;
//       const bDays = Number.isFinite(b.estimated_days_to_expiry) ? b.estimated_days_to_expiry : Number.MAX_SAFE_INTEGER;
//       if (aDays !== bDays) return aDays - bDays;
//       return (a.client || '').localeCompare(b.client || '');
//     });
// }

// async function processAutomationSslAlerts() {
//   const summary = {
//     scanned: 0,
//     matchedMilestones: 0,
//     created: 0,
//     duplicate: 0,
//     skipped: 0,
//     errors: 0
//   };

//   try {
//     if (!AUTOMATION_PROMETHEUS_URL) {
//       console.warn('[Automation SSL] Skipping alert generation: AUTOMATION_PROMETHEUS_URL is not configured');
//       return {
//         ...summary,
//         skipped: summary.skipped + 1,
//         reason: 'AUTOMATION_PROMETHEUS_URL is not configured'
//       };
//     }

//     const monitoredRows = await fetchAutomationSslMonitoredUrls();
//     summary.scanned = monitoredRows.length;
//     console.log(`[Automation SSL] Processing ${monitoredRows.length} monitored URLs for alert generation...`);

//     for (const row of monitoredRows) {
//       const daysLeft = row.estimated_days_to_expiry;
//       if (!Number.isInteger(daysLeft) || !AUTOMATION_SSL_ALERT_MILESTONES.includes(daysLeft)) {
//         summary.skipped += 1;
//         continue;
//       }
//       summary.matchedMilestones += 1;

//       const instance = (row.ssl_url || row.hostname || '').trim();
//       const alert = {
//         labels: {
//           alertname: 'AutomationSSLExpiry',
//           milestone_days: String(daysLeft),
//           client: row.client || 'Unknown',
//           environment: row.environment || 'Unknown',
//           application: row.application || 'Unknown',
//           instance,
//           responsible: row.responsible || '',
//           responsible_email: row.responsible_email || ''
//         },
//         annotations: {
//           summary: `SSL certificate expires in ${daysLeft} day(s)`,
//           description: `Prometheus milestone detected for ${instance || 'unknown endpoint'}`
//         },
//         startsAt: new Date().toISOString(),
//         generatorURL: AUTOMATION_PROMETHEUS_URL
//       };

//       try {
//         const result = await createAlertmanagerSslTicket(alert, daysLeft);
//         if (result.status === 'created') {
//           summary.created += 1;
//           console.log(`[Automation SSL] Created ticket for ${instance || row.client} at ${daysLeft} day milestone`);
//         } else if (result.status === 'duplicate') {
//           summary.duplicate += 1;
//         } else {
//           summary.skipped += 1;
//         }
//       } catch (err) {
//         summary.errors += 1;
//         console.error(`[Automation SSL] Ticket creation failed for ${instance || row.client}:`, err?.message || err);
//       }
//     }
//     return summary;
//   } catch (err) {
//     summary.errors += 1;
//     console.error('[Automation SSL] Alert processor failed:', err?.message || err);
//     return {
//       ...summary,
//       reason: err?.message || String(err)
//     };
//   }
// }

// async function createAlertmanagerSslTicket(alert, milestoneDays) {
//   const labels = alert?.labels || {};
//   const annotations = alert?.annotations || {};

//   const client = (labels.client || '').trim() || 'Unknown Client';
//   const environment = (labels.environment || '').trim() || 'Unknown';
//   const application = (labels.application || '').trim() || 'Unknown';
//   const instance = (labels.instance || labels.target || labels.url || '').trim() || 'Unknown';
//   const alertname = (labels.alertname || 'SSLCert').trim();
//   const responsible = (labels.responsible || labels.owner || labels.assignee || '').trim();

//   const responsibleCandidates = [
//     labels.responsible_email,
//     labels.owner_email,
//     labels.assignee_email,
//     labels.email,
//     responsible
//   ];
//   const responsibleEmail = responsibleCandidates
//     .map(v => (v || '').toString().trim().toLowerCase())
//     .find(isLikelyEmail) || ALERTMANAGER_FALLBACK_EMAIL;

//   if (!responsibleEmail) {
//     return {
//       status: 'skipped',
//       reason: 'missing responsible email label and fallback email'
//     };
//   }

//   const fingerprint = buildAlertFingerprint(alert, milestoneDays);

//   // Primary dedup: check by normalised fingerprint (alertname-agnostic).
//   // Secondary dedup: check by (instance, milestone_days, client) so that
//   // records created with old fingerprints (before the normalisation change)
//   // still prevent cross-path duplicates.
//   const existing = await pool.query(
//     `SELECT id, status FROM alertmanager_ssl_tickets 
//      WHERE (
//        alert_fingerprint = $1
//        OR (instance = $2 AND milestone_days = $3 AND client = $4)
//      )
//      AND status IN ('Open', 'Pending')
//      ORDER BY id DESC LIMIT 1`,
//     [fingerprint, instance, milestoneDays, client]
//   );
//   if (existing.rows.length > 0) {
//     return { status: 'duplicate', reason: 'already processed' };
//   }

//   // Remove old closed rows that share the fingerprint so the UNIQUE
//   // constraint allows a fresh insert for a renewed certificate.
//   await pool.query(
//     `DELETE FROM alertmanager_ssl_tickets WHERE alert_fingerprint = $1 AND status = 'Closed'`,
//     [fingerprint]
//   );

//   // ON CONFLICT DO NOTHING guards against race conditions where two
//   // concurrent callers (scheduler + webhook) both pass the check above
//   // before either has committed its INSERT.
//   const reservation = await pool.query(
//     `INSERT INTO alertmanager_ssl_tickets
//       (alert_fingerprint, alertname, milestone_days, client, environment, application, instance, responsible, responsible_email, status)
//      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending')
//      ON CONFLICT (alert_fingerprint) DO NOTHING
//      RETURNING id`,
//     [
//       fingerprint,
//       alertname,
//       milestoneDays,
//       client,
//       environment,
//       application,
//       instance,
//       responsible || null,
//       responsibleEmail
//     ]
//   );

//   if (reservation.rows.length === 0) {
//     return { status: 'duplicate', reason: 'already processed' };
//   }

//   const rowId = reservation.rows[0].id;
//   const subject = `[SSL][Automation] ${client} - certificate expiry in ${milestoneDays} day(s)`;
//   const description = [
//     '<p><strong>SSL Expiry Alert (Automation Stack)</strong></p>',
//     `<p>Milestone: <strong>${milestoneDays} day(s)</strong></p>`,
//     `<p>Client: ${client}</p>`,
//     `<p>Environment: ${environment}</p>`,
//     `<p>Application: ${application}</p>`,
//     `<p>Instance/URL: ${instance}</p>`,
//     `<p>Responsible: ${responsible || '-'}</p>`,
//     `<p>Responsible Email: ${responsibleEmail}</p>`,
//     `<p>Summary: ${(annotations.summary || '').trim() || '-'}</p>`,
//     `<p>Description: ${(annotations.description || '').trim() || '-'}</p>`,
//     `<p>Source Alert: ${alertname}</p>`,
//     `<p>Starts At: ${alert?.startsAt || '-'}</p>`,
//     `<p>Generator URL: ${alert?.generatorURL || '-'}</p>`
//   ].join('');

//   const payload = {
//     subject,
//     priority: priorityForAutomationSslMilestone(milestoneDays),
//     status: 'Open',
//     category: 'SSL',
//     subCategory: 'SSL Expiry',
//     description,
//     contact: {
//       lastName: responsible || client,
//       email: responsibleEmail
//     }
//   };

//   if (ZOHO_DEPARTMENT_ID) {
//     payload.departmentId = ZOHO_DEPARTMENT_ID;
//   }

//   const assigneeId = await lookupAgentIdByEmail(responsibleEmail);
//   if (assigneeId) {
//     payload.assigneeId = assigneeId;
//   }

//   // Retry up to 3 times on 429 with exponential backoff before giving up
//   let response, data;
//   for (let attempt = 1; attempt <= 3; attempt++) {
//     response = await zohoFetch('/tickets', {
//       method: 'POST',
//       body: JSON.stringify(payload)
//     });
//     data = await response.json().catch(() => null);
//     if (response.status !== 429) break;
//     console.warn(`[Webhook] Zoho 429 on ticket create attempt ${attempt}/3, retrying in ${attempt * 3}s`);
//     await new Promise(r => setTimeout(r, attempt * 3000));
//   }

//   if (!response.ok && payload.assigneeId) {
//     const assigneeError = Array.isArray(data?.errors)
//       ? data.errors.find((e) => e?.fieldName === '/assigneeId')
//       : null;

//     if (assigneeError) {
//       delete payload.assigneeId;
//       for (let attempt = 1; attempt <= 3; attempt++) {
//         response = await zohoFetch('/tickets', {
//           method: 'POST',
//           body: JSON.stringify(payload)
//         });
//         data = await response.json().catch(() => null);
//         if (response.status !== 429) break;
//         console.warn(`[Webhook] Zoho 429 on ticket create (no assignee) attempt ${attempt}/3, retrying in ${attempt * 3}s`);
//         await new Promise(r => setTimeout(r, attempt * 3000));
//       }
//     }
//   }

//   if (!response.ok || !data?.id) {
//     await pool.query(
//       `DELETE FROM alertmanager_ssl_tickets
//        WHERE id = $1 AND status = 'Pending'`,
//       [rowId]
//     );
//     throw new Error(data?.message || `Alertmanager SSL ticket creation failed (${response.status})`);
//   }

//   await pool.query(
//     `UPDATE alertmanager_ssl_tickets
//      SET zoho_ticket_id = $1,
//          zoho_ticket_number = $2,
//          status = 'Open',
//          updated_at = NOW()
//      WHERE id = $3`,
//     [data.id, data.ticketNumber || null, rowId]
//   );

//   await upsertSslAssignment(data.id, data.ticketNumber || null, responsibleEmail);
//   return { status: 'created', ticketId: data.id, ticketNumber: data.ticketNumber || null };
// }

// app.post('/api/webhook/alertmanager', async (req, res) => {
//   try {
//     if (!isAlertmanagerAuthorized(req)) {
//       return res.status(401).json({ message: 'Invalid webhook secret' });
//     }

//     const payload = req.body || {};
//     const incomingAlerts = Array.isArray(payload.alerts) ? payload.alerts : [];
//     const firingAlerts = incomingAlerts.filter(a => (a?.status || '').toLowerCase() === 'firing');

//     if (firingAlerts.length === 0) {
//       return res.json({ message: 'No firing alerts to process', processed: 0 });
//     }

//     const results = [];
//     for (const alert of firingAlerts) {
//       const milestoneDays = parseMilestoneDays(alert);
//       if (!Number.isInteger(milestoneDays) || !AUTOMATION_SSL_ALERT_MILESTONES.includes(milestoneDays)) {
//         console.warn(
//           `[Webhook] Ignored SSL alert: alertname=${alert?.labels?.alertname || 'unknown'} ` +
//           `instance=${alert?.labels?.instance || alert?.labels?.target || alert?.labels?.url || 'unknown'} ` +
//           `milestone=${Number.isInteger(milestoneDays) ? milestoneDays : 'unparsed'} ` +
//           `allowed=[${AUTOMATION_SSL_ALERT_MILESTONES.join(',')}]`
//         );
//         results.push({
//           status: 'ignored',
//           reason: 'milestone not in configured automation list',
//           alertname: alert?.labels?.alertname || null,
//           milestone_days: milestoneDays
//         });
//         continue;
//       }

//       try {
//         const created = await createAlertmanagerSslTicket(alert, milestoneDays);
//         results.push({
//           alertname: alert?.labels?.alertname || null,
//           milestone_days: milestoneDays,
//           ...created
//         });
//       } catch (err) {
//         console.error('Alertmanager webhook ticket creation failed:', err?.message || err);
//         results.push({
//           alertname: alert?.labels?.alertname || null,
//           milestone_days: milestoneDays,
//           status: 'error',
//           reason: err?.message || String(err)
//         });
//       }
//     }

//     return res.json({
//       message: 'Alertmanager webhook processed',
//       processed: results.length,
//       results
//     });
//   } catch (err) {
//     console.error('Alertmanager webhook failed:', err);
//     return res.status(500).json({ message: 'Webhook processing failed' });
//   }
// });

// async function closeZohoTicketWithFallback(ticketId) {
//   const closeTry = await zohoFetch(`/tickets/${ticketId}`, {
//     method: 'PATCH',
//     body: JSON.stringify({ status: 'Closed' })
//   });

//   if (closeTry.ok) return true;
//   if (closeTry.status !== 422) return false;

//   const resolveTry = await zohoFetch(`/tickets/${ticketId}`, {
//     method: 'PATCH',
//     body: JSON.stringify({ status: 'Resolved' })
//   });

//   return resolveTry.ok;
// }

// async function upsertIhubAssignment(ticketId, ticketNumber, assigneeEmail) {
//   const normalizedEmail = (assigneeEmail || '').trim().toLowerCase();
//   if (!normalizedEmail) return;

//   await pool.query(
//     `INSERT INTO ticket_assignments
//       (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
//      VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'IHUB')
//      ON CONFLICT (zoho_ticket_id) DO UPDATE SET
//        assigned_users = EXCLUDED.assigned_users,
//        primary_assignee = EXCLUDED.primary_assignee,
//        reassigned_user = ticket_assignments.primary_assignee,
//        reassigned_at = NOW(),
//        reassigned_by = EXCLUDED.assigned_by,
//        category = 'IHUB',
//        status = 'Open',
//        updated_at = NOW()`,
//     [
//       ticketId,
//       ticketNumber || null,
//       [normalizedEmail],
//       normalizedEmail,
//       'ihub-system',
//       ZOHO_DEPARTMENT_ID || null
//     ]
//   );
// }

// async function createIhubAlertTicket(asset, milestoneDays) {
//   const responsibleEmail = (asset.responsible_person_email || '').trim().toLowerCase();
//   console.log(`[IHUB] createIhubAlertTicket: Asset ${asset.id}, email="${responsibleEmail}"`);
  
//   if (!responsibleEmail) {
//     console.log(`[IHUB] createIhubAlertTicket: No responsible email for asset ${asset.id}, skipping`);
//     return;
//   }

//   const licenseExpiryOn = normalizeDateOnly(asset.license_expiry);
//   console.log(`[IHUB] Checking for existing alert: asset=${asset.id}, milestone=${milestoneDays}, expiry=${licenseExpiryOn}`);

//   // Reserve the alert row first to prevent concurrent runs from creating duplicate Zoho tickets.
//   const reservationTicketId = `IHUB-PENDING-${asset.id}-${milestoneDays}-${licenseExpiryOn}-${Date.now()}`;
//   const reservation = await pool.query(
//     `INSERT INTO ihub_alert_tickets
//       (ihub_asset_id, milestone_days, license_expiry_on, zoho_ticket_id, status)
//      VALUES ($1, $2, $3, $4, 'Pending')
//      ON CONFLICT (ihub_asset_id, milestone_days, license_expiry_on) DO NOTHING
//      RETURNING id`,
//     [asset.id, milestoneDays, licenseExpiryOn, reservationTicketId]
//   );

//   if (reservation.rows.length === 0) {
//     console.log(`[IHUB] Alert already exists for asset ${asset.id} at ${milestoneDays} days, skipping`);
//     return;
//   }

//   const alertRowId = reservation.rows[0].id;

//   const subject = `[IHUB] License expiry in ${milestoneDays} day(s) - ${asset.client} (${asset.hostname})`;
//   const description = [
//     '<p><strong>IHUB License Expiry Alert</strong></p>',
//     `<p>License is due in <strong>${milestoneDays}</strong> day(s).</p>`,
//     `<p>Client: ${asset.client}</p>`,
//     `<p>Environment: ${asset.environment}</p>`,
//     `<p>Hostname: ${asset.hostname}</p>`,
//     `<p>IP Address: ${asset.ip_address}</p>`,
//     `<p>IHUB Version: ${asset.ihub_version || 'N/A'}</p>`,
//     `<p>License Expiry: ${licenseExpiryOn}</p>`,
//     `<p>Responsible Person: ${responsibleEmail}</p>`
//   ].join('');

//   const payload = {
//     subject,
//     priority: priorityForIhubAndSslMilestone(milestoneDays),
//     status: 'Open',
//     category: 'IHUB',
//     subCategory: 'License Expiry',
//     description,
//     contact: {
//       lastName: asset.responsible_person_name || asset.client || 'IHUB Owner',
//       email: responsibleEmail
//     }
//   };

//   if (ZOHO_DEPARTMENT_ID) {
//     payload.departmentId = ZOHO_DEPARTMENT_ID;
//   }

//   const assigneeId = await lookupAgentIdByEmail(responsibleEmail);
//   if (assigneeId) {
//     payload.assigneeId = assigneeId;
//   }

//   console.log(`[IHUB] Creating Zoho ticket for asset ${asset.id}:`, subject);
//   let response = await zohoFetch('/tickets', {
//     method: 'POST',
//     body: JSON.stringify(payload)
//   });

//   let data = await response.json().catch(() => null);

//   // If Zoho rejects assignee privileges, retry without assigneeId.
//   if (!response.ok && payload.assigneeId) {
//     const assigneeError = Array.isArray(data?.errors)
//       ? data.errors.find((e) => e?.fieldName === '/assigneeId')
//       : null;

//     if (assigneeError) {
//       console.warn(`[IHUB] Zoho rejected assigneeId for asset ${asset.id}, retrying without assigneeId`);
//       delete payload.assigneeId;
//       response = await zohoFetch('/tickets', {
//         method: 'POST',
//         body: JSON.stringify(payload)
//       });
//       data = await response.json().catch(() => null);
//     }
//   }

//   if (!response.ok || !data?.id) {
//     const errorMsg = data?.message || `IHUB alert ticket creation failed (${response.status})`;
//     console.error(`[IHUB] Zoho API error for asset ${asset.id}:`, errorMsg, data);

//     // Release reservation on failure so future runs can retry.
//     await pool.query(
//       `DELETE FROM ihub_alert_tickets
//        WHERE id = $1 AND status = 'Pending'`,
//       [alertRowId]
//     );

//     throw new Error(errorMsg);
//   }

//   console.log(`[IHUB] Zoho ticket created: ${data.id} (${data.ticketNumber})`);
  
//   await pool.query(
//     `UPDATE ihub_alert_tickets
//      SET zoho_ticket_id = $1,
//          zoho_ticket_number = $2,
//          status = 'Open'
//      WHERE id = $3`,
//     [data.id, data.ticketNumber || null, alertRowId]
//   );

//   console.log(`[IHUB] Alert ticket record created in DB for asset ${asset.id}`);
  
//   await upsertIhubAssignment(data.id, data.ticketNumber || null, responsibleEmail);
//   console.log(`[IHUB] Assignment created for asset ${asset.id}`);
// }

// async function processIhubAlerts() {
//   try {
//     const result = await pool.query('SELECT * FROM ihub_assets');
//     console.log(`[IHUB] Processing ${result.rows.length} assets for alert generation...`);

//     for (const asset of result.rows) {
//       const daysLeft = daysUntilDate(asset.license_expiry);
//       console.log(`[IHUB] Asset ${asset.id} (${asset.client}): ${daysLeft} days until expiry on ${asset.license_expiry}, email: ${asset.responsible_person_email}`);
      
//       if (!IHUB_ALERT_MILESTONES.includes(daysLeft)) {
//         console.log(`[IHUB] Asset ${asset.id}: ${daysLeft} days not in milestones [${IHUB_ALERT_MILESTONES.join(',')}], skipping`);
//         continue;
//       }

//       try {
//         console.log(`[IHUB] Creating alert ticket for asset ${asset.id} at ${daysLeft} day milestone`);
//         await createIhubAlertTicket(asset, daysLeft);
//         console.log(`[IHUB] Alert ticket created successfully for asset ${asset.id}`);
//       } catch (err) {
//         console.error(`IHUB alert generation failed for asset ${asset.id}:`, err?.message || err);
//       }
//     }
//   } catch (err) {
//     console.error('IHUB alert processor failed:', err?.message || err);
//   }
// }

// async function upsertSslAssignment(ticketId, ticketNumber, assigneeEmail) {
//   const normalizedEmail = (assigneeEmail || '').trim().toLowerCase();
//   if (!normalizedEmail) return;

//   await pool.query(
//     `INSERT INTO ticket_assignments
//       (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
//      VALUES ($1, $2, $3, $4, $5, $6, 'Open', 'SSL')
//      ON CONFLICT (zoho_ticket_id) DO UPDATE SET
//        assigned_users = EXCLUDED.assigned_users,
//        primary_assignee = EXCLUDED.primary_assignee,
//        reassigned_user = ticket_assignments.primary_assignee,
//        reassigned_at = NOW(),
//        reassigned_by = EXCLUDED.assigned_by,
//        category = 'SSL',
//        status = 'Open',
//        updated_at = NOW()`,
//     [
//       ticketId,
//       ticketNumber || null,
//       [normalizedEmail],
//       normalizedEmail,
//       'ssl-system',
//       ZOHO_DEPARTMENT_ID || null
//     ]
//   );
// }

// async function createSslAlertTicket(asset, milestoneDays) {
//   const responsibleEmail = (asset.responsible_person_email || '').trim().toLowerCase();
//   if (!responsibleEmail) return;

//   const sslExpiryOn = normalizeDateOnly(asset.ssl_expiry);

//   // Reserve the alert row first to prevent concurrent runs from creating duplicate Zoho tickets.
//   const reservationTicketId = `SSL-PENDING-${asset.id}-${milestoneDays}-${sslExpiryOn}-${Date.now()}`;
//   const reservation = await pool.query(
//     `INSERT INTO ssl_expiry_alert_tickets
//       (ssl_asset_id, milestone_days, ssl_expiry_on, zoho_ticket_id, status)
//      VALUES ($1, $2, $3, $4, 'Pending')
//      ON CONFLICT (ssl_asset_id, milestone_days, ssl_expiry_on) DO NOTHING
//      RETURNING id`,
//     [asset.id, milestoneDays, sslExpiryOn, reservationTicketId]
//   );

//   if (reservation.rows.length === 0) return;

//   const alertRowId = reservation.rows[0].id;

//   const subject = `[SSL] SSL expiry in ${milestoneDays} day(s) - ${asset.client} (${asset.ssl_url || asset.hostname || 'N/A'})`;
//   const description = [
//     '<p><strong>SSL Expiry Alert</strong></p>',
//     `<p>SSL is due in <strong>${milestoneDays}</strong> day(s).</p>`,
//     `<p>Client: ${asset.client}</p>`,
//     `<p>Environment: ${asset.environment}</p>`,
//     `<p>Hostname: ${asset.hostname || '-'}</p>`,
//     `<p>IP Address: ${asset.ip_address || '-'}</p>`,
//     `<p>Application: ${asset.application || '-'}</p>`,
//     `<p>Version: ${asset.version || 'N/A'}</p>`,
//     `<p>SSL URL: ${asset.ssl_url}</p>`,
//     `<p>SSL Expiry: ${sslExpiryOn}</p>`,
//     `<p>Responsible Person: ${responsibleEmail}</p>`
//   ].join('');

//   const payload = {
//     subject,
//     priority: priorityForIhubAndSslMilestone(milestoneDays),
//     status: 'Open',
//     category: 'SSL',
//     subCategory: 'SSL Expiry',
//     description,
//     contact: {
//       lastName: asset.responsible_person_name || asset.client || 'SSL Owner',
//       email: responsibleEmail
//     }
//   };

//   if (ZOHO_DEPARTMENT_ID) {
//     payload.departmentId = ZOHO_DEPARTMENT_ID;
//   }

//   const assigneeId = await lookupAgentIdByEmail(responsibleEmail);
//   if (assigneeId) {
//     payload.assigneeId = assigneeId;
//   }

//   let response = await zohoFetch('/tickets', {
//     method: 'POST',
//     body: JSON.stringify(payload)
//   });
//   let data = await response.json().catch(() => null);

//   // Retry without assignee if agent privilege assignment fails.
//   if (!response.ok && payload.assigneeId) {
//     const assigneeError = Array.isArray(data?.errors)
//       ? data.errors.find((e) => e?.fieldName === '/assigneeId')
//       : null;

//     if (assigneeError) {
//       delete payload.assigneeId;
//       response = await zohoFetch('/tickets', {
//         method: 'POST',
//         body: JSON.stringify(payload)
//       });
//       data = await response.json().catch(() => null);
//     }
//   }

//   if (!response.ok || !data?.id) {
//     await pool.query(
//       `DELETE FROM ssl_expiry_alert_tickets
//        WHERE id = $1 AND status = 'Pending'`,
//       [alertRowId]
//     );
//     throw new Error(data?.message || `SSL alert ticket creation failed (${response.status})`);
//   }

//   await pool.query(
//     `UPDATE ssl_expiry_alert_tickets
//      SET zoho_ticket_id = $1,
//          zoho_ticket_number = $2,
//          status = 'Open'
//      WHERE id = $3`,
//     [data.id, data.ticketNumber || null, alertRowId]
//   );

//   await upsertSslAssignment(data.id, data.ticketNumber || null, responsibleEmail);
// }

// async function processSslAlerts() {
//   try {
//     const result = await pool.query('SELECT * FROM ssl_assets');
//     console.log(`[SSL] Processing ${result.rows.length} assets for alert generation...`);

//     for (const asset of result.rows) {
//       const daysLeft = daysUntilDate(asset.ssl_expiry);
//       if (!SSL_ALERT_MILESTONES.includes(daysLeft)) {
//         continue;
//       }

//       try {
//         console.log(`[SSL] Creating alert ticket for asset ${asset.id} at ${daysLeft} day milestone`);
//         await createSslAlertTicket(asset, daysLeft);
//         console.log(`[SSL] Alert ticket processed for asset ${asset.id}`);
//       } catch (err) {
//         console.error(`SSL alert generation failed for asset ${asset.id}:`, err?.message || err);
//       }
//     }
//   } catch (err) {
//     console.error('SSL alert processor failed:', err?.message || err);
//   }
// }

// // -------------------------------------------------------
// //                     API ROUTES
// // -------------------------------------------------------

// // 🚀 OPTIMIZED: Production-grade caching system
// const countsCache = new Map(); // Cache per user role
// const COUNTS_CACHE_MS = 2 * 60 * 60 * 1000;   // 2 hour "fresh" window (reduced API consumption)
// const COUNTS_STALE_MS = 4 * 60 * 60 * 1000;   // 4 hour serve-stale-while-revalidate window
// const countsRefreshInFlight = new Map();      // Dedupe concurrent background refreshes
// let agentsCache = null;
// let agentsCacheTime = 0;
// const AGENTS_CACHE_MS = 30 * 60 * 1000; // 30 minutes for agents list

// async function getActiveRecycledTicketIds() {
//   try {
//     const result = await pool.query(
//       `SELECT zoho_ticket_id
//        FROM recycled_tickets
//        WHERE restored_at IS NULL
//          AND expires_at > NOW()`
//     );
//     return new Set(result.rows.map(r => (r.zoho_ticket_id || '').toString()));
//   } catch (err) {
//     console.error('Failed to fetch recycled ticket ids:', err?.message || err);
//     return new Set();
//   }
// }

// app.get('/api/tickets/counts', authenticateToken, async (req, res) => {
//   // Stale-while-revalidate: ALWAYS return immediately from cache when available,
//   // refresh in the background. Browser may also use ETag for 304s.
//   res.set('Cache-Control', 'private, max-age=0, must-revalidate');
//   res.set('Pragma', 'no-cache');

//   try {
//     const userEmail = req.user?.email?.toLowerCase() || '';
//     const userRole = (req.user?.role || 'user').toLowerCase();
//     const isAdmin = userRole === 'admin' || userRole === 'cloudops';
//     let allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);

//     // Allow admin to filter by specific department
//     const reqDeptId = (req.query.departmentId || '').toString().trim();
//     if (isAdmin && reqDeptId) {
//       allowedDeptIds = [reqDeptId];
//     }

//     // Per-user cache key — assigned/SLA counts are personal even for admins.
//     const cacheKey = `counts_${isAdmin ? 'admin_' : 'user_'}${userRole}_${userEmail}${reqDeptId ? '_dept_' + reqDeptId : ''}`;
//     const cached = countsCache.get(cacheKey);
//     const now = Date.now();
//     const age = cached ? now - cached.time : Infinity;

//     // 1) Fresh cache → instant response.
//     if (cached && age < COUNTS_CACHE_MS) {
//       console.log(`[CACHE HIT-FRESH] ${cacheKey} age=${age}ms`);
//       res.set('X-ITSM-Counts-Cache', `HIT-FRESH;node=${NODE_ID};ageMs=${age}`);
//       res.set('ETag', cached.etag);
//       if (req.get('if-none-match') === cached.etag) return res.status(304).end();
//       return res.json(cached.data);
//     }

//     // 2) Stale cache → instant response + background refresh.
//     if (cached && age < COUNTS_STALE_MS) {
//       console.log(`[CACHE HIT-STALE] ${cacheKey} age=${age}ms (refreshing in background)`);
//       res.set('X-ITSM-Counts-Cache', `HIT-STALE;node=${NODE_ID};ageMs=${age}`);
//       res.set('ETag', cached.etag);
//       if (req.get('if-none-match') !== cached.etag) {
//         res.json(cached.data);
//       } else {
//         res.status(304).end();
//       }
//       // Fire-and-forget refresh, deduped per cache key.
//       refreshCountsCache(cacheKey, userEmail, isAdmin, allowedDeptIds).catch(err =>
//         console.error(`Background counts refresh failed for ${cacheKey}:`, err?.message || err)
//       );
//       return;
//     }

//     // 3) Cold cache → must compute synchronously.
//     console.log(`[CACHE MISS] ${cacheKey} - computing fresh counts`);
//     res.set('X-ITSM-Counts-Cache', `MISS;node=${NODE_ID}`);
//     const countData = await refreshCountsCache(cacheKey, userEmail, isAdmin, allowedDeptIds);
//     const fresh = countsCache.get(cacheKey);
//     res.set('ETag', fresh.etag);
//     if (req.get('if-none-match') === fresh.etag) return res.status(304).end();
//     // Pre-warm user's "My Tickets" caches in background after responding.
//     prewarmUserTickets(userEmail, userRole);
//     res.json(countData);
//   } catch (err) {
//     console.error('Counts error:', err);
//     res.status(500).json({ error: 'Failed to fetch ticket counts' });
//   }
// });

// // Background-prefetch a user's My Tickets (open + closed) if not already fresh.
// function prewarmUserTickets(userEmail, userRole = 'user') {
//   if (!userEmail) return;
//   const allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);
//   for (const status of ['open', 'closed']) {
//     const cacheKey = `${userRole}_${userEmail}_${status}_all`;
//     const cached = userTicketsCache.get(cacheKey);
//     if (cached && (Date.now() - cached.time) < USER_TICKETS_CACHE_MS) continue;
//     refreshUserTicketsCache(cacheKey, userEmail, status, 'all', allowedDeptIds).catch(err =>
//       console.error(`Pre-warm user-tickets failed for ${cacheKey}:`, err?.message || err)
//     );
//   }
// }

// // ---- Counts computation (extracted so it can run in background + at startup) ----
// async function computeCounts(userEmail, isAdmin, allowedDeptIds = []) {
//   const recycledTicketIds = await getActiveRecycledTicketIds();

//   let mySupabaseAssignedIds = new Set();
//   if (userEmail) {
//     try {
//       const r = await pool.query(
//         "SELECT zoho_ticket_id FROM ticket_assignments WHERE $1 = ANY(assigned_users)",
//         [userEmail]
//       );
//       mySupabaseAssignedIds = new Set(r.rows.map(x => x.zoho_ticket_id));
//     } catch (e) {
//       console.error('Error fetching Supabase assignments:', e?.message || e);
//     }
//   }

//   const PAGE_SIZE = 100;
//   const PARALLEL_PAGES = 3;
//   const hasSingleDept = Array.isArray(allowedDeptIds) && allowedDeptIds.length === 1;
//   const deptQuery = hasSingleDept ? `&departmentId=${allowedDeptIds[0]}` : '';
//   async function fetchPageWithRetry(status, from) {
//     for (let attempt = 0; attempt < 2; attempt++) {
//       let r;
//       try {
//         r = await zohoFetch(`/tickets?limit=${PAGE_SIZE}&from=${from}&status=${status}&include=assignee${deptQuery}`);
//       } catch (e) {
//         console.error(`Network error fetching ${status} at from=${from}:`, e?.message || e);
//         return { tickets: [], more: false };
//       }
//       if (r.status === 429) {
//         await new Promise(rs => setTimeout(rs, 2000));
//         continue;
//       }
//       if (!r.ok) return { tickets: [], more: false };
//       let data; try { data = await r.json(); } catch { return { tickets: [], more: false }; }
//       const tickets = data.data || [];
//       const more = data.info?.moreRecords ?? (tickets.length >= PAGE_SIZE);
//       return { tickets, more };
//     }
//     return { tickets: [], more: false };
//   }

//   async function scanPages(status, perTicket) {
//     let from = 0;
//     while (from < 10000) {
//       const offsets = [];
//       for (let i = 0; i < PARALLEL_PAGES; i++) {
//         const o = from + i * PAGE_SIZE;
//         if (o >= 10000) break;
//         offsets.push(o);
//       }
//       if (!offsets.length) break;
//       const results = await Promise.all(offsets.map(o => fetchPageWithRetry(status, o)));
//       await new Promise(r => setTimeout(r, 400));
//       let anyMore = false;
//       for (const { tickets, more } of results) {
//         for (const t of tickets) {
//           const ticketId = (t.id || '').toString();
//           if (
//             ticketId &&
//             !recycledTicketIds.has(ticketId) &&
//             isDepartmentAllowed(t, allowedDeptIds)
//           ) {
//             perTicket(t, ticketId);
//           }
//         }
//         if (more) anyMore = true;
//       }
//       if (!anyMore) break;
//       from += offsets.length * PAGE_SIZE;
//     }
//   }

//   let openCount = 0, slaCount = 0, assignedCount = 0, closedCount = 0;
//   function countClosed(t, ticketId) {
//     if (isAdmin) {
//       closedCount++;
//     } else {
//       const zohoAssignee = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
//       const isMine = (!!userEmail && zohoAssignee === userEmail) || mySupabaseAssignedIds.has(ticketId);
//       if (isMine) closedCount++;
//     }
//   }

//   await Promise.all([
//     scanPages('Open', (t, ticketId) => {
//       const zohoAssignee = (t.assignee?.email || t.assignee?.emailId || t.assignedTo || '').toLowerCase();
//       const isMine = (!!userEmail && zohoAssignee === userEmail) || mySupabaseAssignedIds.has(ticketId);
//       if (isAdmin || isMine) openCount++;
//       if (isMine) {
//         assignedCount++;
//         const priority = (t.priority || '').toLowerCase();
//         if (priority.includes('sla') || priority.includes('urgent') || priority.includes('critical')) slaCount++;
//       }
//     }),
//     scanPages('Closed',   countClosed),
//     scanPages('Resolved', countClosed)
//   ]);

//   return {
//     scope: isAdmin ? 'all' : 'mine',
//     open: openCount,
//     closed: closedCount,
//     sla: slaCount,
//     assigned: assignedCount,
//     total: openCount + closedCount
//   };
// }

// // Dedupe concurrent refreshes for the same cache key.
// async function refreshCountsCache(cacheKey, userEmail, isAdmin, allowedDeptIds = []) {
//   const inflight = countsRefreshInFlight.get(cacheKey);
//   if (inflight) return inflight;

//   const promise = (async () => {
//     const start = Date.now();
//     const countData = await computeCounts(userEmail, isAdmin, allowedDeptIds);
//     const etag = '"' + crypto.createHash('md5').update(JSON.stringify(countData)).digest('hex') + '"';
//     countsCache.set(cacheKey, { data: countData, time: Date.now(), etag });
//     console.log(`[COUNTS REFRESHED] ${cacheKey} in ${Date.now() - start}ms`);
//     return countData;
//   })().finally(() => countsRefreshInFlight.delete(cacheKey));

//   countsRefreshInFlight.set(cacheKey, promise);
//   return promise;
// }

// // 🔧 GET ZOHO DESK AGENTS for assignment dropdown

// app.get('/api/agents', authenticateToken, async (req, res) => {
//   try {
//     // Return cached agents if still valid
//     if (agentsCache && (Date.now() - agentsCacheTime) < AGENTS_CACHE_MS) {
//       return res.json(agentsCache);
//     }

//     const agents = [];
//     const limit = 100;
//     let from = 0;
//     let hasMore = true;

//     while (hasMore && from < 500) { // Max 500 agents
//       const response = await zohoFetch(`/agents?limit=${limit}&from=${from}`);
//       const data = await response.json();
//       const batch = Array.isArray(data?.data) ? data.data : [];
      
//       batch.forEach(a => {
//         const email = (a.email || a.emailId || a.primaryEmail || '').trim().toLowerCase();
//         const name = a.name || a.firstName || '';
//         if (email) {
//           agents.push({ id: a.id, email, name });
//         }
//       });

//       hasMore = batch.length === limit;
//       from += limit;
//     }

//     agentsCache = agents;
//     agentsCacheTime = Date.now();
//     res.json(agents);
//   } catch (err) {
//     console.error('Agents error:', err);
//     res.status(500).json({ error: 'Failed to fetch agents' });
//   }
// });

// // Cache for user-filtered tickets (avoids re-scanning Zoho on every page)
// const userTicketsCache = new Map(); // key: email_status -> { tickets, time }
// const USER_TICKETS_CACHE_MS  = 5 * 60 * 1000;   // 5 min "fresh" window for My Tickets (was 60s)
// const USER_TICKETS_STALE_MS  = 30 * 60 * 1000;  // 30 min serve-stale-while-revalidate window
// const userTicketsRefreshInFlight = new Map();   // Dedupe concurrent refreshes

// // Shared cache for standard tickets endpoint (non filterByEmail requests).
// const standardTicketsCache = new Map();          // key: endpoint -> { payload, time }
// const STANDARD_TICKETS_CACHE_MS = 30 * 1000;    // 30 sec fresh window
// const STANDARD_TICKETS_STALE_MS = 5 * 60 * 1000; // 5 min stale-while-revalidate window
// const standardTicketsRefreshInFlight = new Map();

// function invalidateRuntimeCaches() {
//   // Mark all counts entries as stale (so SWR refreshes them) instead of
//   // wiping them, which would force the next dashboard hit to wait 5-7s.
//   for (const [key, entry] of countsCache.entries()) {
//     entry.time = 0; // age = Infinity → still served as stale, refresh kicked off
//     countsCache.set(key, entry);
//   }
//   // Same SWR treatment for per-user ticket caches.
//   for (const [key, entry] of userTicketsCache.entries()) {
//     entry.time = 0;
//     userTicketsCache.set(key, entry);
//   }
//   // Per-user caches are already stale-marked above; they'll self-refresh on
//   // the next request via SWR — no shared-admin pre-warm needed here.

//   // Standard ticket list cache should also be stale-marked.
//   for (const [key, entry] of standardTicketsCache.entries()) {
//     entry.time = 0;
//     standardTicketsCache.set(key, entry);
//   }
// }

// async function refreshStandardTicketsCache(cacheKey, endpoint, limit, allowedDeptIds = []) {
//   const inflight = standardTicketsRefreshInFlight.get(cacheKey);
//   if (inflight) return inflight;

//   const promise = (async () => {
//     const response = await zohoFetch(endpoint);
//     if (!response.ok) {
//       let errorData = {};
//       try {
//         errorData = await response.json();
//       } catch {
//         // ignore parse error
//       }
//       const details = errorData?.message || errorData?.error || 'Unknown error';
//       throw new Error(`Failed to fetch tickets from Zoho (${response.status}): ${details}`);
//     }

//     const data = await response.json();
//     const normalized = (data.data || []).map(t => ({
//       ...t,
//       email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
//       assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId
//     }));

//     const recycledIds = await getActiveRecycledTicketIds();
//     const filtered = normalized.filter(t => {
//       if (recycledIds.has((t.id || '').toString())) return false;
//       return isDepartmentAllowed(t, allowedDeptIds);
//     });

//     const payload = {
//       count: filtered.length || 0,
//       hasMore: (data.data || []).length === limit,
//       data: filtered
//     };

//     standardTicketsCache.set(cacheKey, {
//       payload,
//       time: Date.now()
//     });

//     return payload;
//   })().finally(() => standardTicketsRefreshInFlight.delete(cacheKey));

//   standardTicketsRefreshInFlight.set(cacheKey, promise);
//   return promise;
// }

// // ── Compute the full filtered ticket list for a user ──
// // Uses Zoho contact search (fast path) + limited assignee scan + Supabase-assigned fetch.
// async function computeUserTickets(userEmail, status, filterType = 'all', allowedDeptIds = []) {
//   const include = 'contacts,assignee';

//   const [recycledIds, supabaseResult] = await Promise.all([
//     getActiveRecycledTicketIds(),
//     pool.query(
//       "SELECT zoho_ticket_id FROM ticket_assignments WHERE $1 = ANY(assigned_users)",
//       [userEmail]
//     ).catch(e => { console.error('Supabase assignment fetch error:', e?.message || e); return { rows: [] }; })
//   ]);
//   const supabaseAssignedIds = new Set(supabaseResult.rows.map(r => r.zoho_ticket_id));

//   // status filter lists for Zoho API
//   let statusValues;
//   if (status === 'open') statusValues = ['Open', 'In Progress', 'On Hold', 'Escalated'];
//   else if (status === 'closed') statusValues = ['Closed', 'Resolved'];
//   else statusValues = [''];

//   const seenIds = new Set();
//   const allUserTickets = [];

//   function isStatusMatch(t) {
//     const s = (t.status || '').toLowerCase();
//     if (status === 'open') return !s.includes('closed') && !s.includes('resolved');
//     if (status === 'closed') return s.includes('closed') || s.includes('resolved');
//     return true;
//   }

//   function addTicket(t) {
//     const tid = (t.id || '').toString();
//     if (!tid || recycledIds.has(tid) || seenIds.has(tid)) return;
//     if (!isDepartmentAllowed(t, allowedDeptIds)) return;
//     const contactEmail = (t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail || '').toLowerCase();
//     const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || '').toLowerCase();
//     const isRequester = contactEmail === userEmail;
//     const isAssignee = assigneeEmail === userEmail || supabaseAssignedIds.has(tid);
//     // Apply filterType
//     if (filterType === 'assigned' && !isAssignee) return;
//     if (filterType === 'raised' && !isRequester) return;
//     if (!isRequester && !isAssignee) return;
//     seenIds.add(tid);
//     allUserTickets.push({
//       ...t,
//       email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
//       assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId
//     });
//   }

//   // ── Path 1: Contact-based search (fast — gets tickets where user is the requester) ──
//   try {
//     const contactRes = await zohoFetch(`/contacts/search?email=${encodeURIComponent(userEmail)}&limit=5`)
//       .then(r => r.ok ? r.json() : null)
//       .catch(() => null);
//     const contacts = Array.isArray(contactRes?.data) ? contactRes.data : [];

//     // Some Zoho setups have duplicate contact records for one email.
//     // Scan all matched contacts so requester tickets aren't missed.
//     for (const contact of contacts) {
//       if (!contact?.id) continue;
//       let from = 0;
//       let more = true;
//       while (more) {
//         const res = await zohoFetch(
//           `/contacts/${contact.id}/tickets?from=${from}&limit=100&include=${include}`
//         ).then(r => r.ok ? r.json() : null).catch(() => null);
//         const tickets = res?.data || [];
//         tickets.filter(isStatusMatch).forEach(t => {
//           // Force-set email since these tickets come from the matched contact.
//           if (!t.email && !t.contact?.email && !t.contact?.emailAddress) {
//             t.email = (contact.email || userEmail).toLowerCase();
//           }
//           addTicket(t);
//         });
//         more = tickets.length === 100;
//         from += 100;
//         if (from > 2000) more = false;
//       }
//     }
//   } catch (e) {
//     console.error('[computeUserTickets] contact path error:', e?.message || e);
//   }

//   // ── Path 2: Fallback scan for requester/assignee tickets in global list ──
//   {
//     const BATCH = 5;
//     const PAGE = 100;
//     const MAX_OFFSET = 3000;
//     let from = 0;
//     let keepScanning = true;
//     while (keepScanning) {
//       const batchPromises = [];
//       for (let i = 0; i < BATCH; i++) {
//         const offset = from + i * PAGE;
//         if (offset > MAX_OFFSET) break;
//         batchPromises.push(
//           zohoFetch(`/tickets?limit=${PAGE}&from=${offset}&include=${include}`)
//             .then(r => r.ok ? r.json() : { data: [] })
//             .then(d => ({ data: d.data || [], offset }))
//             .catch(() => ({ data: [], offset }))
//         );
//       }
//       if (!batchPromises.length) break;
//       const batchResults = await Promise.all(batchPromises);
//       batchResults.sort((a, b) => a.offset - b.offset);
//       let anyFull = false;
//       for (const r of batchResults) {
//         for (const t of r.data) {
//           const tid = (t.id || '').toString();
//           const requesterEmail = (
//             t.email ||
//             t.contact?.email ||
//             t.contact?.emailAddress ||
//             t.contact?.secondaryEmail ||
//             t.requester?.email ||
//             t.customer?.email
//           || '').toLowerCase();
//           const assigneeEmail = (t.assignee?.email || t.assignee?.emailId || '').toLowerCase();
//           const isRequester = requesterEmail === userEmail;
//           const isAssignee = assigneeEmail === userEmail || supabaseAssignedIds.has(tid);
//           if ((isRequester || isAssignee) && isStatusMatch(t)) {
//             addTicket(t);
//           }
//         }
//         if (r.data.length === PAGE) anyFull = true;
//       }
//       if (!anyFull) break;
//       from += BATCH * PAGE;
//       if (from > MAX_OFFSET) break;
//       keepScanning = true;
//     }
//   }

//   // ── Path 3: Fetch any Supabase-assigned tickets not yet seen ──
//   const missingIds = [...supabaseAssignedIds].filter(id => !seenIds.has(id));
//   if (missingIds.length) {
//     const BATCH_SIZE = 10;
//     for (let i = 0; i < missingIds.length; i += BATCH_SIZE) {
//       const batch = missingIds.slice(i, i + BATCH_SIZE);
//       const results = await Promise.allSettled(
//         batch.map(tid =>
//           zohoFetch(`/tickets/${tid}?include=${include}`)
//             .then(r => r.ok ? r.json() : null)
//             .catch(() => null)
//         )
//       );
//       for (const r of results) {
//         const t = r.status === 'fulfilled' ? r.value : null;
//         if (t?.id && isStatusMatch(t)) addTicket(t);
//       }
//     }
//   }

//   return allUserTickets;
// }

// // ── Refresh user-tickets cache; deduped per cache key ──
// async function refreshUserTicketsCache(cacheKey, userEmail, status, filterType = 'all', allowedDeptIds = []) {
//   const inflight = userTicketsRefreshInFlight.get(cacheKey);
//   if (inflight) return inflight;

//   const promise = (async () => {
//     const start = Date.now();
//     const tickets = await computeUserTickets(userEmail, status, filterType, allowedDeptIds);
//     userTicketsCache.set(cacheKey, { tickets, time: Date.now() });
//     console.log(`[USER-TICKETS REFRESHED] ${cacheKey} → ${tickets.length} rows in ${Date.now() - start}ms`);
//     return tickets;
//   })().finally(() => userTicketsRefreshInFlight.delete(cacheKey));

//   userTicketsRefreshInFlight.set(cacheKey, promise);
//   return promise;
// }

// app.get('/api/tickets', authenticateToken, async (req, res) => {
//   try {
//     const limit = parseInt(req.query.limit) || 27;
//     const page = parseInt(req.query.page) || 1;
//     const status = req.query.status;
//     const search = req.query.search;
//     const filterByEmail = req.query.filterByEmail; // Server-side user filter
//     const userRole = (req.user?.role || 'user').toLowerCase();
//     const allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);
//     const from = (page - 1) * limit;
//     const include = 'contacts,assignee';

//     if (filterByEmail) {
//       const userEmail = filterByEmail.toLowerCase();
//       const filterType = req.query.filterType || 'all'; // 'all' | 'assigned' | 'raised'
//       const forceRefresh = req.query.refresh === 'true';
//       const cacheKey = `${userRole}_${userEmail}_${status || 'all'}_${filterType}`;
//       const startIdx = (page - 1) * limit;
//       const cached = userTicketsCache.get(cacheKey);
//       const age = cached ? Date.now() - cached.time : Infinity;

//       let allUserTickets;

//       if (!forceRefresh && cached && age < USER_TICKETS_CACHE_MS) {
//         // Fresh — instant
//         allUserTickets = cached.tickets;
//       } else if (cached && age < USER_TICKETS_STALE_MS) {
//         // Stale — serve cached + refresh in background
//         allUserTickets = cached.tickets;
//         refreshUserTicketsCache(cacheKey, userEmail, status, filterType, allowedDeptIds).catch(err =>
//           console.error(`Background user-tickets refresh failed for ${cacheKey}:`, err?.message || err)
//         );
//       } else {
//         // Cold — must compute synchronously
//         allUserTickets = await refreshUserTicketsCache(cacheKey, userEmail, status, filterType, allowedDeptIds);
//       }

//       const pageData = allUserTickets.slice(startIdx, startIdx + limit);
//       const hasMore = startIdx + limit < allUserTickets.length;

//       return res.json({
//         page,
//         limit,
//         count: pageData.length,
//         hasMore,
//         data: pageData
//       });
//     }

//     // Standard path (no user filter)
//     let endpoint = `/tickets?limit=${limit}&from=${from}&include=${include}`;

//     if (status === 'open') {
//       endpoint += `&status=Open`;
//     } else if (status === 'closed') {
//       endpoint += `&status=Closed`;
//     }

//     // Department filter by role scope + optional admin filter
//     const deptFilter = req.query.departmentId;
//     if (userRole === 'admin' && deptFilter) {
//       endpoint += `&departmentId=${deptFilter}`;
//     } else if (allowedDeptIds.length === 1) {
//       endpoint += `&departmentId=${allowedDeptIds[0]}`;
//     } else if (deptFilter) {
//       // non-admin roles cannot override their scoped department access
//     }

//     const baseEndpoint = endpoint;
//     const searchEndpoint = search
//       ? `${endpoint}&searchText=${encodeURIComponent(search)}`
//       : endpoint;

//     // Preserve the fallback behavior for invalid search values while caching by final endpoint.
//     let effectiveEndpoint = searchEndpoint;
//     if (search) {
//       const probe = await zohoFetch(searchEndpoint);
//       if (probe.status === 422) {
//         effectiveEndpoint = baseEndpoint;
//       }
//     }

//     const cacheKey = `${userRole}|${effectiveEndpoint}`;
//     const cached = standardTicketsCache.get(cacheKey);
//     const age = cached ? Date.now() - cached.time : Infinity;

//     let payload;
//     if (cached && age < STANDARD_TICKETS_CACHE_MS) {
//       payload = cached.payload;
//       res.set('X-ITSM-Tickets-Cache', 'HIT');
//     } else if (cached && age < STANDARD_TICKETS_STALE_MS) {
//       payload = cached.payload;
//       res.set('X-ITSM-Tickets-Cache', 'STALE');
//       refreshStandardTicketsCache(cacheKey, effectiveEndpoint, limit, allowedDeptIds).catch(err =>
//         console.error(`Background standard tickets refresh failed for ${cacheKey}:`, err?.message || err)
//       );
//     } else {
//       try {
//         payload = await refreshStandardTicketsCache(cacheKey, effectiveEndpoint, limit, allowedDeptIds);
//         res.set('X-ITSM-Tickets-Cache', 'MISS');
//       } catch (refreshErr) {
//         const message = refreshErr?.message || 'Unknown error';
//         console.error('Standard tickets refresh error:', message);
//         return res.status(502).json({
//           error: 'Failed to fetch tickets from Zoho',
//           details: message
//         });
//       }
//     }

//     res.json({
//       page,
//       limit,
//       count: payload.count,
//       hasMore: payload.hasMore,
//       data: payload.data
//     });
//   } catch (err) {
//     console.error('Tickets endpoint error:', err.message);
//     res.status(500).json({ error: 'Failed to fetch tickets', details: err.message });
//   }
// });

// app.get('/api/tickets/recycle-bin', authenticateToken, async (req, res) => {
//   try {
//     const userEmail = (req.user?.email || '').toLowerCase();

//     await pool.query(
//       `DELETE FROM recycled_tickets
//        WHERE restored_at IS NULL
//          AND expires_at <= NOW()`
//     );

//     const result = await pool.query(
//       `SELECT
//          zoho_ticket_id,
//          zoho_ticket_number,
//          subject,
//          email,
//          priority,
//          deleted_by,
//          deleted_at,
//          expires_at,
//          GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - NOW())) / 86400))::INT AS expires_in_days
//        FROM recycled_tickets
//        WHERE restored_at IS NULL
//          AND LOWER(deleted_by) = $1
//          AND expires_at > NOW()
//        ORDER BY deleted_at DESC`,
//       [userEmail]
//     );

//     return res.json({ data: result.rows });
//   } catch (err) {
//     console.error('Recycle bin fetch failed:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to fetch recycle bin' });
//   }
// });

// app.post('/api/tickets/:id/recycle', authenticateToken, async (req, res) => {
//   // Invalidate caches
//   invalidateRuntimeCaches();
//   try {
//     const ticketId = (req.params.id || '').toString();
//     if (!ticketId) {
//       return res.status(400).json({ error: 'Ticket id is required' });
//     }

//     let snapshot = req.body?.ticket || null;

//     if (!snapshot) {
//       const detailRes = await zohoFetch(`/tickets/${ticketId}?include=contacts,assignee`);
//       if (detailRes.ok) {
//         snapshot = await detailRes.json();
//       }
//     }

//     const source = snapshot?.data || snapshot || {};
//     const ticketNumber = source.ticketNumber || source.displayId || source.id || ticketId;
//     const subject = source.subject || 'No Subject';
//     const email = source.email || source.contact?.email || source.contact?.emailAddress || null;
//     const priority = source.priority || null;
//     const deletedBy = (req.user?.email || '').toLowerCase() || 'unknown';

//     await pool.query(
//       `INSERT INTO recycled_tickets
//         (zoho_ticket_id, zoho_ticket_number, subject, email, priority, deleted_by, deleted_at, expires_at, restored_at, snapshot, updated_at)
//        VALUES
//         ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '30 days', NULL, $7::jsonb, NOW())
//        ON CONFLICT (zoho_ticket_id)
//        DO UPDATE SET
//          zoho_ticket_number = EXCLUDED.zoho_ticket_number,
//          subject = EXCLUDED.subject,
//          email = EXCLUDED.email,
//          priority = EXCLUDED.priority,
//          deleted_by = EXCLUDED.deleted_by,
//          deleted_at = NOW(),
//          expires_at = NOW() + INTERVAL '30 days',
//          restored_at = NULL,
//          snapshot = EXCLUDED.snapshot,
//          updated_at = NOW()`,
//       [ticketId, `${ticketNumber}`, subject, email, priority, deletedBy, JSON.stringify(source || {})]
//     );

//     invalidateRuntimeCaches();

//     return res.json({ message: 'Ticket moved to recycle bin' });
//   } catch (err) {
//     console.error('Recycle ticket failed:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to move ticket to recycle bin' });
//   }
// });

// app.post('/api/tickets/recycle-bin/:ticketId/restore', authenticateToken, async (req, res) => {
//   // Invalidate caches
//   invalidateRuntimeCaches();
//   try {
//     const ticketId = (req.params.ticketId || '').toString();
//     const userEmail = (req.user?.email || '').toLowerCase();
//     const result = await pool.query(
//       `UPDATE recycled_tickets
//        SET restored_at = NOW(), updated_at = NOW()
//        WHERE zoho_ticket_id = $1
//          AND restored_at IS NULL
//          AND LOWER(deleted_by) = $2
//        RETURNING zoho_ticket_id`,
//       [ticketId, userEmail]
//     );

//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Ticket not found in recycle bin' });
//     }

//     invalidateRuntimeCaches();

//     return res.json({ message: 'Ticket restored successfully' });
//   } catch (err) {
//     console.error('Restore recycle ticket failed:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to restore ticket' });
//   }
// });

// app.delete('/api/tickets/recycle-bin/:ticketId', authenticateToken, async (req, res) => {
//   try {
//     const ticketId = (req.params.ticketId || '').toString();
//     const userEmail = (req.user?.email || '').toLowerCase();
//     const result = await pool.query(
//       `DELETE FROM recycled_tickets
//        WHERE zoho_ticket_id = $1
//          AND LOWER(deleted_by) = $2
//        RETURNING zoho_ticket_id`,
//       [ticketId, userEmail]
//     );

//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Ticket not found in recycle bin' });
//     }

//     invalidateRuntimeCaches();

//     return res.json({ message: 'Ticket permanently deleted from recycle bin' });
//   } catch (err) {
//     console.error('Permanent delete recycle ticket failed:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to permanently delete ticket' });
//   }
// });

// app.get('/api/tickets/:id',  authenticateToken,async (req, res) => {
//   try {
//     // Include assignee/contact fields so permission checks on the UI are accurate for assigned users.
//     const response = await zohoFetch(`/tickets/${req.params.id}?include=contacts,assignee`);
//     res.json(await response.json());
//   } catch {
//     res.status(500).json({ error: 'Failed to fetch ticket' });
//   }
// });

// app.patch('/api/tickets/:id', authenticateToken, async (req, res) => {
//   try {
//     const payload = req.body || {};
//     if (!payload || Object.keys(payload).length === 0) {
//       return res.status(400).json({ error: 'No update fields provided' });
//     }

//     const response = await zohoFetch(`/tickets/${req.params.id}`, {
//       method: 'PATCH',
//       body: JSON.stringify(payload)
//     });

//     let data = null;
//     try {
//       data = await response.json();
//     } catch {
//       data = null;
//     }

//     // If Zoho rejects status with 422, try common alternate spellings/casing
//     if (!response.ok && response.status === 422 && payload.status) {
//       const alternates = {
//         'in progress': ['In-Progress', 'InProgress', 'in progress', 'In progress'],
//         'open': ['Open'],
//         'closed': ['Closed', 'Resolved'],
//         'resolved': ['Resolved', 'Closed'],
//         'on hold': ['On Hold', 'On-Hold']
//       };
//       const key = (payload.status || '').toLowerCase();
//       const variants = alternates[key] || [];
//       for (const v of variants) {
//         if (v === payload.status) continue;
//         const retry = await zohoFetch(`/tickets/${req.params.id}`, {
//           method: 'PATCH',
//           body: JSON.stringify({ ...payload, status: v })
//         });
//         if (retry.ok) {
//           const retryData = await retry.json().catch(() => null);
//           invalidateRuntimeCaches();
//           return res.json(retryData || { status: 'ok' });
//         }
//       }
//       return res.status(response.status).json(data || { error: 'Failed to update ticket' });
//     }

//     if (!response.ok) {
//       return res.status(response.status).json(data || { error: 'Failed to update ticket' });
//     }

//     // Invalidate counts caches on ticket update (status changes affect counts)
//     invalidateRuntimeCaches();

//     return res.json(data || { status: 'ok' });
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to update ticket', details: err?.message || String(err) });
//   }
// });

// // ── Zoho ticket statuses (dynamic, cached 10 min) ──
// let _zohoStatusesCache = null;
// let _zohoStatusesCacheTime = 0;
// const ZOHO_STATUSES_CACHE_MS = 10 * 60 * 1000;
// app.get('/api/zoho/statuses', authenticateToken, async (req, res) => {
//   if (_zohoStatusesCache && Date.now() - _zohoStatusesCacheTime < ZOHO_STATUSES_CACHE_MS) {
//     return res.json(_zohoStatusesCache);
//   }
//   try {
//     const r = await zohoFetch('/fields?module=tickets');
//     if (r.ok) {
//       const body = await r.json();
//       const fields = body?.fields || body?.data || [];
//       const statusField = fields.find(f =>
//         (f.fieldName || f.apiName || '').toLowerCase() === 'status' ||
//         (f.displayLabel || f.label || '').toLowerCase() === 'status'
//       );
//       if (statusField?.allowedValues?.length) {
//         const statuses = statusField.allowedValues.map(v => v.displayValue || v.value || v).filter(Boolean);
//         _zohoStatusesCache = statuses;
//         _zohoStatusesCacheTime = Date.now();
//         return res.json(statuses);
//       }
//     }
//   } catch {}
//   // Fallback defaults
//   const defaults = ['Open', 'In Progress', 'On Hold', 'Escalated', 'Closed'];
//   _zohoStatusesCache = defaults;
//   _zohoStatusesCacheTime = Date.now();
//   return res.json(defaults);
// });

// // ── Zoho Departments endpoint (cached 10 min) ──
// let _zohoDepartmentsCache = null;
// let _zohoDepartmentsCacheTime = 0;
// app.get('/api/zoho/departments', authenticateToken, async (req, res) => {
//   if (_zohoDepartmentsCache && Date.now() - _zohoDepartmentsCacheTime < 600000) {
//     return res.json(_zohoDepartmentsCache);
//   }
//   try {
//     const r = await zohoFetch('/departments');
//     if (r.ok) {
//       const body = await r.json();
//       const depts = (body?.data || []).map(d => ({ id: d.id, name: d.name }));
//       _zohoDepartmentsCache = depts;
//       _zohoDepartmentsCacheTime = Date.now();
//       return res.json(depts);
//     }
//   } catch {}
//   _zohoDepartmentsCache = [];
//   _zohoDepartmentsCacheTime = Date.now();
//   return res.json([]);
// });

// app.get('/api/tickets/:id/conversations', authenticateToken, async (req, res) => {
//   try {
//     const response = await zohoFetch(`/tickets/${req.params.id}/conversations`);
//     const data = await response.json();
//     if (!response.ok) {
//       return res.status(response.status).json(data);
//     }
//     if (!Array.isArray(data?.data)) {
//       return res.json(data);
//     }

//     // ── Start private-note visibility check in parallel with enrichment ──
//     // so we don't add sequential latency.
//     const requestingEmail = (req.user?.email || '').toLowerCase();
//     const privateNoteCheckPromise = Promise.allSettled([
//       zohoFetch(`/tickets/${req.params.id}?include=contacts,assignee`).then(r => r.ok ? r.json() : {}),
//       pool.query('SELECT assigned_users FROM ticket_assignments WHERE zoho_ticket_id = $1', [req.params.id])
//     ]);

//     // Enrich every conversation entry with detailed comment/thread payload.
//     // Some older email records only expose a truncated description on the list endpoint,
//     // so enriching just the recent items causes the first part to be clipped.
//     const CONV_ENRICH_BATCH = 5;
//     const enrichOne = async (conv) => {
//       try {
//         const convType = (conv.type || '').toLowerCase();
//         const detailEndpoint = convType === 'comment'
//           ? `/tickets/${req.params.id}/comments/${conv.id}`
//           : `/tickets/${req.params.id}/threads/${conv.id}`;

//         const detailRes = await zohoFetch(detailEndpoint);
//         if (detailRes.ok) {
//           const detail = await detailRes.json();
//           const detailData = detail?.data || detail;
//           return { ...conv, ...detailData };
//         }

//         const fallbackEndpoint = convType === 'comment'
//           ? `/tickets/${req.params.id}/threads/${conv.id}`
//           : `/tickets/${req.params.id}/comments/${conv.id}`;
//         const fallbackRes = await zohoFetch(fallbackEndpoint);
//         if (fallbackRes.ok) {
//           const fallback = await fallbackRes.json();
//           const fallbackData = fallback?.data || fallback;
//           return { ...conv, ...fallbackData };
//         }
//       } catch {
//         // ignore enrichment errors, fall back to original
//       }
//       return conv;
//     };

//     const allConvs = data.data || [];
//     const enrichedConvs = [];
//     for (let i = 0; i < allConvs.length; i += CONV_ENRICH_BATCH) {
//       const slice = allConvs.slice(i, i + CONV_ENRICH_BATCH);
//       const enrichedSlice = await Promise.all(slice.map(enrichOne));
//       enrichedConvs.push(...enrichedSlice);
//     }

//     const resultData = enrichedConvs;

//     // Look up actual sender names for replies made through our app
//     const convIds = resultData.map(c => (c.id || '').toString()).filter(Boolean);
//     let replyAuthorMap = new Map();
//     if (convIds.length) {
//       try {
//         const ra = await pool.query(
//           `SELECT zoho_conversation_id, user_name FROM reply_authors WHERE zoho_conversation_id = ANY($1)`,
//           [convIds]
//         );
//         for (const r of ra.rows) replyAuthorMap.set(r.zoho_conversation_id, r.user_name);
//       } catch (e) { console.error('reply_authors lookup error:', e?.message); }
//     }

//     resultData.forEach(conv => {
//       const cid = (conv.id || '').toString();
//       if (replyAuthorMap.has(cid)) {
//         conv.resolvedAuthorName = replyAuthorMap.get(cid);
//         return;
//       }
//       const a = conv.author || {};
//       const c = conv.commenter || {};
//       const fullName = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
//       const commenterName = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
//       conv.resolvedAuthorName =
//         c.name ||
//         commenterName ||
//         a.name ||
//         fullName ||
//         conv.fromName ||
//         conv.submitter?.name ||
//         conv.contact?.name ||
//         [conv.contact?.firstName, conv.contact?.lastName].filter(Boolean).join(' ').trim() ||
//         c.email ||
//         conv.from ||
//         conv.fromEmailAddress ||
//         a.email ||
//         a.emailId ||
//         '';
//     });

//     // ── Resolve private-note visibility (promise was started at top, alongside enrichment) ──
//     let canSeePrivate = false;
//     try {
//       const [ticketFetch, assignmentFetch] = await privateNoteCheckPromise;
//       const ticketData = ticketFetch.status === 'fulfilled' ? (ticketFetch.value || {}) : {};
//       const requesterEmail = (ticketData.email || ticketData.contact?.email || '').toLowerCase();
//       const zohoAssigneeEmail = (ticketData.assignee?.email || ticketData.assignee?.emailId || '').toLowerCase();
//       const supabaseUsers = assignmentFetch.status === 'fulfilled'
//         ? (assignmentFetch.value?.rows?.[0]?.assigned_users || []).map(e => e.toLowerCase())
//         : [];
//       const allowed = new Set([requesterEmail, zohoAssigneeEmail, ...supabaseUsers].filter(Boolean));
//       canSeePrivate = allowed.has(requestingEmail);
//     } catch {
//       canSeePrivate = false;
//     }
//     const visibleData = canSeePrivate
//       ? resultData
//       : resultData.filter(conv => conv.isPublic !== false);

//     res.json({ ...data, data: visibleData });
//   } catch {
//     res.status(500).json({ error: 'Failed to fetch ticket conversations' });
//   }
// });

// app.get('/api/tickets/:id/attachments',  authenticateToken,async (req, res) => {
//   try {
//     const response = await zohoFetch(`/tickets/${req.params.id}/attachments`);
//     const data = await response.json();
//     if (!response.ok) {
//       return res.status(response.status).json(data);
//     }
//     res.json(data);
//   } catch {
//     res.status(500).json({ error: 'Failed to fetch attachments' });
//   }
// });

// app.get('/api/tickets/:id/attachments/:attachmentId', authenticateToken, async (req, res) => {
//   try {
//     const { id, attachmentId } = req.params;
//     let response = await zohoFetch(`/tickets/${id}/attachments/${attachmentId}/content`);

//     // Some Zoho attachment responses are available without the /content suffix.
//     if (!response.ok && response.status === 404) {
//       response = await zohoFetch(`/tickets/${id}/attachments/${attachmentId}`);
//     }

//     if (!response.ok) {
//       let data = null;
//       try {
//         data = await response.json();
//       } catch {
//         data = { error: 'Failed to fetch attachment content' };
//       }
//       return res.status(response.status).json(data);
//     }

//     const contentType = response.headers.get('content-type') || 'application/octet-stream';
//     const disposition = response.headers.get('content-disposition');

//     res.setHeader('Content-Type', contentType);
//     if (req.query.download === '1') {
//       res.setHeader('Content-Disposition', 'attachment');
//     } else if (req.query.inline === '1') {
//       if (disposition && disposition.toLowerCase().includes('filename=')) {
//         const filename = disposition.split('filename=')[1] || '';
//         res.setHeader('Content-Disposition', `inline; filename=${filename}`);
//       } else {
//         res.setHeader('Content-Disposition', 'inline');
//       }
//     } else if (disposition) {
//       res.setHeader('Content-Disposition', disposition);
//     }

//     response.body.pipe(res);
//   } catch {
//     res.status(500).json({ error: 'Failed to download attachment' });
//   }
// });

// app.get('/api/zoho-content', authenticateToken, async (req, res) => {
//   try {
//     const rawPath = (req.query.path || '').toString().trim();
//     if (!rawPath) {
//       return res.status(400).json({ error: 'path query is required' });
//     }

//     // Only allow Zoho Desk API v1 paths.
//     let apiPath = rawPath;
//     if (/^https?:\/\//i.test(rawPath)) {
//       const parsed = new URL(rawPath);
//       apiPath = `${parsed.pathname}${parsed.search || ''}`;
//     }

//     const v1Index = apiPath.toLowerCase().indexOf('/api/v1/');
//     if (v1Index >= 0) {
//       apiPath = apiPath.slice(v1Index + '/api/v1'.length);
//     }

//     if (!apiPath.startsWith('/')) {
//       apiPath = `/${apiPath}`;
//     }

//     const response = await zohoFetch(apiPath);
//     if (!response.ok) {
//       let data = null;
//       try {
//         data = await response.json();
//       } catch {
//         data = { error: 'Failed to fetch Zoho content' };
//       }
//       return res.status(response.status).json(data);
//     }

//     const contentType = response.headers.get('content-type') || 'application/octet-stream';
//     const disposition = response.headers.get('content-disposition');

//     res.setHeader('Content-Type', contentType);
//     if (disposition) {
//       res.setHeader('Content-Disposition', disposition);
//     }

//     response.body.pipe(res);
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to fetch Zoho content', details: err?.message || String(err) });
//   }
// });

// app.post('/api/tickets/:id/attachments', upload.array('attachments'),  authenticateToken,async (req, res) => {
//   try {
//     const files = Array.isArray(req.files) ? req.files : [];
//     if (files.length === 0) {
//       return res.status(400).json({ error: 'No attachments provided' });
//     }

//     const uploaded = [];
//     for (const file of files) {
//       const fd = new FormData();
//       fd.append('file', file.buffer, file.originalname);
//       const upRes = await zohoFetch(`/tickets/${req.params.id}/attachments`, {
//         method: 'POST',
//         body: fd,
//         headers: fd.getHeaders()
//       });
//       const upData = await upRes.json();
//       uploaded.push({ ok: upRes.ok, data: upData });
//     }

//     res.json({ uploaded });
//   } catch {
//     res.status(500).json({ error: 'Failed to upload attachments' });
//   }
// });

// app.post("/api/msal-login", async (req, res) => {
//   try {
//     const { email, accessToken } = req.body;

//     if (!email || !accessToken) {
//       return res.status(400).json({ message: "Missing data" });
//     }

//     const normalize = (v) => (v || '').toString().trim().toLowerCase();
//     const normalizedEmail = normalize(email);
//     const requestedRole = normalize(req.body?.selectedRole || '');
//     const rolesSet = new Set();
//     let roleSource = 'default';

//     if (isAllowlistedAdminEmail(normalizedEmail)) {
//       rolesSet.add('admin');
//       roleSource = 'admin-email-allowlist';
//     }

//     const graphGroups = [];
//     try {
//       let url = 'https://graph.microsoft.com/v1.0/me/transitiveMemberOf/microsoft.graph.group?$select=mail,displayName,mailNickname';

//       while (url) {
//         const graphResponse = await fetch(url, {
//           headers: { Authorization: `Bearer ${accessToken}` }
//         });

//         if (!graphResponse.ok) {
//           console.warn(`[MSAL LOGIN] Graph API check failed for ${normalizedEmail}: ${graphResponse.status}`);
//           break;
//         }

//         const data = await graphResponse.json();
//         const groups = Array.isArray(data?.value) ? data.value : [];
//         graphGroups.push(...groups);
//         url = data['@odata.nextLink'] || '';
//       }
//     } catch (graphErr) {
//       console.warn(`[MSAL LOGIN] Graph API error for ${normalizedEmail}:`, graphErr?.message || graphErr);
//     }

//     for (const roleFromGroup of rolesFromGraphGroups(graphGroups)) {
//       rolesSet.add(roleFromGroup);
//     }
//     if (graphGroups.length > 0 && roleSource === 'default') {
//       roleSource = 'graph-groups';
//     }

//     try {
//       const identifiers = [...new Set(
//         graphGroups.flatMap(g => [g?.mail, g?.displayName, g?.mailNickname])
//           .map(v => normalize(v))
//           .filter(Boolean)
//       )];

//       if (identifiers.length > 0) {
//         const groupBindings = await pool.query(
//           `SELECT group_identifier, roles
//            FROM group_role_bindings
//            WHERE LOWER(group_identifier) = ANY($1)`,
//           [identifiers]
//         );
//         for (const row of groupBindings.rows || []) {
//           for (const role of normalizeRoleList(row.roles || [])) {
//             rolesSet.add(role);
//           }
//         }
//         if ((groupBindings.rows || []).length > 0) {
//           roleSource = 'group_role_bindings-db';
//         }
//       }
//     } catch (groupErr) {
//       console.warn(`[MSAL LOGIN] group role bindings check failed for ${normalizedEmail}:`, groupErr?.message || groupErr);
//     }

//     // Legacy single-role override table (kept for backward compatibility)
//     try {
//       const roleResult = await pool.query(
//         `SELECT role FROM user_roles WHERE LOWER(microsoft_email) = $1 LIMIT 1`,
//         [normalizedEmail]
//       );
//       if (roleResult.rows.length > 0) {
//         const legacyRole = normalizeRole(roleResult.rows[0]?.role);
//         if (legacyRole) {
//           rolesSet.add(legacyRole);
//           roleSource = 'user_roles-db';
//         }
//       }
//     } catch (dbErr) {
//       console.warn(`[MSAL LOGIN] DB role check failed for ${normalizedEmail}:`, dbErr?.message || dbErr);
//     }

//     // Multi-role bindings table
//     try {
//       const bindingResult = await pool.query(
//         `SELECT roles FROM user_role_bindings WHERE LOWER(microsoft_email) = $1 LIMIT 1`,
//         [normalizedEmail]
//       );
//       if (bindingResult.rows.length > 0) {
//         const dbRoles = normalizeRoleList(bindingResult.rows[0]?.roles || []);
//         for (const r of dbRoles) rolesSet.add(r);
//         roleSource = 'user_role_bindings-db';
//       }
//     } catch (dbErr) {
//       console.warn(`[MSAL LOGIN] role bindings check failed for ${normalizedEmail}:`, dbErr?.message || dbErr);
//     }

//     const roles = normalizeRoleList([...rolesSet], null);
//     if (!roles.length) {
//       return res.status(403).json({ message: 'No application role is assigned for this account' });
//     }

//     // Check if user is a member of cloudops group
//     const cloudopsGroupIdentifiers = ROLE_GROUP_MAP['cloudops'] || [];
//     const isCloudOpsMember = graphGroups.some(g => {
//       const values = [g?.mail, g?.displayName, g?.mailNickname]
//         .map(v => (v || '').toString().trim().toLowerCase())
//         .filter(Boolean);
//       return values.some(v => cloudopsGroupIdentifiers.includes(v));
//     });

//     // If user is NOT in cloudops group, force role to 'user' regardless of DB assignment
//     let effectiveRoles = roles;
//     let effectiveRole;
//     if (!isCloudOpsMember && !isAllowlistedAdminEmail(normalizedEmail)) {
//       effectiveRoles = ['user'];
//       effectiveRole = 'user';
//       console.log(`[MSAL LOGIN] ${normalizedEmail} NOT in cloudops group - forcing role=user`);
//     } else {
//       effectiveRole = pickDefaultRole(roles, requestedRole, null);
//     }

//     console.log(`[MSAL LOGIN] ${normalizedEmail} resolved role=${effectiveRole} roles=[${effectiveRoles.join(',')}] isCloudOps=${isCloudOpsMember} via ${roleSource}`);

//     const newAccessToken = jwt.sign(
//       { email: normalizedEmail, role: effectiveRole, roles: effectiveRoles, isCloudOps: isCloudOpsMember },
//       process.env.JWT_SECRET,
//       { expiresIn: "1h" }
//     );

//     const refreshToken = jwt.sign(
//       { email: normalizedEmail, role: effectiveRole, roles: effectiveRoles, isCloudOps: isCloudOpsMember },
//       process.env.JWT_REFRESH_SECRET,
//       { expiresIn: "7d" }
//     );

//     res.json({ accessToken: newAccessToken, refreshToken, role: effectiveRole, roles: effectiveRoles, isCloudOps: isCloudOpsMember });

//   } catch (err) {
//     console.error('MSAL login error:', err?.message);
//     res.status(500).json({ error: "MSAL login failed" });
//   }
// });


// app.post('/api/tickets/:id/reply', upload.array('attachments'),  authenticateToken,async (req, res) => {
//   try {
//     const files = Array.isArray(req.files) ? req.files : [];
//     const content = req.body?.content || '';
//     const senderName = req.body?.senderName || req.user?.email?.split('@')[0] || '';
//     const senderEmail = req.user?.email || '';
//     const isPublicStr = req.body?.isPublic === 'true' ? 'true' : 'false';
//     const isPublicBool = req.body?.isPublic === 'true';

//     // Zoho Desk: public replies → /sendReply (JSON preferred), private notes → /comments
//     // Try JSON first (Zoho Desk v1 documented approach), fall back to form-data.
//     const attempts = isPublicBool ? [
//       { type: 'json', path: `/tickets/${req.params.id}/sendReply`, includeContentType: true },
//       { type: 'json', path: `/tickets/${req.params.id}/sendReply`, includeContentType: false },
//       { type: 'json', path: `/tickets/${req.params.id}/reply`, includeContentType: false },
//       { type: 'json', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
//       { type: 'json', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
//       { type: 'form', path: `/tickets/${req.params.id}/sendReply`, includeContentType: true },
//       { type: 'form', path: `/tickets/${req.params.id}/sendReply`, includeContentType: false },
//       { type: 'form', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
//     ] : [
//       { type: 'json', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
//       { type: 'json', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
//       { type: 'form', path: `/tickets/${req.params.id}/comments`, includeContentType: false },
//       { type: 'form', path: `/tickets/${req.params.id}/threads`, includeContentType: false },
//     ];

//     const errors = [];

//     for (const attempt of attempts) {
//       let response;
//       if (attempt.type === 'form') {
//         const fd = new FormData();
//         fd.append('content', content);
//         fd.append('isPublic', isPublicStr);
//         if (attempt.includeContentType) {
//           fd.append('contentType', 'text/html');
//         }

//         for (const file of files) {
//           fd.append('attachments', file.buffer, file.originalname);
//         }

//         response = await zohoFetch(attempt.path, {
//           method: 'POST',
//           body: fd,
//           headers: fd.getHeaders()
//         });
//       } else {
//         const payload = {
//           content,
//           isPublic: isPublicBool
//         };
//         if (attempt.includeContentType) {
//           payload.contentType = 'text/html';
//         }

//         response = await zohoFetch(attempt.path, {
//           method: 'POST',
//           body: JSON.stringify(payload)
//         });
//       }

//       let data = null;
//       try {
//         data = await response.json();
//       } catch {
//         data = null;
//       }

//       if (response.ok) {
//         const convId = (data?.id || '').toString();
//         if (convId && senderEmail) {
//           pool.query(
//             `INSERT INTO reply_authors (zoho_ticket_id, zoho_conversation_id, user_email, user_name)
//              VALUES ($1, $2, $3, $4) ON CONFLICT (zoho_conversation_id) DO NOTHING`,
//             [req.params.id, convId, senderEmail, senderName]
//           ).catch(e => console.error('Failed to save reply author:', e?.message));
//         }
//         return res.json(data || { status: 'ok' });
//       }

//       errors.push({ status: response.status, data, path: attempt.path });
//     }

//     return res.status(502).json({
//       error: 'Reply failed',
//       attempts: errors
//     });
//   } catch (err) {
//     console.error('Reply error', err);
//     res.status(500).json({
//       error: 'Failed to send reply',
//       message: err?.message || String(err)
//     });
//   }
// });

// app.post('/api/tickets', upload.array('attachments'), authenticateToken, async (req, res) => {
//   try {
//     const isMultipart = req.is('multipart/form-data');
//     const body = isMultipart ? (req.body || {}) : (req.body || {});

//     let payload;
//     if (isMultipart) {
//       let contact = undefined;
//       if (body.contact) {
//         try {
//           contact = JSON.parse(body.contact);
//         } catch {
//           contact = undefined;
//         }
//       }

//       payload = {
//         subject: body.subject,
//         departmentId: body.departmentId,
//         priority: body.priority,
//         description: body.description,
//         status: body.status || 'Open',
//         ...(body.assigneeEmail ? { assigneeEmail: body.assigneeEmail } : {}),
//         contact: contact || {
//           lastName: body.name || body.contactName || '',
//           email: body.email || body.contactEmail || ''
//         }
//       };
//     } else {
//       payload = { ...(body || {}) };
//     }

//     if (!payload.assigneeId && payload.assigneeEmail) {
//       const agentId = await lookupAgentIdByEmail(payload.assigneeEmail);
//       if (agentId) {
//         payload.assigneeId = agentId;
//       } else {
//         return res.status(400).json({
//           errorCode: 'ASSIGNEE_NOT_FOUND',
//           message: 'Assign To email not found as a Zoho Desk agent.'
//         });
//       }
//     }
//     delete payload.assigneeEmail;
//     if (ZOHO_DEPARTMENT_ID) {
//       payload.departmentId = ZOHO_DEPARTMENT_ID;
//     }
//     if (ZOHO_ASSIGNEE_ID) {
//       payload.assigneeId = ZOHO_ASSIGNEE_ID;
//     }

//     const response = await zohoFetch('/tickets', {
//       method: 'POST',
//       body: JSON.stringify(payload)
//     });

//     const data = await response.json();
//     if (!response.ok) {
//       const errorList = Array.isArray(data?.errors)
//         ? data.errors
//         : Array.isArray(data?.details?.errors)
//           ? data.details.errors
//           : Array.isArray(data?.details)
//             ? data.details
//             : [];

//       const assigneeError = errorList.find(e => {
//         const field = (e?.fieldName || '').toString().replace(/^\//, '');
//         return field === 'assigneeId';
//       });

//       if (payload.assigneeId && assigneeError) {
//         const retryPayload = { ...payload };
//         delete retryPayload.assigneeId;

//         const retryResponse = await zohoFetch('/tickets', {
//           method: 'POST',
//           body: JSON.stringify(retryPayload)
//         });

//         const retryData = await retryResponse.json();
//         if (retryResponse.ok) {
//           return res.status(200).json({
//             ...retryData,
//             warning: 'Assignee lacks privilege. Ticket created as Unassigned.'
//           });
//         }
//       }

//       console.error('Zoho create ticket failed:', data);
//       return res.status(response.status).json({
//         errorCode: data?.errorCode,
//         message: data?.message || 'Zoho validation failed',
//         details: data?.details || data
//       });
//     }

//     const files = Array.isArray(req.files) ? req.files : [];
//     if (files.length > 0 && data?.id) {
//       const uploaded = [];
//       for (const file of files) {
//         const fd = new FormData();
//         fd.append('file', file.buffer, file.originalname);
//         const upRes = await zohoFetch(`/tickets/${data.id}/attachments`, {
//           method: 'POST',
//           body: fd,
//           headers: fd.getHeaders()
//         });
//         const upData = await upRes.json();
//         uploaded.push({ ok: upRes.ok, data: upData });
//       }
//       invalidateRuntimeCaches();
//       return res.status(response.status).json({
//         ...data,
//         attachments: uploaded
//       });
//     }

//     invalidateRuntimeCaches();
//     res.status(response.status).json(data);
//   } catch (err) {
//     res.status(500).json({ error: 'Failed to create ticket' });
//   }
// });

// app.patch("/api/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const { role } = req.body;

//     const allowedRoles = SUPPORTED_ROLES.filter(r => r !== 'user');
//     const normalizedRole = normalizeRole(role);
//     if (!normalizedRole || !allowedRoles.includes(normalizedRole)) {
//       return res.status(400).json({ message: "Invalid role", allowed: allowedRoles });
//     }

//     await pool.query(
//       "UPDATE users SET role = $1 WHERE id = $2",
//       [normalizedRole, req.params.id]
//     );

//     res.json({ message: "Role updated" });

//   } catch (err) {
//     res.status(500).json({ message: "Update failed" });
//   }
// });



// app.delete("/api/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const userId = req.params.id;

//     // prevent deleting yourself
//     const result = await pool.query(
//       "SELECT email FROM users WHERE id = $1",
//       [userId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     if (result.rows[0].email === req.user.email) {
//       return res.status(400).json({ message: "You cannot delete yourself" });
//     }

//     await pool.query("DELETE FROM users WHERE id = $1", [userId]);

//     res.json({ message: "User deleted" });

//   } catch (err) {
//     res.status(500).json({ message: "Delete failed" });
//   }
// });

// // -------------------------------------------------------
// // IHUB API
// // -------------------------------------------------------

// app.get('/api/ihub', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT
//         a.*,
//         (a.license_expiry::date - CURRENT_DATE) AS days_to_expiry
//        FROM ihub_assets a
//        ORDER BY a.license_expiry ASC, a.client ASC`
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error('Failed to fetch IHUB assets:', err);
//     res.status(500).json({ message: 'Failed to fetch IHUB assets' });
//   }
// });

// app.post('/api/ihub', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const {
//       client,
//       environment,
//       hostname,
//       ip_address,
//       ihub_version,
//       license_expiry,
//       responsible_person_email,
//       responsible_person_name
//     } = req.body || {};

//     if (!client || !environment || !license_expiry || !responsible_person_email) {
//       return res.status(400).json({ message: 'Missing required IHUB fields' });
//     }

//     if (!isValidDateInput(license_expiry)) {
//       return res.status(400).json({ message: 'Invalid license expiry date' });
//     }

//     const result = await pool.query(
//       `INSERT INTO ihub_assets
//         (client, environment, hostname, ip_address, ihub_version, license_expiry, responsible_person_email, responsible_person_name, created_by, updated_by)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
//        RETURNING *`,
//       [
//         client,
//         environment,
//         hostname || '',
//         ip_address || '',
//         ihub_version || null,
//         normalizeDateOnly(license_expiry),
//         responsible_person_email.toLowerCase(),
//         responsible_person_name || null,
//         (req.user?.email || '').toLowerCase() || null
//       ]
//     );

//     await processIhubAlerts();
//     res.status(201).json(result.rows[0]);
//   } catch (err) {
//     console.error('Failed to create IHUB asset:', err);
//     res.status(500).json({ message: 'Failed to create IHUB asset' });
//   }
// });

// app.put('/api/ihub/:id', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const assetId = parseInt(req.params.id, 10);
//     if (!Number.isInteger(assetId)) {
//       return res.status(400).json({ message: 'Invalid IHUB asset id' });
//     }

//     const {
//       client,
//       environment,
//       hostname,
//       ip_address,
//       ihub_version,
//       license_expiry,
//       responsible_person_email,
//       responsible_person_name
//     } = req.body || {};

//     if (!client || !environment || !license_expiry || !responsible_person_email) {
//       return res.status(400).json({ message: 'Missing required IHUB fields' });
//     }

//     if (!isValidDateInput(license_expiry)) {
//       return res.status(400).json({ message: 'Invalid license expiry date' });
//     }

//     const result = await pool.query(
//       `UPDATE ihub_assets SET
//          client = $1,
//          environment = $2,
//          hostname = $3,
//          ip_address = $4,
//          ihub_version = $5,
//          license_expiry = $6,
//          responsible_person_email = $7,
//          responsible_person_name = $8,
//          updated_by = $9,
//          updated_at = NOW()
//        WHERE id = $10
//        RETURNING *`,
//       [
//         client,
//         environment,
//         hostname || '',
//         ip_address || '',
//         ihub_version || null,
//         normalizeDateOnly(license_expiry),
//         responsible_person_email.toLowerCase(),
//         responsible_person_name || null,
//         (req.user?.email || '').toLowerCase() || null,
//         assetId
//       ]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: 'IHUB asset not found' });
//     }

//     await pool.query(
//       `UPDATE ihub_alert_tickets
//        SET status = 'Superseded', closed_at = NOW()
//        WHERE ihub_asset_id = $1 AND status = 'Open'`,
//       [assetId]
//     );

//     await processIhubAlerts();
//     res.json(result.rows[0]);
//   } catch (err) {
//     console.error('Failed to update IHUB asset:', err);
//     res.status(500).json({ message: 'Failed to update IHUB asset' });
//   }
// });

// app.delete('/api/ihub/:id', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const assetId = parseInt(req.params.id, 10);
//     if (!Number.isInteger(assetId)) {
//       return res.status(400).json({ message: 'Invalid IHUB asset id' });
//     }

//     const existingAsset = await pool.query(
//       'SELECT id FROM ihub_assets WHERE id = $1 LIMIT 1',
//       [assetId]
//     );

//     if (existingAsset.rows.length === 0) {
//       return res.status(404).json({ message: 'IHUB asset not found' });
//     }

//     const alertTicketIdsResult = await pool.query(
//       `SELECT zoho_ticket_id
//        FROM ihub_alert_tickets
//        WHERE ihub_asset_id = $1`,
//       [assetId]
//     );
//     const alertTicketIds = alertTicketIdsResult.rows
//       .map(r => r.zoho_ticket_id)
//       .filter(Boolean);

//     await pool.query('DELETE FROM ihub_assets WHERE id = $1', [assetId]);

//     if (alertTicketIds.length > 0) {
//       await pool.query(
//         `UPDATE ticket_assignments
//          SET status = 'Closed',
//              closed_at = NOW(),
//              closed_by = $1,
//              updated_at = NOW()
//          WHERE zoho_ticket_id = ANY($2::text[])
//            AND category = 'IHUB'`,
//         [(req.user?.email || '').toLowerCase() || null, alertTicketIds]
//       );
//     }

//     res.json({ message: 'IHUB asset deleted successfully' });
//   } catch (err) {
//     console.error('Failed to delete IHUB asset:', err);
//     res.status(500).json({ message: 'Failed to delete IHUB asset' });
//   }
// });

// // -------------------------------------------------------
// // SSL API
// // -------------------------------------------------------

// app.get('/api/ssl', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT
//         s.*,
//         (s.ssl_expiry::date - CURRENT_DATE) AS days_to_expiry
//        FROM ssl_assets s
//        ORDER BY s.ssl_expiry ASC, s.client ASC`
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error('Failed to fetch SSL assets:', err);
//     res.status(500).json({ message: 'Failed to fetch SSL assets' });
//   }
// });

// app.get('/api/automation-ssl', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const statusFilter = (req.query.status || '').toString().trim().toLowerCase();
//     const status = statusFilter && statusFilter !== 'all' ? statusFilter : null;

//     const result = await pool.query(
//       `SELECT
//         a.id,
//         a.alertname,
//         a.milestone_days,
//         a.client,
//         a.environment,
//         a.application,
//         a.instance AS ssl_url,
//         a.responsible,
//         a.responsible_email,
//         a.zoho_ticket_id,
//         a.zoho_ticket_number,
//         a.status,
//         a.created_at,
//         a.updated_at,
//         a.closed_at,
//         (a.created_at::date + make_interval(days => a.milestone_days))::date AS estimated_expiry_on,
//         ((a.created_at::date + make_interval(days => a.milestone_days))::date - CURRENT_DATE) AS estimated_days_to_expiry
//        FROM alertmanager_ssl_tickets a
//        WHERE ($1::text IS NULL OR LOWER(a.status) = $1)
//        ORDER BY estimated_days_to_expiry ASC NULLS LAST, a.created_at DESC`,
//       [status]
//     );

//     return res.json(result.rows);
//   } catch (err) {
//     console.error('Failed to fetch automation SSL entries:', err);
//     return res.status(500).json({ message: 'Failed to fetch automation SSL entries' });
//   }
// });

// app.get('/api/automation-ssl/monitored-urls', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const monitoredRows = await fetchAutomationSslMonitoredUrls();
//     return res.json(monitoredRows);
//   } catch (err) {
//     if (err?.message === 'AUTOMATION_PROMETHEUS_URL is not configured') {
//       return res.status(400).json({ message: err.message });
//     }
//     if (err?.message === 'Failed to fetch SSL expiry metrics from Prometheus') {
//       return res.status(502).json({ message: err.message });
//     }
//     console.error('Failed to fetch monitored automation SSL URLs:', err);
//     return res.status(500).json({ message: 'Failed to fetch monitored automation SSL URLs' });
//   }
// });

// app.post('/api/automation-ssl/process-now', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await processAutomationSslAlerts();
//     return res.json({
//       message: 'Automation SSL processing completed',
//       ...result
//     });
//   } catch (err) {
//     console.error('Failed to process Automation SSL alerts:', err);
//     return res.status(500).json({ message: 'Failed to process Automation SSL alerts' });
//   }
// });

// app.get('/api/automation-ssl/diagnostics', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const diagnostics = global.lastAutomationSslDiagnostics || {
//       message: 'No diagnostics available yet. Run /api/automation-ssl/monitored-urls first.'
//     };
//     return res.json(diagnostics);
//   } catch (err) {
//     console.error('Failed to fetch diagnostics:', err);
//     return res.status(500).json({ message: 'Failed to fetch diagnostics' });
//   }
// });

// app.post('/api/ssl', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const {
//       client,
//       environment,
//       hostname,
//       ip_address,
//       application,
//       version,
//       ssl_url,
//       responsible_person_email,
//       responsible_person_name,
//       ssl_expiry
//     } = req.body || {};

//     if (!client || !environment || !ssl_url || !responsible_person_email || !ssl_expiry) {
//       return res.status(400).json({ message: 'Missing required SSL fields' });
//     }

//     if (!isValidDateInput(ssl_expiry)) {
//       return res.status(400).json({ message: 'Invalid SSL expiry date' });
//     }

//     const result = await pool.query(
//       `INSERT INTO ssl_assets
//         (client, environment, hostname, ip_address, application, version, ssl_url, responsible_person_email, responsible_person_name, ssl_expiry, created_by, updated_by)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
//        RETURNING *`,
//       [
//         client,
//         environment,
//         hostname || '',
//         ip_address || '',
//         application || '',
//         version || null,
//         ssl_url,
//         responsible_person_email.toLowerCase(),
//         responsible_person_name || null,
//         normalizeDateOnly(ssl_expiry),
//         (req.user?.email || '').toLowerCase() || null
//       ]
//     );

//     await processSslAlerts();

//     res.status(201).json(result.rows[0]);
//   } catch (err) {
//     console.error('Failed to create SSL asset:', err);
//     res.status(500).json({ message: 'Failed to create SSL asset' });
//   }
// });

// app.put('/api/ssl/:id', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const assetId = parseInt(req.params.id, 10);
//     if (!Number.isInteger(assetId)) {
//       return res.status(400).json({ message: 'Invalid SSL asset id' });
//     }

//     const {
//       client,
//       environment,
//       hostname,
//       ip_address,
//       application,
//       version,
//       ssl_url,
//       responsible_person_email,
//       responsible_person_name,
//       ssl_expiry
//     } = req.body || {};

//     if (!client || !environment || !ssl_url || !responsible_person_email || !ssl_expiry) {
//       return res.status(400).json({ message: 'Missing required SSL fields' });
//     }

//     if (!isValidDateInput(ssl_expiry)) {
//       return res.status(400).json({ message: 'Invalid SSL expiry date' });
//     }

//     const result = await pool.query(
//       `UPDATE ssl_assets SET
//          client = $1,
//          environment = $2,
//          hostname = $3,
//          ip_address = $4,
//          application = $5,
//          version = $6,
//          ssl_url = $7,
//          responsible_person_email = $8,
//          responsible_person_name = $9,
//          ssl_expiry = $10,
//          updated_by = $11,
//          updated_at = NOW()
//        WHERE id = $12
//        RETURNING *`,
//       [
//         client,
//         environment,
//         hostname || '',
//         ip_address || '',
//         application || '',
//         version || null,
//         ssl_url,
//         responsible_person_email.toLowerCase(),
//         responsible_person_name || null,
//         normalizeDateOnly(ssl_expiry),
//         (req.user?.email || '').toLowerCase() || null,
//         assetId
//       ]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: 'SSL asset not found' });
//     }

//     await processSslAlerts();

//     res.json(result.rows[0]);
//   } catch (err) {
//     console.error('Failed to update SSL asset:', err);
//     res.status(500).json({ message: 'Failed to update SSL asset' });
//   }
// });

// app.delete('/api/ssl/:id', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const assetId = parseInt(req.params.id, 10);
//     if (!Number.isInteger(assetId)) {
//       return res.status(400).json({ message: 'Invalid SSL asset id' });
//     }

//     const result = await pool.query('DELETE FROM ssl_assets WHERE id = $1 RETURNING id', [assetId]);
//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: 'SSL asset not found' });
//     }

//     res.json({ message: 'SSL asset deleted successfully' });
//   } catch (err) {
//     console.error('Failed to delete SSL asset:', err);
//     res.status(500).json({ message: 'Failed to delete SSL asset' });
//   }
// });

// app.post('/api/ssl/run-expiry-check', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     await processSslAlerts();
//     res.json({ message: 'SSL expiry check completed successfully' });
//   } catch (err) {
//     console.error('Failed to run SSL expiry check:', err);
//     res.status(500).json({ message: 'SSL expiry check failed' });
//   }
// });

// // -------------------------------------------------------
// // SSL ALERT TICKETS API
// // -------------------------------------------------------
// app.get('/api/ssl/alerts', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const sslAssetId = req.query.ssl_asset_id;
//     let query = `
//       SELECT 
//         a.id,
//         a.ssl_asset_id,
//         s.client,
//         s.hostname,
//         a.milestone_days,
//         a.ssl_expiry_on,
//         a.zoho_ticket_id,
//         a.zoho_ticket_number,
//         a.status,
//         a.created_at,
//         a.closed_at
//       FROM ssl_expiry_alert_tickets a
//       JOIN ssl_assets s ON a.ssl_asset_id = s.id
//       WHERE a.status = 'Open'
//     `;
//     const params = [];

//     if (sslAssetId) {
//       query += ` AND a.ssl_asset_id = $1`;
//       params.push(sslAssetId);
//     }

//     query += ` ORDER BY a.created_at DESC`;

//     const result = await pool.query(query, params);
//     res.json(result.rows);
//   } catch (err) {
//     console.error('Failed to get SSL alerts:', err);
//     res.status(500).json({ message: 'Failed to get SSL alerts' });
//   }
// });

// app.post('/api/ssl/tickets/:zohoTicketId/close', authenticateToken, async (req, res) => {
//   try {
//     const ticketId = req.params.zohoTicketId;
//     const newExpiryDate = req.body?.new_expiry_date;
//     const userEmail = (req.user?.email || '').toLowerCase();
//     const isAdmin = req.user?.role === 'admin';

//     const assignmentResult = await pool.query(
//       `SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1 LIMIT 1`,
//       [ticketId]
//     );
//     const assignment = assignmentResult.rows[0];

//     if (!assignment || (assignment.category || '').toUpperCase() !== 'SSL') {
//       return res.status(404).json({ message: 'SSL ticket assignment not found' });
//     }

//     const assignedUsers = Array.isArray(assignment.assigned_users)
//       ? assignment.assigned_users.map(u => (u || '').toLowerCase())
//       : [];

//     if (!isAdmin && !assignedUsers.includes(userEmail)) {
//       return res.status(403).json({ message: 'Only responsible person or admin can close SSL ticket' });
//     }

//     const automationAlertResult = await pool.query(
//       `SELECT * FROM alertmanager_ssl_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
//       [ticketId]
//     );
//     const automationAlert = automationAlertResult.rows[0];

//     // Automation SSL tickets are URL-driven; they do not need manual expiry updates while closing.
//     if (automationAlert) {
//       const closedInZoho = await closeZohoTicketWithFallback(ticketId);
//       if (!closedInZoho) {
//         return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
//       }

//       await pool.query(
//         `UPDATE alertmanager_ssl_tickets
//          SET status = 'Closed',
//              closed_at = NOW(),
//              updated_at = NOW()
//          WHERE zoho_ticket_id = $1`,
//         [ticketId]
//       );

//       await pool.query(
//         `UPDATE ticket_assignments
//          SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
//          WHERE zoho_ticket_id = $2`,
//         [userEmail || null, ticketId]
//       );

//       return res.json({
//         message: 'Automation SSL ticket closed successfully'
//       });
//     }

//     if (!isValidDateInput(newExpiryDate)) {
//       return res.status(400).json({ message: 'Valid new_expiry_date is required' });
//     }

//     const alertResult = await pool.query(
//       `SELECT * FROM ssl_expiry_alert_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
//       [ticketId]
//     );
//     const alert = alertResult.rows[0];

//     if (!alert) {
//       return res.status(404).json({ message: 'SSL alert record not found for this ticket' });
//     }

//     const closedInZoho = await closeZohoTicketWithFallback(ticketId);
//     if (!closedInZoho) {
//       return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
//     }

//     const normalizedDate = normalizeDateOnly(newExpiryDate);

//     await pool.query(
//       `UPDATE ssl_assets
//        SET ssl_expiry = $1,
//            updated_by = $2,
//            updated_at = NOW()
//        WHERE id = $3`,
//       [normalizedDate, userEmail || null, alert.ssl_asset_id]
//     );

//     await pool.query(
//       `UPDATE ssl_expiry_alert_tickets
//        SET status = 'Closed', closed_at = NOW()
//        WHERE zoho_ticket_id = $1`,
//       [ticketId]
//     );

//     await pool.query(
//       `UPDATE ssl_expiry_alert_tickets
//        SET status = 'Superseded', closed_at = NOW()
//        WHERE ssl_asset_id = $1 AND status = 'Open'`,
//       [alert.ssl_asset_id]
//     );

//     await pool.query(
//       `UPDATE ticket_assignments
//        SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
//        WHERE zoho_ticket_id = $2`,
//       [userEmail || null, ticketId]
//     );

//     await processSslAlerts();

//     return res.json({
//       message: 'SSL ticket closed and expiry updated',
//       ssl_expiry: normalizedDate
//     });
//   } catch (err) {
//     console.error('Failed to close SSL ticket:', err);
//     return res.status(500).json({ message: 'Failed to close SSL ticket' });
//   }
// });

// app.post('/api/ihub/run-expiry-check', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     await processIhubAlerts();
//     res.json({ message: 'Expiry check completed successfully' });
//   } catch (err) {
//     console.error('Failed to run expiry check:', err);
//     res.status(500).json({ message: 'Expiry check failed' });
//   }
// });

// app.post('/api/ihub/tickets/:zohoTicketId/close', authenticateToken, async (req, res) => {
//   try {
//     const ticketId = req.params.zohoTicketId;
//     const newExpiryDate = req.body?.new_expiry_date;
//     const userEmail = (req.user?.email || '').toLowerCase();
//     const isAdmin = req.user?.role === 'admin';

//     if (!isValidDateInput(newExpiryDate)) {
//       return res.status(400).json({ message: 'Valid new_expiry_date is required' });
//     }

//     const assignmentResult = await pool.query(
//       `SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1 LIMIT 1`,
//       [ticketId]
//     );
//     const assignment = assignmentResult.rows[0];

//     if (!assignment || (assignment.category || '').toUpperCase() !== 'IHUB') {
//       return res.status(404).json({ message: 'IHUB ticket assignment not found' });
//     }

//     const assignedUsers = Array.isArray(assignment.assigned_users)
//       ? assignment.assigned_users.map(u => (u || '').toLowerCase())
//       : [];

//     if (!isAdmin && !assignedUsers.includes(userEmail)) {
//       return res.status(403).json({ message: 'Only responsible person or admin can close IHUB ticket' });
//     }

//     const alertResult = await pool.query(
//       `SELECT * FROM ihub_alert_tickets WHERE zoho_ticket_id = $1 LIMIT 1`,
//       [ticketId]
//     );
//     const alert = alertResult.rows[0];

//     if (!alert) {
//       return res.status(404).json({ message: 'IHUB alert record not found for this ticket' });
//     }

//     const closedInZoho = await closeZohoTicketWithFallback(ticketId);
//     if (!closedInZoho) {
//       return res.status(502).json({ message: 'Failed to close ticket in Zoho' });
//     }

//     const normalizedDate = normalizeDateOnly(newExpiryDate);

//     await pool.query(
//       `UPDATE ihub_assets
//        SET license_expiry = $1,
//            updated_by = $2,
//            updated_at = NOW()
//        WHERE id = $3`,
//       [normalizedDate, userEmail || null, alert.ihub_asset_id]
//     );

//     await pool.query(
//       `UPDATE ihub_alert_tickets
//        SET status = 'Closed', closed_at = NOW()
//        WHERE zoho_ticket_id = $1`,
//       [ticketId]
//     );

//     await pool.query(
//       `UPDATE ihub_alert_tickets
//        SET status = 'Superseded', closed_at = NOW()
//        WHERE ihub_asset_id = $1 AND status = 'Open'`,
//       [alert.ihub_asset_id]
//     );

//     await pool.query(
//       `UPDATE ticket_assignments
//        SET status = 'Closed', closed_at = NOW(), closed_by = $1, updated_at = NOW()
//        WHERE zoho_ticket_id = $2`,
//       [userEmail || null, ticketId]
//     );

//     await processIhubAlerts();

//     return res.json({
//       message: 'IHUB ticket closed and license expiry updated',
//       license_expiry: normalizedDate
//     });
//   } catch (err) {
//     console.error('Failed to close IHUB ticket:', err);
//     return res.status(500).json({ message: 'Failed to close IHUB ticket' });
//   }
// });

// // -------------------------------------------------------
// // TICKET ASSIGNMENTS API (Supabase)
// // -------------------------------------------------------

// // Get all assignments
// app.get("/api/assignments", authenticateToken, async (req, res) => {
//   try {
//     const result = await pool.query(
//       "SELECT * FROM ticket_assignments ORDER BY assigned_at DESC"
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error("Failed to fetch assignments:", err);
//     res.status(500).json({ message: "Failed to fetch assignments" });
//   }
// });

// // Get assignment by Zoho ticket ID
// app.get("/api/assignments/:zohoTicketId", authenticateToken, async (req, res) => {
//   try {
//     const result = await pool.query(
//       "SELECT * FROM ticket_assignments WHERE zoho_ticket_id = $1",
//       [req.params.zohoTicketId]
//     );
    
//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: "Assignment not found" });
//     }
    
//     res.json(result.rows[0]);
//   } catch (err) {
//     console.error("Failed to fetch assignment:", err);
//     res.status(500).json({ message: "Failed to fetch assignment" });
//   }
// });

// // Get assignments by user email
// app.get("/api/assignments/user/:email", authenticateToken, async (req, res) => {
//   try {
//     const email = decodeURIComponent(req.params.email).toLowerCase();
//     const result = await pool.query(
//       "SELECT * FROM ticket_assignments WHERE $1 = ANY(assigned_users) ORDER BY assigned_at DESC",
//       [email]
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error("Failed to fetch user assignments:", err);
//     res.status(500).json({ message: "Failed to fetch user assignments" });
//   }
// });

// // Create new assignment (also syncs to Zoho)
// app.post("/api/assignments", authenticateToken, async (req, res) => {
//   try {
//     const { 
//       zoho_ticket_id, 
//       zoho_ticket_number,
//       assigned_users, 
//       assigned_by,
//       zoho_department_id,
//       status,
//       category
//     } = req.body;

//     if (!zoho_ticket_id || !assigned_users || assigned_users.length === 0 || !assigned_by) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     // Primary assignee is the first user (round-robin)
//     const primary_assignee = assigned_users[0].toLowerCase();
//     const normalizedUsers = assigned_users.map(u => u.toLowerCase());

//     // Insert into Supabase - try with category first, fallback without
//     let result;
//     try {
//       result = await pool.query(
//         `INSERT INTO ticket_assignments 
//           (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status, category)
//          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
//          ON CONFLICT (zoho_ticket_id) DO UPDATE SET
//            assigned_users = EXCLUDED.assigned_users,
//            primary_assignee = EXCLUDED.primary_assignee,
//            reassigned_user = ticket_assignments.primary_assignee,
//            reassigned_at = NOW(),
//            reassigned_by = EXCLUDED.assigned_by,
//            category = COALESCE(EXCLUDED.category, ticket_assignments.category),
//            updated_at = NOW()
//          RETURNING *`,
//         [
//           zoho_ticket_id,
//           zoho_ticket_number || null,
//           normalizedUsers,
//           primary_assignee,
//           assigned_by.toLowerCase(),
//           zoho_department_id || null,
//           status || 'Open',
//           category || null
//         ]
//       );
//     } catch (dbErr) {
//       // Fallback: try without category column (migration not applied)
//       console.log('Trying without category column...');
//       result = await pool.query(
//         `INSERT INTO ticket_assignments 
//           (zoho_ticket_id, zoho_ticket_number, assigned_users, primary_assignee, assigned_by, zoho_department_id, status)
//          VALUES ($1, $2, $3, $4, $5, $6, $7)
//          ON CONFLICT (zoho_ticket_id) DO UPDATE SET
//            assigned_users = EXCLUDED.assigned_users,
//            primary_assignee = EXCLUDED.primary_assignee,
//            reassigned_user = ticket_assignments.primary_assignee,
//            reassigned_at = NOW(),
//            reassigned_by = EXCLUDED.assigned_by,
//            updated_at = NOW()
//          RETURNING *`,
//         [
//           zoho_ticket_id,
//           zoho_ticket_number || null,
//           normalizedUsers,
//           primary_assignee,
//           assigned_by.toLowerCase(),
//           zoho_department_id || null,
//           status || 'Open'
//         ]
//       );
//     }

//     // Sync primary assignee to Zoho Desk
//     try {
//       const agentId = await lookupAgentIdByEmail(primary_assignee);
//       if (agentId) {
//         await zohoFetch(`/tickets/${zoho_ticket_id}`, {
//           method: 'PATCH',
//           body: JSON.stringify({ assigneeId: agentId })
//         });
//       }
//     } catch (zohoErr) {
//       // Don't fail the request, Supabase record is created
//     }

//     invalidateRuntimeCaches();
//     res.json(result.rows[0]);
//   } catch (err) {
//     console.error("Failed to create assignment:", err);
//     res.status(500).json({ message: "Failed to create assignment", error: err.message });
//   }
// });

// // Reassign ticket
// app.put("/api/assignments/reassign", authenticateToken, async (req, res) => {
//   try {
//     const { zoho_ticket_id, new_assigned_users, reassigned_by, category } = req.body;

//     if (!zoho_ticket_id || !new_assigned_users || new_assigned_users.length === 0 || !reassigned_by) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const new_primary = new_assigned_users[0].toLowerCase();
//     const normalizedUsers = new_assigned_users.map(u => u.toLowerCase());
//     const normalizedCategory = (category || '').trim() || null;

//     // Get current assignment
//     const current = await pool.query(
//       "SELECT primary_assignee FROM ticket_assignments WHERE zoho_ticket_id = $1",
//       [zoho_ticket_id]
//     );

//     const old_primary = current.rows[0]?.primary_assignee || null;

//     // Update assignment
//     const result = await pool.query(
//       `UPDATE ticket_assignments SET
//          assigned_users = $1,
//          primary_assignee = $2,
//          reassigned_user = $3,
//          reassigned_at = NOW(),
//          reassigned_by = $4,
//          category = COALESCE($5, category),
//          updated_at = NOW()
//        WHERE zoho_ticket_id = $6
//        RETURNING *`,
//       [normalizedUsers, new_primary, old_primary, reassigned_by.toLowerCase(), normalizedCategory, zoho_ticket_id]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: "Assignment not found" });
//     }

//     // Sync new primary assignee to Zoho Desk
//     try {
//       const agentId = await lookupAgentIdByEmail(new_primary);
//       if (agentId) {
//         await zohoFetch(`/tickets/${zoho_ticket_id}`, {
//           method: 'PATCH',
//           body: JSON.stringify({ assigneeId: agentId })
//         });
//       }
//     } catch (zohoErr) {
//       // Silently fail; DB record is primary source of truth
//     }

//     invalidateRuntimeCaches();
//     res.json(result.rows[0]);
//   } catch (err) {
//     console.error("Failed to reassign:", err);
//     res.status(500).json({ message: "Failed to reassign ticket" });
//   }
// });

// // Bulk assign (round-robin distribution)
// app.post("/api/assignments/bulk", authenticateToken, async (req, res) => {
//   try {
//     const { ticket_ids, assigned_users, assigned_by, ticket_categories } = req.body;

//     if (!ticket_ids || ticket_ids.length === 0 || !assigned_users || assigned_users.length === 0 || !assigned_by) {
//       return res.status(400).json({ message: "Missing required fields" });
//     }

//     const normalizedUsers = assigned_users.map(u => u.toLowerCase());
//     const success = [];
//     const failed = [];

//     // Round-robin distribution
//     for (let i = 0; i < ticket_ids.length; i++) {
//       const ticketId = ticket_ids[i];
//       const primaryIndex = i % normalizedUsers.length;
//       const primaryAssignee = normalizedUsers[primaryIndex];

//       try {
//         const category = ticket_categories?.[ticketId] || null;
//         // Insert/update assignment
//         await pool.query(
//           `INSERT INTO ticket_assignments 
//             (zoho_ticket_id, assigned_users, primary_assignee, assigned_by, status, category)
//            VALUES ($1, $2, $3, $4, 'Open', $5)
//            ON CONFLICT (zoho_ticket_id) DO UPDATE SET
//              assigned_users = EXCLUDED.assigned_users,
//              primary_assignee = EXCLUDED.primary_assignee,
//              reassigned_user = ticket_assignments.primary_assignee,
//              reassigned_at = NOW(),
//              reassigned_by = EXCLUDED.assigned_by,
//              category = COALESCE(EXCLUDED.category, ticket_assignments.category),
//              updated_at = NOW()`,
//           [ticketId, [primaryAssignee], primaryAssignee, assigned_by.toLowerCase(), category]
//         );

//         // Sync to Zoho
//         try {
//           const agentId = await lookupAgentIdByEmail(primaryAssignee);
//           if (agentId) {
//             await zohoFetch(`/tickets/${ticketId}`, {
//               method: 'PATCH',
//               body: JSON.stringify({ assigneeId: agentId })
//             });
//           }
//         } catch (zohoErr) {
//           console.error(`Failed to sync ticket ${ticketId} to Zoho:`, zohoErr);
//         }

//         success.push(ticketId);
//       } catch (err) {
//         console.error(`Failed to assign ticket ${ticketId}:`, err);
//         failed.push(ticketId);
//       }
//     }

//     invalidateRuntimeCaches();
//     res.json({ success, failed });
//   } catch (err) {
//     console.error("Bulk assign failed:", err);
//     res.status(500).json({ message: "Bulk assign failed" });
//   }
// });

// // Close assignment
// app.put("/api/assignments/:zohoTicketId/close", authenticateToken, async (req, res) => {
//   try {
//     const { closed_by } = req.body;
    
//     const result = await pool.query(
//       `UPDATE ticket_assignments SET
//          status = 'Closed',
//          closed_at = NOW(),
//          closed_by = $1,
//          updated_at = NOW()
//        WHERE zoho_ticket_id = $2
//        RETURNING *`,
//       [closed_by?.toLowerCase() || null, req.params.zohoTicketId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: "Assignment not found" });
//     }

//     invalidateRuntimeCaches();
//     res.json(result.rows[0]);
//   } catch (err) {
//     console.error("Failed to close assignment:", err);
//     res.status(500).json({ message: "Failed to close assignment" });
//   }
// });

// // Delete assignment
// app.delete("/api/assignments/:zohoTicketId", authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       "DELETE FROM ticket_assignments WHERE zoho_ticket_id = $1 RETURNING *",
//       [req.params.zohoTicketId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: "Assignment not found" });
//     }

//     invalidateRuntimeCaches();
//     res.json({ message: "Assignment deleted" });
//   } catch (err) {
//     console.error("Failed to delete assignment:", err);
//     res.status(500).json({ message: "Failed to delete assignment" });
//   }
// });

// // Get all users (for assignment dropdown)
// app.get("/api/assignable-users", authenticateToken, async (req, res) => {
//   try {
//     const result = await pool.query(
//       "SELECT id, email, role FROM users WHERE role IN ('admin', 'support', 'user') ORDER BY email ASC"
//     );
//     res.json(result.rows);
//   } catch (err) {
//     console.error("Failed to fetch assignable users:", err);
//     res.status(500).json({ message: "Failed to fetch users" });
//   }
// });

// // Admin: resolve group members by group email (cloudops@muraai.com)
// app.get("/api/admin/group-members", authenticateToken, authorizeElevated, async (req, res) => {
//   try {
//     const groupEmail = (req.query.groupEmail || '').toString().trim().toLowerCase();
//     if (!groupEmail) {
//       return res.status(400).json({ message: "Missing groupEmail" });
//     }

//     const token = getGraphToken(req);
//     if (!token) {
//       return res.status(401).json({ message: "Missing access token" });
//     }

//     const groupLookupUrl =
//       `https://graph.microsoft.com/v1.0/groups?$filter=mail eq '${groupEmail}'&$select=id,displayName,mail`;

//     let groupResponse = await fetch(groupLookupUrl, {
//       headers: { Authorization: `Bearer ${token}` }
//     });

//     if (!groupResponse.ok) {
//       return res.status(401).json({ message: "Graph group lookup failed" });
//     }

//     let groupData = await groupResponse.json();
//     let group = (groupData.value || [])[0];

//     if (!group) {
//       const fallbackUrl =
//         `https://graph.microsoft.com/v1.0/groups?$filter=displayName eq '${groupEmail}'&$select=id,displayName,mail`;
//       groupResponse = await fetch(fallbackUrl, {
//         headers: { Authorization: `Bearer ${token}` }
//       });

//       if (!groupResponse.ok) {
//         return res.status(401).json({ message: "Graph group lookup failed" });
//       }

//       groupData = await groupResponse.json();
//       group = (groupData.value || [])[0];
//     }

//     if (!group?.id) {
//       return res.json({ members: [] });
//     }

//     let membersUrl =
//       `https://graph.microsoft.com/v1.0/groups/${group.id}/members?$select=mail,userPrincipalName,displayName&$top=100`;
//     const members = [];

//     while (membersUrl) {
//       const response = await fetch(membersUrl, {
//         headers: { Authorization: `Bearer ${token}` }
//       });

//       if (!response.ok) {
//         return res.status(401).json({ message: "Graph members request failed" });
//       }

//       const data = await response.json();
//       const items = Array.isArray(data.value) ? data.value : [];

//       items.forEach(u => {
//         const email = (u.mail || u.userPrincipalName || '').trim().toLowerCase();
//         const displayName = (u.displayName || '').trim();
//         if (email && !email.includes('#ext#')) {
//           members.push({ email, displayName });
//         }
//       });

//       membersUrl = data['@odata.nextLink'] || '';
//     }

//     res.json({ members });
//   } catch (err) {
//     console.error("Group member lookup failed:", err);
//     res.status(500).json({ message: "Group member lookup failed" });
//   }
// });

// app.get('/api/admin/group-roles', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT id, group_identifier, roles, assigned_by, assigned_at, updated_at, notes
//        FROM group_role_bindings
//        ORDER BY updated_at DESC`
//     );
//     return res.json({ groups: result.rows, count: result.rows.length });
//   } catch (err) {
//     console.error('Failed to fetch group roles:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to fetch group roles' });
//   }
// });

// app.post('/api/admin/group-roles', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const groupIdentifier = (req.body?.groupIdentifier || '').toString().trim().toLowerCase();
//     const roles = normalizeRoleList(req.body?.roles || []);
//     const notes = (req.body?.notes || '').toString().trim() || null;
//     const adminEmail = (req.user?.email || '').toLowerCase();

//     if (!groupIdentifier) {
//       return res.status(400).json({ error: 'groupIdentifier is required' });
//     }

//     const result = await pool.query(
//       `INSERT INTO group_role_bindings (group_identifier, roles, assigned_by, notes, assigned_at, updated_at)
//        VALUES ($1, $2::text[], $3, $4, NOW(), NOW())
//        ON CONFLICT (group_identifier)
//        DO UPDATE SET
//          roles = EXCLUDED.roles,
//          assigned_by = EXCLUDED.assigned_by,
//          notes = EXCLUDED.notes,
//          updated_at = NOW()
//        RETURNING id, group_identifier, roles, assigned_by, assigned_at, updated_at, notes`,
//       [groupIdentifier, roles, adminEmail, notes]
//     );

//     return res.json({ success: true, group: result.rows[0] });
//   } catch (err) {
//     console.error('Failed to upsert group roles:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to upsert group roles' });
//   }
// });

// app.delete('/api/admin/group-roles/:groupIdentifier', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const groupIdentifier = (req.params.groupIdentifier || '').toString().trim().toLowerCase();
//     const result = await pool.query(
//       `DELETE FROM group_role_bindings WHERE LOWER(group_identifier) = $1 RETURNING group_identifier, roles`,
//       [groupIdentifier]
//     );
//     if (result.rowCount === 0) {
//       return res.status(404).json({ error: 'Group role assignment not found' });
//     }
//     return res.json({ success: true, group: result.rows[0] });
//   } catch (err) {
//     console.error('Failed to delete group roles:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to delete group roles' });
//   }
// });

// // Admin: assignments report (for cloudops group members)
// app.get("/api/admin/assignments-report", authenticateToken, authorizeElevated, async (req, res) => {
//   try {
//     const userRole = (req.user?.role || '').toLowerCase();
//     const requestedDeptId = (req.query.departmentId || '').toString().trim();
//     const allowedDeptIds = getAllowedDepartmentIdsForRole(userRole); // [] for admin means "all"

//     let query, params;
//     if (userRole === 'admin') {
//       if (requestedDeptId) {
//         query = 'SELECT * FROM ticket_assignments WHERE zoho_department_id = $1 ORDER BY assigned_at DESC';
//         params = [requestedDeptId];
//       } else {
//         query = 'SELECT * FROM ticket_assignments ORDER BY assigned_at DESC';
//         params = [];
//       }
//     } else if (allowedDeptIds.length > 0) {
//       query = 'SELECT * FROM ticket_assignments WHERE zoho_department_id = ANY($1) ORDER BY assigned_at DESC';
//       params = [allowedDeptIds];
//     } else {
//       query = 'SELECT * FROM ticket_assignments ORDER BY assigned_at DESC';
//       params = [];
//     }

//     const result = await pool.query(query, params);
//     res.json({ assignments: result.rows });
//   } catch (err) {
//     res.status(500).json({ message: "Failed to fetch assignments report" });
//   }
// });

// // Admin/elevated: live Zoho ticket report source (assignment-shaped payload)
// app.get('/api/admin/tickets-report', authenticateToken, authorizeElevated, async (req, res) => {
//   try {
//     const userRole = (req.user?.role || '').toLowerCase();
//     const requestedDeptId = (req.query.departmentId || '').toString().trim();
//     const isAdmin = userRole === 'admin';

//     let allowedDeptIds = getAllowedDepartmentIdsForRole(userRole);
//     if (isAdmin && requestedDeptId) {
//       allowedDeptIds = [requestedDeptId];
//     }

//     const hasSingleDept = Array.isArray(allowedDeptIds) && allowedDeptIds.length === 1;
//     const deptQuery = hasSingleDept ? `&departmentId=${encodeURIComponent(allowedDeptIds[0])}` : '';
//     const include = 'contacts,assignee';
//     const pageSize = 100;
//     const maxFrom = 10000;
//     const statuses = ['Open', 'In Progress', 'On Hold', 'Escalated', 'Closed', 'Resolved'];

//     const recycledTicketIds = await getActiveRecycledTicketIds();
//     const seen = new Set();
//     const normalizedRows = [];

//     const toCategory = (ticket) => {
//       const direct = [
//         ticket?.category,
//         ticket?.ticketCategory,
//         ticket?.issueCategory,
//         ticket?.subCategory,
//         ticket?.subcategory
//       ];
//       for (const candidate of direct) {
//         if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
//       }
//       return extractCategoryFromZohoTicket(ticket) || 'Uncategorized';
//     };

//     for (const status of statuses) {
//       for (let from = 0; from <= maxFrom; from += pageSize) {
//         const endpoint = `/tickets?limit=${pageSize}&from=${from}&status=${encodeURIComponent(status)}&include=${include}${deptQuery}`;
//         let response;
//         try {
//           response = await zohoFetch(endpoint);
//         } catch (err) {
//           console.error(`[tickets-report] fetch failed for status=${status}, from=${from}:`, err?.message || err);
//           break;
//         }

//         if (!response.ok) {
//           // Treat status-specific failures as partial and continue with others.
//           console.warn(`[tickets-report] Zoho returned ${response.status} for status=${status}, from=${from}`);
//           break;
//         }

//         let data;
//         try {
//           data = await response.json();
//         } catch {
//           break;
//         }

//         const tickets = Array.isArray(data?.data) ? data.data : [];
//         for (const t of tickets) {
//           const tid = (t?.id || '').toString();
//           if (!tid || seen.has(tid) || recycledTicketIds.has(tid)) continue;
//           if (!isDepartmentAllowed(t, allowedDeptIds)) continue;

//           seen.add(tid);

//           const assigneeEmail = (
//             t?.assignee?.email ||
//             t?.assignee?.emailId ||
//             t?.assignedTo ||
//             ''
//           ).toString().trim().toLowerCase();

//           const assignedUsers = assigneeEmail ? [assigneeEmail] : [];
//           const createdTime = (
//             t?.createdTime ||
//             t?.createdAt ||
//             t?.created_at ||
//             t?.createdDate ||
//             ''
//           ).toString();

//           const ticketStatus = (t?.status || '').toString();
//           const lowerStatus = ticketStatus.toLowerCase();
//           const modifiedTime = (
//             t?.modifiedTime ||
//             t?.updatedTime ||
//             t?.updated_at ||
//             ''
//           ).toString();

//           const closedAt = (lowerStatus.includes('closed') || lowerStatus.includes('resolved'))
//             ? (t?.closedTime || modifiedTime || '')
//             : '';

//           normalizedRows.push({
//             zoho_ticket_id: tid,
//             zoho_ticket_number: (t?.ticketNumber || t?.ticket_number || '').toString(),
//             assigned_users: assignedUsers,
//             primary_assignee: assigneeEmail,
//             assigned_by: (
//               t?.email ||
//               t?.contact?.email ||
//               t?.contact?.emailAddress ||
//               t?.requester?.email ||
//               ''
//             ).toString().trim().toLowerCase(),
//             assigned_at: createdTime,
//             closed_at: closedAt,
//             closed_by: assigneeEmail,
//             zoho_department_id: extractTicketDepartmentId(t),
//             category: toCategory(t),
//             status: ticketStatus
//           });
//         }

//         const more = data?.info?.moreRecords ?? (tickets.length >= pageSize);
//         if (!more) break;
//       }
//     }

//     res.json({ assignments: normalizedRows });
//   } catch (err) {
//     console.error('Tickets report error:', err?.message || err);
//     res.status(500).json({ message: 'Failed to fetch tickets report' });
//   }
// });

// function extractCategoryFromZohoTicket(rawTicket) {
//   const ticket = rawTicket?.data || rawTicket || {};

//   const readValue = (value) => {
//     if (!value) return '';
//     if (typeof value === 'string') return value.trim();
//     if (typeof value === 'object') {
//       const candidate = value.name || value.displayName || value.label || value.value;
//       return typeof candidate === 'string' ? candidate.trim() : '';
//     }
//     return '';
//   };

//   const directCandidates = [
//     ticket.category,
//     ticket.ticketCategory,
//     ticket.issueCategory,
//     ticket.subCategory,
//     ticket.subcategory
//   ];

//   for (const candidate of directCandidates) {
//     const val = readValue(candidate);
//     if (val) return val;
//   }

//   const fieldContainers = [
//     ticket.customFields,
//     ticket.custom_fields,
//     ticket.cf,
//     ticket.fields
//   ].filter(Boolean);

//   for (const container of fieldContainers) {
//     for (const [key, value] of Object.entries(container)) {
//       if (!/category/i.test(key)) continue;
//       const val = readValue(value);
//       if (val) return val;
//     }
//   }

//   return '';
// }

// // Admin: backfill categories from Zoho for assignments that are NULL/Uncategorized
// app.post("/api/admin/backfill-categories", authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const result = await pool.query(
//       `SELECT zoho_ticket_id FROM ticket_assignments
//        WHERE category IS NULL
//           OR TRIM(category) = ''
//           OR LOWER(TRIM(category)) IN ('uncategorized', 'uncategorised', 'uncategory')
//        ORDER BY assigned_at DESC`
//     );

//     const rows = result.rows;
//     let updated = 0;
//     let failed = 0;

//     for (const row of rows) {
//       try {
//         const ticketRes = await zohoFetch(`/tickets/${row.zoho_ticket_id}`);
//         if (!ticketRes.ok) { failed++; continue; }
//         const ticket = await ticketRes.json();
//         const category = extractCategoryFromZohoTicket(ticket);
//         if (!category) { failed++; continue; }

//         await pool.query(
//           `UPDATE ticket_assignments SET category = $1, updated_at = NOW() WHERE zoho_ticket_id = $2`,
//           [category, row.zoho_ticket_id]
//         );
//         updated++;
//       } catch (innerErr) {
//         failed++;
//       }
//     }

//     res.json({ total: rows.length, updated, failed });
//   } catch (err) {
//     console.error("Backfill categories failed:", err);
//     res.status(500).json({ message: "Backfill failed" });
//   }
// });

// // -------------------------------------------------------
// // ADMIN: USER ROLE MANAGEMENT API
// // -------------------------------------------------------

// // GET /api/admin/user-roles - List all stored user roles from database
// app.get('/api/admin/user-roles', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const [bindingsRes, legacyRes] = await Promise.all([
//       pool.query(
//         `SELECT
//            id,
//            microsoft_email,
//            roles,
//            assigned_by,
//            assigned_at,
//            updated_at,
//            notes
//          FROM user_role_bindings
//          ORDER BY updated_at DESC`
//       ),
//       pool.query(
//         `SELECT microsoft_email, role, assigned_by, assigned_at, updated_at, notes
//          FROM user_roles`
//       )
//     ]);

//     const merged = new Map();
//     for (const row of legacyRes.rows || []) {
//       const email = (row.microsoft_email || '').toLowerCase();
//       if (!email) continue;
//       merged.set(email, {
//         id: null,
//         microsoft_email: email,
//         roles: normalizeRoleList([row.role], null),
//         role: normalizeRole(row.role) || null,
//         assigned_by: row.assigned_by || null,
//         assigned_at: row.assigned_at || null,
//         updated_at: row.updated_at || null,
//         notes: row.notes || null
//       });
//     }

//     for (const row of bindingsRes.rows || []) {
//       const email = (row.microsoft_email || '').toLowerCase();
//       if (!email) continue;
//       const roles = normalizeRoleList(row.roles || [], null);
//       merged.set(email, {
//         id: row.id,
//         microsoft_email: email,
//         roles,
//         role: pickDefaultRole(roles, null, null),
//         assigned_by: row.assigned_by || null,
//         assigned_at: row.assigned_at || null,
//         updated_at: row.updated_at || null,
//         notes: row.notes || null
//       });
//     }

//     const users = [...merged.values()].sort((a, b) =>
//       new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
//     );

//     return res.json({ users, count: users.length });
//   } catch (err) {
//     console.error('Failed to fetch user roles:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to fetch user roles' });
//   }
// });

// // POST /api/admin/users/:email/role - Assign/update role for a user
// app.post('/api/admin/users/:email/role', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const { role: newRole, roles: incomingRoles, notes } = req.body;
//     const userEmail = (req.params.email || '').toString().toLowerCase().trim();
//     const adminEmail = (req.user?.email || '').toLowerCase();

//     if (!userEmail) {
//       return res.status(400).json({ error: 'User email is required' });
//     }

//     const resolvedRoles = Array.isArray(incomingRoles)
//       ? normalizeRoleList(incomingRoles, null)
//       : normalizeRoleList([newRole], null);

//     const invalidInputRoles = Array.isArray(incomingRoles)
//       ? incomingRoles.filter(r => !normalizeRole(r))
//       : (newRole && !normalizeRole(newRole) ? [newRole] : []);

//     if (invalidInputRoles.length > 0) {
//       return res.status(400).json({
//         error: `Invalid roles: ${invalidInputRoles.join(', ')}`,
//         allowed: SUPPORTED_ROLES
//       });
//     }

//     const primaryRole = pickDefaultRole(resolvedRoles, null, null);

//     if (!resolvedRoles.length || !primaryRole) {
//       return res.status(400).json({
//         error: 'At least one valid application role is required',
//         allowed: SUPPORTED_ROLES.filter(role => role !== 'user')
//       });
//     }

//     const [bindingResult, legacyResult] = await Promise.all([
//       pool.query(
//         `INSERT INTO user_role_bindings (microsoft_email, roles, assigned_by, notes, assigned_at, updated_at)
//          VALUES ($1, $2::text[], $3, $4, NOW(), NOW())
//          ON CONFLICT (microsoft_email)
//          DO UPDATE SET
//            roles = EXCLUDED.roles,
//            assigned_by = EXCLUDED.assigned_by,
//            notes = EXCLUDED.notes,
//            updated_at = NOW()
//          RETURNING id, microsoft_email, roles, assigned_by, assigned_at, updated_at, notes`,
//         [userEmail, resolvedRoles, adminEmail, notes || null]
//       ),
//       // Keep legacy table in sync for backward compatibility.
//       pool.query(
//         `INSERT INTO user_roles (microsoft_email, role, assigned_by, notes, assigned_at, updated_at)
//          VALUES ($1, $2, $3, $4, NOW(), NOW())
//          ON CONFLICT (microsoft_email)
//          DO UPDATE SET
//            role = EXCLUDED.role,
//            assigned_by = EXCLUDED.assigned_by,
//            notes = EXCLUDED.notes,
//            updated_at = NOW()
//          RETURNING microsoft_email, role`,
//         [userEmail, primaryRole, adminEmail, notes || null]
//       )
//     ]);

//     console.log(`[ADMIN] Roles assigned: ${userEmail} → [${resolvedRoles.join(',')}] by ${adminEmail}`);

//     return res.json({
//       success: true,
//       message: `Roles updated for ${userEmail}`,
//       user: {
//         ...bindingResult.rows[0],
//         role: legacyResult.rows[0]?.role || primaryRole,
//         roles: normalizeRoleList(bindingResult.rows[0]?.roles || resolvedRoles)
//       }
//     });
//   } catch (err) {
//     console.error('Failed to assign role:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to assign role' });
//   }
// });

// // GET /api/admin/users - Get paginated list of Microsoft users (from Graph)
// app.get('/api/admin/users', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const pageSize = parseInt(req.query.pageSize) || 50;
//     const skip = (page - 1) * pageSize;
//     const searchText = (req.query.search || '').toString().trim();

//     // Use explicit Graph token from frontend (MSAL), not app JWT.
//     const adminAccessToken = (req.headers['x-graph-token'] || '').toString().trim();
    
//     if (!adminAccessToken) {
//       return res.status(400).json({ error: 'No Microsoft Graph token provided' });
//     }

//     // Fetch users from Microsoft Graph
//     let graphUrl = `https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,displayName,mail&$top=${pageSize}&$skip=${skip}&$orderby=displayName`;

//     if (searchText) {
//       graphUrl += `&$filter=contains(displayName,'${searchText}') or contains(mail,'${searchText}')`;
//     }

//     const graphResponse = await fetch(graphUrl, {
//       headers: { 
//         Authorization: `Bearer ${adminAccessToken}`,
//         'Content-Type': 'application/json'
//       }
//     });

//     if (!graphResponse.ok) {
//       console.warn(`Graph API users fetch failed: ${graphResponse.status}`);
//       return res.status(graphResponse.status).json({ 
//         error: 'Failed to fetch users from Microsoft Graph',
//         details: `Graph API returned ${graphResponse.status}`
//       });
//     }

//     const graphData = await graphResponse.json();
//     const graphUsers = Array.isArray(graphData?.value) ? graphData.value : [];

//     // Enrich with stored roles from DB
//     const userEmails = graphUsers.map(u => (u.mail || '').toLowerCase()).filter(Boolean);
//     let storedRoles = new Map();

//     if (userEmails.length > 0) {
//       const [bindingRes, legacyRes] = await Promise.all([
//         pool.query(
//           `SELECT microsoft_email, roles, assigned_by, assigned_at, updated_at
//            FROM user_role_bindings
//            WHERE LOWER(microsoft_email) = ANY($1)`,
//           [userEmails]
//         ),
//         pool.query(
//           `SELECT microsoft_email, role, assigned_by, assigned_at, updated_at
//            FROM user_roles
//            WHERE LOWER(microsoft_email) = ANY($1)`,
//           [userEmails]
//         )
//       ]);

//       legacyRes.rows.forEach(row => {
//         storedRoles.set((row.microsoft_email || '').toLowerCase(), {
//           ...row,
//           roles: normalizeRoleList([row.role], null)
//         });
//       });
//       bindingRes.rows.forEach(row => {
//         storedRoles.set((row.microsoft_email || '').toLowerCase(), {
//           ...row,
//           roles: normalizeRoleList(row.roles || [], null)
//         });
//       });
//     }

//     const enrichedUsers = graphUsers.map(u => {
//       const email = (u.mail || '').toLowerCase();
//       const storedRole = storedRoles.get(email);
//       return {
//         id: u.id,
//         email: u.mail || u.userPrincipalName,
//         displayName: u.displayName,
//         userPrincipalName: u.userPrincipalName,
//         currentRole: pickDefaultRole(storedRole?.roles || [storedRole?.role], null, null),
//         roles: normalizeRoleList(storedRole?.roles || [storedRole?.role], null),
//         assignedBy: storedRole?.assigned_by || null,
//         assignedAt: storedRole?.assigned_at || null,
//         updatedAt: storedRole?.updated_at || null
//       };
//     });

//     return res.json({
//       users: enrichedUsers,
//       page,
//       pageSize,
//       count: enrichedUsers.length,
//       hasMore: enrichedUsers.length === pageSize
//     });
//   } catch (err) {
//     console.error('Failed to fetch Graph users:', err?.message || err);
//     return res.status(500).json({ 
//       error: 'Failed to fetch users',
//       details: err?.message
//     });
//   }
// });

// // DELETE /api/admin/users/:email/role - Remove stored role assignment (reverts to Graph group + default)
// app.delete('/api/admin/users/:email/role', authenticateToken, authorizeAdmin, async (req, res) => {
//   try {
//     const userEmail = (req.params.email || '').toString().toLowerCase().trim();
//     const adminEmail = (req.user?.email || '').toLowerCase();

//     if (!userEmail) {
//       return res.status(400).json({ error: 'User email is required' });
//     }

//     const [bindingDelete, legacyDelete] = await Promise.all([
//       pool.query(
//         `DELETE FROM user_role_bindings
//          WHERE LOWER(microsoft_email) = $1
//          RETURNING microsoft_email, roles`,
//         [userEmail]
//       ),
//       pool.query(
//         `DELETE FROM user_roles
//          WHERE LOWER(microsoft_email) = $1
//          RETURNING microsoft_email, role`,
//         [userEmail]
//       )
//     ]);

//     if (bindingDelete.rowCount === 0 && legacyDelete.rowCount === 0) {
//       return res.status(404).json({ error: 'No role assignment found for this user' });
//     }

//     console.log(`[ADMIN] Role assignment deleted: ${userEmail} by ${adminEmail}`);

//     return res.json({
//       success: true,
//       message: `Role assignment removed for ${userEmail}. User will revert to Graph group-based role.`,
//       user: bindingDelete.rows[0] || legacyDelete.rows[0]
//     });
//   } catch (err) {
//     console.error('Failed to delete role assignment:', err?.message || err);
//     return res.status(500).json({ error: 'Failed to delete role assignment' });
//   }
// });

// // Report / Suggestion email endpoint
// app.post('/api/feedback/report', authenticateToken, async (req, res) => {
//   try {
//     const content = (req.body?.content || '').toString().trim();
//     const includeName = Boolean(req.body?.includeName);
//     const userEmail = (req.user?.email || '').toString().trim();

//     if (!content) {
//       return res.status(400).json({ error: 'Content is required' });
//     }

//     const targetEmail = process.env.FEEDBACK_TARGET_EMAIL || 'sutharsan.t@muraai.com';
//     const fromEmail = process.env.FEEDBACK_FROM_EMAIL || 'no-reply@muraai.com';
//     const submitter = includeName && userEmail ? userEmail : 'Anonymous';
//     const role = (req.user?.role || 'user').toString();
//     const submittedAt = new Date().toISOString();

//     const mailContent = [
//       'New report/suggestion submitted from Influx web app.',
//       '',
//       `Submitted By: ${submitter}`,
//       `User Role: ${role}`,
//       `Submitted At: ${submittedAt}`,
//       `Application: Influx ITSM`,
//       '',
//       'Content:',
//       content
//     ].join('\n');

//     console.log(`[FEEDBACK] Report received from ${submitter}:\n${mailContent}\n`);

//     // Send via Azure Graph API
//     const emailSent = await sendEmailViaAzure(
//       fromEmail,
//       targetEmail,
//       'Influx App - Report/Suggestion',
//       mailContent,
//       { email: userEmail, role }
//     );

//     return res.json({ 
//       success: true, 
//       message: emailSent 
//         ? 'Feedback sent successfully' 
//         : 'Feedback received (email delivery skipped due to configuration)'
//     });
//   } catch (error) {
//     console.error('Feedback processing failed:', error?.message || error);
//     return res.status(500).json({ error: 'Failed to process feedback' });
//   }
// });

// const AZURE_BACKUP_DIR = path.join(__dirname, 'azure-monitoring');
// const AZURE_BACKUP_SCRIPT = path.join(AZURE_BACKUP_DIR, 'backup advanced 24-04-2026.ps1');
// const AZURE_BACKUP_TIME_ZONE = process.env.AZURE_BACKUP_TIME_ZONE || 'Asia/Kolkata';
// let azureBackupJob = null;
// let azureBackupLastAttempt = null;
// let azureBackupLastSuccess = null;
// let azureBackupLastError = '';
// let azureBackupLastTrigger = '';
// let azureBackupLastScheduledSlot = '';

// function latestAzureBackupFile(prefix, extension) {
//   if (!fs.existsSync(AZURE_BACKUP_DIR)) return null;
//   return fs.readdirSync(AZURE_BACKUP_DIR)
//     .filter(name => name.startsWith(prefix) && name.toLowerCase().endsWith(extension))
//     .map(name => ({ name, path: path.join(AZURE_BACKUP_DIR, name), mtime: fs.statSync(path.join(AZURE_BACKUP_DIR, name)).mtime }))
//     .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0] || null;
// }

// function normalizeAzureBackupType(item) {
//   const backupType = String(item.BackupType || '').toLowerCase();
//   const recoveryType = String(item.RecoveryType || '').toLowerCase();
//   const resourceName = String(item.ResourceName || item.RawResourceName || '').toLowerCase();

//   if (recoveryType === 'azurestorage' || resourceName.startsWith('azurefileshare;') || backupType.includes('file share')) {
//     return 'File Share';
//   }
//   if (recoveryType === 'azureiaasvm' || resourceName.startsWith('vm;') || backupType.includes('vm')) {
//     return 'Azure VM';
//   }
//   return item.BackupType || 'N/A';
// }

// function normalizeAzureResourceName(item, type) {
//   const resourceName = String(item.ResourceName || 'N/A');
//   const rawResourceName = String(item.RawResourceName || resourceName);

//   if (type === 'Azure VM' && resourceName.toLowerCase().startsWith('vm;')) {
//     return resourceName.split(';').filter(Boolean).pop() || resourceName;
//   }
//   if (type === 'File Share' && resourceName.toLowerCase().startsWith('azurefileshare;')) {
//     return 'Azure File Share';
//   }
//   return resourceName || rawResourceName || 'N/A';
// }

// function normalizeAzureConsistency(item, type) {
//   const consistency = String(item.ConsistencyType || '').trim();
//   const lowered = consistency.toLowerCase();

//   if (lowered.includes('application') || lowered === 'appconsistent') return 'Application Consistent';
//   if (lowered.includes('crash') || lowered === 'crashconsistent') return 'Crash Consistent';
//   if (lowered.includes('file') || lowered === 'filesystemconsistent') return 'File-System Consistent';
//   if (type === 'File Share') return 'File-System Consistent';
//   if (['passed', 'success', 'succeeded', 'healthy'].includes(lowered)) return 'N/A';
//   return consistency || 'N/A';
// }

// function normalizeAzureRecoveryType(item, type) {
//   const recoveryType = String(item.RecoveryType || '').trim();
//   const lowered = recoveryType.toLowerCase();

//   if (!recoveryType || lowered === 'n/a') return 'N/A';
//   if (lowered.includes('snapshot') && lowered.includes('vault')) return 'Snapshot and Vault-Standard';
//   if (lowered.includes('snapshot')) return 'Snapshot';
//   if (lowered.includes('vault')) return 'Vault-Standard';
//   if (lowered === 'azurestorage' || type === 'File Share') return 'Snapshot';
//   if (lowered === 'azureiaasvm' || lowered === 'iaasvm') return 'Snapshot and Vault-Standard';
//   return recoveryType;
// }

// function buildAzureBackupReport(records, sourceFile, generatedAt) {
//   const source = Array.isArray(records) ? records : records ? [records] : [];
//   const items = source
//     .filter(item => item && !['N/A', ''].includes(String(item.BackupType || '')))
//     .map(item => {
//       const type = normalizeAzureBackupType(item);
//       return {
//         tenantId: item.TenantId || '',
//         tenantName: item.TenantName || '',
//         subscription: item.SubscriptionName || 'Unknown',
//         resourceGroup: item.ResourceGroup || 'N/A',
//         vault: item.VaultName || 'N/A',
//         type,
//         resource: normalizeAzureResourceName(item, type),
//         rawResource: item.RawResourceName || item.ResourceName || '',
//         status: item.BackupStatus || 'Warning',
//         lastBackupStatus: item.LastBackupStatus || 'N/A',
//         preBackupStatus: item.PreBackupStatus || 'N/A',
//         consistency: normalizeAzureConsistency(item, type),
//         recoveryType: normalizeAzureRecoveryType(item, type),
//         latestRecoveryPoint: item.LatestRPTime || 'N/A',
//         lastBackupTime: item.LastBackupTime || 'N/A',
//         backupAge: item.BackupAge || 'N/A',
//         backupAgeHours: Number(item.BackupAgeHours ?? -1),
//         policyName: item.PolicyName || 'N/A',
//         protectionState: item.ProtectionState || 'N/A',
//         storageAccount: item.StorageAccount || ''
//       };
//     });

//   const subscriptionsByName = new Map();
//   for (const item of items) {
//     if (!subscriptionsByName.has(item.subscription)) {
//       subscriptionsByName.set(item.subscription, {
//         name: item.subscription,
//         id: '',
//         totalItems: 0,
//         healthy: 0,
//         warning: 0,
//         failed: 0,
//         vaults: []
//       });
//     }
//     const subscription = subscriptionsByName.get(item.subscription);
//     subscription.totalItems++;
//     const statusKey = String(item.status).toLowerCase();
//     if (statusKey === 'healthy') subscription.healthy++;
//     else if (statusKey === 'failed') subscription.failed++;
//     else subscription.warning++;

//     let vault = subscription.vaults.find(entry => entry.name === item.vault && entry.resourceGroup === item.resourceGroup);
//     if (!vault) {
//       vault = { name: item.vault, resourceGroup: item.resourceGroup, items: [], vmBackupsProcessed: 0, fileShareBackupsProcessed: 0 };
//       subscription.vaults.push(vault);
//     }
//     vault.items.push(item);
//     if (item.type === 'Azure VM') vault.vmBackupsProcessed++;
//     if (item.type === 'File Share') vault.fileShareBackupsProcessed++;
//   }

// const countStatus = status => items.filter(item => item.status === status).length;
//   const appItems = items.filter(item => item.consistency === 'Application Consistent');
//   const crashItems = items.filter(item => item.consistency === 'Crash Consistent');
//   const fsItems = items.filter(item => item.consistency === 'File-System Consistent');
//   return {
//     file: sourceFile,
//     generatedAt: generatedAt instanceof Date ? generatedAt.toISOString() : generatedAt,
//     scheduleTimeZone: AZURE_BACKUP_TIME_ZONE,
//     refreshSchedule: 'Every 3 hours at 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00',
//     totalRecords: items.length,
//     healthy: countStatus('Healthy'),
//     warning: countStatus('Warning'),
//     failed: countStatus('Failed'),
//     totalVms: items.filter(item => item.type === 'Azure VM').length,
//     totalFileShares: items.filter(item => item.type === 'File Share').length,
//     consistencyCounts: {
//       application: appItems.length,
//       crash: crashItems.length,
//       filesystem: fsItems.length
//     },
//     consistencyDetails: {
//       application: { count: appItems.length, items: appItems },
//       crash: { count: crashItems.length, items: crashItems },
//       filesystem: { count: fsItems.length, items: fsItems }
//     },
//     alerts: items.filter(item => item.status !== 'Healthy'),
//     subscriptions: [...subscriptionsByName.values()],
//     items
//   };
// }

// function readLatestAzureBackupReport() {
//   const latest = latestAzureBackupFile('AzureBackupData_', '.json');
//   if (!latest) return null;
//   const raw = fs.readFileSync(latest.path, 'utf8').replace(/^\uFEFF/, '');
//   return buildAzureBackupReport(JSON.parse(raw), latest.name, latest.mtime);
// }

// function generateSeedBackupData() {
//   const now = new Date();
//   const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
//   const subscriptions = ['Conduent', 'FLSmidth', 'MuraaiInfra', 'Allegion', 'Stellantis'];
//   const vaults = [
//     { sub: 'Conduent', name: 'cndt-nonprod-vault', rg: 'cndt-nonprod' },
//     { sub: 'Conduent', name: 'cndt-prod-asr', rg: 'conduent-prod-rg' },
//     { sub: 'Conduent', name: 'cndt-dev-asr', rg: 'cndt-dev-rg' },
//     { sub: 'FLSmidth', name: 'fls-prod-asr', rg: 'flsmidth-prod-rg' },
//     { sub: 'FLSmidth', name: 'flsmidth-recovery-service-vault', rg: 'flsmidth-dr-rg' },
//     { sub: 'MuraaiInfra', name: 'muraai-backup-vault', rg: 'muraai-controller-rg' },
//     { sub: 'Allegion', name: 'allegion-prod-asr', rg: 'allegion-prod-rg' },
//     { sub: 'Allegion', name: 'allegion-prod-rsv', rg: 'allegion-rsv-rg' },
//     { sub: 'Stellantis', name: 'stellantis-prod-rsv', rg: 'stellantis-prod-rg' }
//   ];
//   const vms = [
//     // cndt-nonprod-vault (0)
//     { name: 'cndt-nonprod-ic-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-nonprod-mbir-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-nonprod-db-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-nonprod-web-vm', sub: 'Conduent', vault: 0, consistency: 'File-System Consistent', status: 'Healthy' },
//     { name: 'cndt-nonprod-app-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-nonprod-util-vm', sub: 'Conduent', vault: 0, consistency: 'Application Consistent', status: 'Healthy' },
//     // cndt-prod-asr (1)
//     { name: 'cndt-prod-awp-node1', sub: 'Conduent', vault: 1, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-prod-awp-node2', sub: 'Conduent', vault: 1, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-prod-ds-vm', sub: 'Conduent', vault: 1, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'conduent-prod-app-vmss-0', sub: 'Conduent', vault: 1, consistency: 'Crash Consistent', status: 'Warning' },
//     { name: 'conduent-prod-app-vmss-1', sub: 'Conduent', vault: 1, consistency: 'Crash Consistent', status: 'Warning' },
//     // cndt-dev-asr (2)
//     { name: 'cndt-dev-appworks-vm', sub: 'Conduent', vault: 2, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'cndt-dev-cs-vm', sub: 'Conduent', vault: 2, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'conduent-dev-db-vm', sub: 'Conduent', vault: 2, consistency: 'File-System Consistent', status: 'Healthy' },
//     // fls-prod-asr (3)
//     { name: 'fls-prod-ic-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'flsmidth-prod-mbir-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'flsmidth-prod-db-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'fls-prod-web-vm', sub: 'FLSmidth', vault: 3, consistency: 'Application Consistent', status: 'Healthy' },
//     // flsmidth-recovery-service-vault (4)
//     { name: 'fls-dev-ic-vm', sub: 'FLSmidth', vault: 4, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'fls-nonprod-mbir-vm', sub: 'FLSmidth', vault: 4, consistency: 'Crash Consistent', status: 'Warning' },
//     { name: 'fls-scs-vm', sub: 'FLSmidth', vault: 4, consistency: 'Crash Consistent', status: 'Warning' },
//     { name: 'fls-dr-util-vm', sub: 'FLSmidth', vault: 4, consistency: 'Application Consistent', status: 'Healthy' },
//     // muraai-backup-vault (5)
//     { name: 'muraaisims-demo-ic-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'muraaisims-demo-mbir-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'muraaisims-demo-occ-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'muraaisims-demo-db-vm', sub: 'MuraaiInfra', vault: 5, consistency: 'Application Consistent', status: 'Healthy' },
//     // allegion-prod-asr (6)
//     { name: 'allegion-prod-ic-vm', sub: 'Allegion', vault: 6, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'allegion-prod-mbir-vm', sub: 'Allegion', vault: 6, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'allegion-prod-db-vm', sub: 'Allegion', vault: 6, consistency: 'Application Consistent', status: 'Healthy' },
//     // allegion-prod-rsv (7)
//     { name: 'allegion-prod-web-vm', sub: 'Allegion', vault: 7, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'allegion-prod-app-vm', sub: 'Allegion', vault: 7, consistency: 'Crash Consistent', status: 'Warning' },
//     { name: 'allegion-prod-util-vm', sub: 'Allegion', vault: 7, consistency: 'File-System Consistent', status: 'Healthy' },
//     // stellantis-prod-rsv (8)
//     { name: 'stellantis-prod-mbir-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'stellantis-prod-ic-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'stellantis-prod-db-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'stellantis-prod-web-vm', sub: 'Stellantis', vault: 8, consistency: 'Application Consistent', status: 'Healthy' },
//     { name: 'stellantis-prod-app-vm', sub: 'Stellantis', vault: 8, consistency: 'Crash Consistent', status: 'Warning' }
//   ];

//   const records = vms.map((vm, i) => {
//     const v = vaults[vm.vault];
//     const backupDate = new Date(now.getTime() - (i * 3600000));
//     const ageHours = Math.round((now - backupDate) / 3600000);
//     return {
//       TenantId: '583bbc8b-b4b7-4e5f-900d-c0554b41e2eb',
//       TenantName: 'Muraai Information Technologies Pvt Ltd',
//       SubscriptionName: vm.sub,
//       ResourceGroup: v.rg,
//       VaultName: v.name,
//       BackupType: 'Azure VM',
//       ResourceName: vm.name,
//       BackupStatus: vm.status,
//       LastBackupStatus: vm.status === 'Healthy' ? 'Completed' : 'Warning',
//       PreBackupStatus: vm.status === 'Healthy' ? 'Succeeded' : 'Failed',
//       ConsistencyType: vm.consistency,
//       RecoveryType: vm.status === 'Healthy' ? 'Snapshot and Vault-Standard' : 'N/A',
//       LatestRPTime: backupDate.toISOString(),
//       LastBackupTime: backupDate.toISOString(),
//       BackupAge: `${ageHours}h ago`,
//       BackupAgeHours: ageHours,
//       PolicyName: 'DailyBackupPolicy',
//       ProtectionState: vm.status === 'Healthy' ? 'Protected' : 'Unprotected',
//       StorageAccount: `${vm.name.replace(/-/g, '')}sa`
//     };
//   });

//   const fileShares = [
//     { name: 'pvc-72bd4775-2a93-45c4-aa87-61b9b2060b85', sub: 'MuraaiInfra', vault: 5, status: 'Healthy' },
//     { name: 'pvc-a1f2e3d4-b5c6-7890-abcd-ef1234567890', sub: 'Conduent', vault: 0, status: 'Healthy' },
//     { name: 'pvc-f3e4d5c6-b7a8-9012-bcde-f13579111314', sub: 'FLSmidth', vault: 3, status: 'Warning' },
//     { name: 'pvc-9a8b7c6d-5e4f-3210-fedc-ba9876543210', sub: 'Allegion', vault: 6, status: 'Failed' },
//     { name: 'pvc-12345678-1234-1234-1234-123456789012', sub: 'Stellantis', vault: 8, status: 'Healthy' }
//   ];

//   const fsRecords = fileShares.map((fs, i) => {
//     const v = vaults[fs.vault];
//     const backupDate = new Date(now.getTime() - ((i + vms.length) * 3600000));
//     const ageHours = Math.round((now - backupDate) / 3600000);
//     return {
//       TenantId: '583bbc8b-b4b7-4e5f-900d-c0554b41e2eb',
//       TenantName: 'Muraai Information Technologies Pvt Ltd',
//       SubscriptionName: fs.sub,
//       ResourceGroup: v.rg,
//       VaultName: v.name,
//       BackupType: 'File Share',
//       ResourceName: fs.name,
//       BackupStatus: fs.status,
//       LastBackupStatus: fs.status === 'Healthy' ? 'Completed' : (fs.status === 'Warning' ? 'Warning' : 'Failed'),
//       PreBackupStatus: fs.status === 'Healthy' ? 'Succeeded' : 'Failed',
//       ConsistencyType: 'File-System Consistent',
//       RecoveryType: 'Snapshot',
//       LatestRPTime: backupDate.toISOString(),
//       LastBackupTime: backupDate.toISOString(),
//       BackupAge: `${ageHours}h ago`,
//       BackupAgeHours: ageHours,
//       PolicyName: 'AzureFileSharePolicy',
//       ProtectionState: fs.status === 'Healthy' ? 'Protected' : 'Unprotected',
//       StorageAccount: fs.name.replace(/-/g, '').toLowerCase() + 'sa'
//     };
//   });

//   const allRecords = [...records, ...fsRecords];

//   const filename = `AzureBackupData_${timestamp}.json`;
//   const filepath = path.join(AZURE_BACKUP_DIR, filename);
//   if (!fs.existsSync(AZURE_BACKUP_DIR)) {
//     fs.mkdirSync(AZURE_BACKUP_DIR, { recursive: true });
//   }
//   fs.writeFileSync(filepath, JSON.stringify(allRecords, null, 2), 'utf8');

//   const nowStr = now.toISOString();
//   console.log(`[AZ-SEED] Generated sample backup data: ${filename} (${allRecords.length} items: ${records.length} VMs, ${fsRecords.length} File Shares)`);
//   return { file: filename, generatedAt: nowStr, records: allRecords };
// }

// function runAzureBackupCollection(trigger = 'manual') {
//   if (azureBackupJob) return azureBackupJob;
//   azureBackupLastAttempt = new Date().toISOString();
//   azureBackupLastTrigger = trigger;
//   azureBackupLastError = '';

//   azureBackupJob = new Promise(async (resolve, reject) => {
//     const userToken = typeof trigger === 'object' && trigger.userToken ? trigger.userToken : null;
//     const triggerName = typeof trigger === 'string' ? trigger : 'manual';
//     const collectionErrors = [];

//     // Priority 1: Try with user-delegated Azure token (from MSAL frontend)
//     if (userToken) {
//       try {
//         const collector = require('./azure-backup-collector');
//         let records = await collector.collectAzureBackupData(userToken);
//         records = collector.deduplicateFileShares(records);
//         if (records && records.length > 0) {
//           const nowStr = new Date().toISOString();
//           const filename = `AzureBackupData_${nowStr.replace(/[:.]/g, '-').slice(0, 19)}.json`;
//           const filepath = path.join(AZURE_BACKUP_DIR, filename);
//           if (!fs.existsSync(AZURE_BACKUP_DIR)) {
//             fs.mkdirSync(AZURE_BACKUP_DIR, { recursive: true });
//           }
//           fs.writeFileSync(filepath, JSON.stringify(records, null, 2), 'utf8');
//           console.log(`[AZ-SDK] Written ${records.length} records to ${filename} (user token)`);
//           const report = buildAzureBackupReport(records, filename, nowStr);
//           resolve({ report, stdout: '', stderr: '' });
//           return;
//         }
//         console.warn('[AZ-SDK] User token collector returned no records, falling back...');
//         collectionErrors.push('User Azure token collector returned 0 records.');
//       } catch (sdkErr) {
//         console.warn('[AZ-SDK] User token collector failed:', sdkErr.message);
//         collectionErrors.push(`User Azure token collector failed: ${sdkErr.message}`);
//       }
//     }

//     // Priority 2: Try Azure SDK collector with service principal (manual refresh only)
//     if (triggerName !== 'scheduled' && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID) {
//       try {
//         const collector = require('./azure-backup-collector');
//         let records = await collector.collectAzureBackupData();
//         records = collector.deduplicateFileShares(records);
//         if (records && records.length > 0) {
//           const nowStr = new Date().toISOString();
//           const filename = `AzureBackupData_${nowStr.replace(/[:.]/g, '-').slice(0, 19)}.json`;
//           const filepath = path.join(AZURE_BACKUP_DIR, filename);
//           if (!fs.existsSync(AZURE_BACKUP_DIR)) {
//             fs.mkdirSync(AZURE_BACKUP_DIR, { recursive: true });
//           }
//           fs.writeFileSync(filepath, JSON.stringify(records, null, 2), 'utf8');
//           console.log(`[AZ-SDK] Written ${records.length} records to ${filename}`);
//           const report = buildAzureBackupReport(records, filename, nowStr);
//           resolve({ report, stdout: '', stderr: '' });
//           return;
//         }
//         console.warn('[AZ-SDK] Collector returned no records, falling back...');
//         collectionErrors.push('Service principal Azure collector returned 0 records.');
//       } catch (sdkErr) {
//         console.warn('[AZ-SDK] SDK collector failed:', sdkErr.message);
//         collectionErrors.push(`Service principal Azure collector failed: ${sdkErr.message}`);
//       }
//     }

//     // Priority 2: Try PowerShell script (for host-side execution)
//     const canRunScript = fs.existsSync(AZURE_BACKUP_SCRIPT);
//     const executable = process.env.AZURE_BACKUP_POWERSHELL || (process.platform === 'win32' ? 'powershell.exe' : 'pwsh');
//     let pwshAvailable = false;
//     if (canRunScript) {
//       try {
//         require('child_process').execFileSync(process.platform === 'win32' ? 'where' : 'which', [executable], { stdio: 'ignore' });
//         pwshAvailable = true;
//       } catch (e) { /* pwsh not available */ }
//     }

//     if (canRunScript && pwshAvailable) {
//       const args = process.platform === 'win32'
//         ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', AZURE_BACKUP_SCRIPT]
//         : ['-NoProfile', '-File', AZURE_BACKUP_SCRIPT];

//       console.log(`[AZ-RUN] Starting ${triggerName} Azure backup collection with ${executable}`);
//       execFile(executable, args, {
//         cwd: AZURE_BACKUP_DIR,
//         env: { ...process.env, AZURE_BACKUP_REPORT_DIR: AZURE_BACKUP_DIR },
//         maxBuffer: 20 * 1024 * 1024,
//         timeout: 30 * 60 * 1000,
//         windowsHide: true
//       }, (error, stdout, stderr) => {
//         if (error) {
//           const report = readLatestAzureBackupReport();
//           if (report) resolve({ report, stdout, stderr });
//           else reject(error);
//           return;
//         }
//         const report = readLatestAzureBackupReport();
//         if (!report) {
//           reject(new Error('Azure collection finished but no structured JSON report was generated.'));
//           return;
//         }
//         resolve({ report, stdout, stderr });
//       });
//       return;
//     }

//     // Priority 3: No data source — return empty report in memory only
//     reject(new Error(collectionErrors.length
//       ? collectionErrors.join(' ')
//       : 'No Azure backup data source is available. Live refresh did not collect records.'));
//   })
//     .then(result => {
//       azureBackupLastSuccess = new Date().toISOString();
//       return result;
//     })
//     .catch(error => {
//       azureBackupLastError = error?.message || String(error);
//       console.error('[AZ-RUN] Collection failed:', azureBackupLastError);
//       throw error;
//     })
//     .finally(() => {
//       azureBackupJob = null;
//     });

//   return azureBackupJob;
// }

// function getZonedDateParts(date = new Date()) {
//   return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
//     timeZone: AZURE_BACKUP_TIME_ZONE,
//     year: 'numeric',
//     month: '2-digit',
//     day: '2-digit',
//     hour: '2-digit',
//     minute: '2-digit',
//     hourCycle: 'h23'
//   }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
// }

// function checkAzureBackupSchedule() {
//   if (String(process.env.ENABLE_AZURE_BACKUP_SCHEDULE || 'true').toLowerCase() === 'false') return;
//   // Only run scheduled refresh if a previous report file exists (don't create empty reports)
//   const latest = readLatestAzureBackupReport();
//   if (!latest) return;
//   const parts = getZonedDateParts();
//   const hour = Number(parts.hour);
//   const minute = Number(parts.minute);
//   const slot = `${parts.year}-${parts.month}-${parts.day}-${String(Math.floor(hour / 3)).padStart(2, '0')}`;
//   if (hour % 3 === 0 && minute < 5 && slot !== azureBackupLastScheduledSlot) {
//     azureBackupLastScheduledSlot = slot;
//     runAzureBackupCollection('scheduled').catch(() => {});
//   }
// }

// // Periodic presence sync
// let presenceSyncTimer = null;
// async function runPresenceSync() {
//   try {
//     const token = await getGraphToken();
//     const usersResult = await pool.query(`
//       SELECT DISTINCT LOWER(TRIM(user_email)) as email FROM monitoring_devices
//       WHERE user_email IS NOT NULL AND TRIM(user_email) != ''
//     `);
//     const emails = usersResult.rows.map(r => r.email).filter(Boolean);
//     for (const email of emails) {
//       try {
//         const userResp = await fetch(
//           `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}?$select=id`,
//           { headers: { Authorization: `Bearer ${token}` } }
//         );
//         if (!userResp.ok) continue;
//         const userData = await userResp.json();
//         if (!userData.id) continue;
//         const presenceResp = await fetch(
//           `https://graph.microsoft.com/v1.0/users/${userData.id}/presence`,
//           { headers: { Authorization: `Bearer ${token}` } }
//         );
//         if (!presenceResp.ok) continue;
//         const presence = await presenceResp.json();
//         await pool.query(
//           `INSERT INTO monitoring_presence_log (user_email, user_id, activity, timestamp) VALUES ($1,$2,$3,NOW())`,
//           [email, userData.id, presence.activity || 'PresenceUnknown']
//         );
//       } catch (e) { /* skip user */ }
//     }
//   } catch (e) { /* skip cycle */ }
// }

// // ------------------------
// // Start server
// // ------------------------
// app.listen(PORT, () => {
//   console.log(`Server running on port ${PORT}`);
//   checkAzureBackupSchedule();
//   setInterval(checkAzureBackupSchedule, 30 * 1000).unref();

//   // Schedule automatic presence sync every 15 minutes
//   runPresenceSync().catch(() => {});
//   presenceSyncTimer = setInterval(() => runPresenceSync().catch(() => {}), 15 * 60 * 1000).unref();

//   // Per-user counts caches are warmed on each user's first dashboard request
//   // via the SWR pattern. No shared pre-warm needed (it caused wrong 0-counts
//   // for assigned/SLA metrics because no real userEmail was available at boot).
// });

// // Run a fresh live Azure Backup collection. Concurrent clicks share one job.
// app.post('/api/monitoring/azure/run-report', authenticateToken, authorizeElevated, async (req, res) => {
//   try {
//     const userToken = req.headers['x-azure-token'] || null;
//     const result = await runAzureBackupCollection({ trigger: 'manual', userToken });
//     res.json({ status: 'ok', report: result.report });
//   } catch (err) {
//     res.status(500).json({
//       message: 'Live Azure backup collection failed',
//       error: err?.message || String(err),
//       stderr: err?.stderr || ''
//     });
//   }
// });

// app.get('/api/monitoring/azure/report-status', authenticateToken, authorizeElevated, (req, res) => {
//   const latest = readLatestAzureBackupReport();
//   res.json({
//     running: Boolean(azureBackupJob),
//     lastAttempt: azureBackupLastAttempt,
//     lastSuccess: azureBackupLastSuccess || latest?.generatedAt || null,
//     lastError: azureBackupLastError,
//     lastTrigger: azureBackupLastTrigger,
//     scheduleTimeZone: AZURE_BACKUP_TIME_ZONE,
//     refreshSchedule: '00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00'
//   });
// });

// // Parse the latest AzureBackupMonitor_*.log into structured JSON
// app.get('/api/monitoring/azure/report-log', authenticateToken, authorizeElevated, async (req, res) => {
//   try {
//     const structuredReport = readLatestAzureBackupReport();
//     if (structuredReport) {
//       res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
//       return res.json(structuredReport);
//     }

//     const AZ_DIR = path.join(__dirname, 'azure-monitoring');
//     if (!fs.existsSync(AZ_DIR)) return res.status(404).json({ message: 'azure-monitoring directory not found' });

//     const files = fs.readdirSync(AZ_DIR)
//       .filter(f => f.toLowerCase().endsWith('.log'))
//       .map(f => ({ name: f, mtime: fs.statSync(path.join(AZ_DIR, f)).mtimeMs }))
//       .sort((a,b) => b.mtime - a.mtime);

//     if (!files.length) return res.status(404).json({ message: 'No log files found' });

//     const latest = path.join(AZ_DIR, files[0].name);
//     const raw = fs.readFileSync(latest, 'utf8');

//     const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
//     const parsed = {
//       file: files[0].name,
//       subscriptions: [],
//       summary: [],
//       raw,
//       reportPath: '',
//       totalRecords: 0,
//       healthy: 0,
//       warning: 0,
//       failed: 0,
//       totalVms: 0,
//       totalFileShares: 0,
//       consistencyCounts: {
//         application: 0,
//         crash: 0,
//         filesystem: 0
//       },
//       alerts: [],
//       items: []
//     };

//     let currentSub = null;
//     let currentVault = null;

//     for (const line of lines) {
//       const reportPathMatch = /\[INFO\]\s*Report\s*:\s*(.*)/i.exec(line);
//       if (reportPathMatch) {
//         parsed.reportPath = reportPathMatch[1].trim();
//         continue;
//       }

//       const totalMatch = /\[SUCCESS\]\s*Data collection complete\. Total records:\s*(\d+)/i.exec(line);
//       if (totalMatch) {
//         parsed.totalRecords = Number(totalMatch[1]);
//         continue;
//       }

//       const subMatch = /Subscription:\s*\[(.*?)\]\s*\((.*?)\)/i.exec(line);
//       if (subMatch) {
//         currentSub = { name: subMatch[1], id: subMatch[2], vaults: [], totalItems: 0, healthy: 0, warning: 0, failed: 0 };
//         parsed.subscriptions.push(currentSub);
//         currentVault = null;
//         continue;
//       }

//       const vaultMatch = /Vault:\s*\[(.*?)\]\s*RG:\s*\[(.*?)\]/i.exec(line);
//       if (vaultMatch) {
//         currentVault = { name: vaultMatch[1], resourceGroup: vaultMatch[2], items: [], vmBackupsProcessed: 0, fileShareBackupsProcessed: 0 };
//         if (currentSub) currentSub.vaults.push(currentVault);
//         continue;
//       }

//       const rpMatch = /\[RP-([A-Z0-9_-]+)\]\s+([^:]+)\s*:\s*(.*?)\s*\((\d+)\s+RPs\)/i.exec(line);
//       if (rpMatch && currentVault && currentSub) {
//         const consistencyMatch = /(Application Consistent|Crash Consistent|File-System Consistent)/i.exec(rpMatch[3]);
//         const consistency = consistencyMatch ? consistencyMatch[1] : 'Unknown';
//         const status = line.includes('[RP-OK]') ? 'Healthy' : 'Failed';
//         const detailsStr = rpMatch[3].trim();
//         const recoveryType = detailsStr.includes('|') ? detailsStr.split('|')[1].trim() : detailsStr;
//         const resourceName = rpMatch[2].trim();
//         const alert = {
//           type: 'VM Backup',
//           resource: resourceName,
//           status,
//           subscription: currentSub.name,
//           resourceGroup: currentVault.resourceGroup,
//           vault: currentVault.name,
//           consistency
//         };

//         currentVault.items.push({
//           tag: rpMatch[1],
//           item: resourceName,
//           details: detailsStr,
//           recoveryPoints: Number(rpMatch[4]),
//           status,
//           consistency
//         });

//         currentSub.totalItems = (currentSub.totalItems || 0) + 1;
//         if (status === 'Healthy') {
//           currentSub.healthy = (currentSub.healthy || 0) + 1;
//           parsed.healthy++;
//         } else {
//           parsed.failed++;
//           currentSub.failed = (currentSub.failed || 0) + 1;
//           parsed.alerts.push(alert);
//         }

//         if (/Application Consistent/i.test(consistency)) parsed.consistencyCounts.application++;
//         else if (/Crash Consistent/i.test(consistency)) parsed.consistencyCounts.crash++;
//         else if (/File-System Consistent/i.test(consistency)) parsed.consistencyCounts.filesystem++;

//         parsed.items.push({
//           subscription: currentSub.name,
//           resourceGroup: currentVault.resourceGroup,
//           vault: currentVault.name,
//           type: 'VM Backup',
//           resource: resourceName,
//           status,
//           lastBackupStatus: status,
//           preBackupStatus: '',
//           consistency,
//           recoveryType,
//           latestRecoveryPoint: '',
//           lastBackupTime: '',
//           backupAge: '',
//           backupAgeHours: 0,
//           policyName: '',
//           protectionState: status,
//           storageAccount: ''
//         });

//         continue;
//       }

//       // Handle RP-MISS lines (missing recovery points, no details)
//       const missMatch = /\[RP-MISS\]\s+(.+)/i.exec(line);
//       if (missMatch && currentVault && currentSub) {
//         const resourceName = missMatch[1].trim();
//         const status = 'Warning';

//         currentVault.items.push({
//           tag: 'MISS',
//           item: resourceName,
//           details: '',
//           recoveryPoints: 0,
//           status,
//           consistency: 'N/A'
//         });

//         currentSub.totalItems = (currentSub.totalItems || 0) + 1;
//         currentSub.warning = (currentSub.warning || 0) + 1;
//         currentSub.failed = (currentSub.failed || 0) + 1;
//         parsed.warning++;

//         parsed.alerts.push({
//           type: 'VM Backup',
//           resource: resourceName,
//           status,
//           subscription: currentSub.name,
//           resourceGroup: currentVault.resourceGroup,
//           vault: currentVault.name,
//           consistency: 'N/A'
//         });

//         parsed.items.push({
//           subscription: currentSub.name,
//           resourceGroup: currentVault.resourceGroup,
//           vault: currentVault.name,
//           type: 'VM Backup',
//           resource: resourceName,
//           status,
//           lastBackupStatus: status,
//           preBackupStatus: '',
//           consistency: 'N/A',
//           recoveryType: 'N/A',
//           latestRecoveryPoint: '',
//           lastBackupTime: '',
//           backupAge: '',
//           backupAgeHours: 0,
//           policyName: '',
//           protectionState: status,
//           storageAccount: ''
//         });

//         continue;
//       }

//       const vmMatch = /VM backups processed:\s*(\d+)/i.exec(line);
//       if (vmMatch && currentVault) { currentVault.vmBackupsProcessed = Number(vmMatch[1]); continue; }
//       const fsMatch = /File Share backups processed:\s*(\d+)/i.exec(line);
//       if (fsMatch && currentVault) { currentVault.fileShareBackupsProcessed = Number(fsMatch[1]); continue; }

//       const foundSub = /\[SUCCESS\]\s*Found\s*(\d+)\s*subscription\(s\)\s*in\s*\[(.*?)\s*\((.*?)\)\]/i.exec(line);
//       if (foundSub) {
//         parsed.summary.push({ subscriptionsFound: Number(foundSub[1]), tenantDisplay: foundSub[2], tenantId: foundSub[3] });
//         continue;
//       }

//       const gen = /\[(INFO|SUCCESS|WARN|ERROR|SECTION)\]\s*(.*)/i.exec(line);
//       if (gen) {
//         parsed.summary.push({ level: gen[1], message: gen[2] });
//       }
//     }

//     parsed.totalVms = parsed.subscriptions.reduce((sum, sub) => sum + sub.vaults.reduce((vaultSum, vault) => vaultSum + (vault.vmBackupsProcessed || 0), 0), 0);
//     parsed.totalFileShares = parsed.subscriptions.reduce((sum, sub) => sum + sub.vaults.reduce((vaultSum, vault) => vaultSum + (vault.fileShareBackupsProcessed || 0), 0), 0);

//     res.json(parsed);
//   } catch (err) {
//     console.error('Report-log parse error:', err);
//     res.status(500).json({ message: 'Failed to parse report log', error: err?.message || err });
//   }
// });

// app.get('/api/monitoring/azure/report-html', authenticateToken, authorizeElevated, async (req, res) => {
//   try {
//     const AZ_DIR = path.join(__dirname, 'azure-monitoring');
//     if (!fs.existsSync(AZ_DIR)) return res.status(404).json({ message: 'azure-monitoring directory not found' });

//     const files = fs.readdirSync(AZ_DIR)
//       .filter(f => f.toLowerCase().endsWith('.html'))
//       .map(f => ({ name: f, mtime: fs.statSync(path.join(AZ_DIR, f)).mtimeMs }))
//       .sort((a,b) => b.mtime - a.mtime);

//     if (!files.length) return res.status(404).json({ message: 'No HTML report files found' });

//     const latestHtml = path.join(AZ_DIR, files[0].name);
//     res.set('Cache-Control', 'no-store, max-age=0, must-revalidate');
//     res.sendFile(latestHtml);
//   } catch (err) {
//     console.error('Report-html error:', err);
//     res.status(500).json({ message: 'Failed to serve report HTML', error: err?.message || err });
//   }
// });

// // -------------------------------------------------------
// // SPA fallback (Angular routing) - MUST BE LAST
// // -------------------------------------------------------
// app.get("*", (req, res) => {
//   const indexPath =
//     fs.existsSync(path.join(angularBrowserPath, "index.html"))
//       ? path.join(angularBrowserPath, "index.html")
//       : path.join(angularPath, "index.html");

//   res.sendFile(indexPath);
// });
