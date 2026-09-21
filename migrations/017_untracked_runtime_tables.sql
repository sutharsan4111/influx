-- Baselines the remaining tables that only ever existed inside server.js's
-- inline runMigrations() (removed — schema no longer applies at server boot,
-- see runMigration.js). Definitions copied verbatim from that function so
-- behavior doesn't change for the live database, where these already exist.

CREATE TABLE IF NOT EXISTS ticket_arrival_notifications (
  zoho_ticket_id VARCHAR(50) PRIMARY KEY,
  zoho_department_id VARCHAR(50),
  notified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

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
);

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
);

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
);
CREATE INDEX IF NOT EXISTS idx_recycled_tickets_active ON recycled_tickets (zoho_ticket_id) WHERE restored_at IS NULL;

-- Optional SSL fields are optional in API usage.
ALTER TABLE IF EXISTS ssl_assets ALTER COLUMN hostname DROP NOT NULL;
ALTER TABLE IF EXISTS ssl_assets ALTER COLUMN ip_address DROP NOT NULL;
ALTER TABLE IF EXISTS ssl_assets ALTER COLUMN application DROP NOT NULL;

CREATE TABLE IF NOT EXISTS user_role_bindings (
  id SERIAL PRIMARY KEY,
  microsoft_email VARCHAR(255) NOT NULL UNIQUE,
  roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
  assigned_by VARCHAR(255),
  notes TEXT,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_role_bindings_email ON user_role_bindings(microsoft_email);

CREATE TABLE IF NOT EXISTS group_role_bindings (
  id SERIAL PRIMARY KEY,
  group_identifier VARCHAR(255) NOT NULL UNIQUE,
  roles TEXT[] NOT NULL DEFAULT ARRAY['user']::TEXT[],
  assigned_by VARCHAR(255),
  notes TEXT,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_group_role_bindings_identifier ON group_role_bindings(group_identifier);

-- Seed test account with all roles for profile role-switch validation.
INSERT INTO user_role_bindings (microsoft_email, roles, assigned_by, notes, assigned_at, updated_at)
VALUES (
  'automation.cloudops@muraai.com',
  ARRAY['admin', 'cloudops', 'itsm', 'product', 'hr', 'support', 'muraai'],
  'system-seed',
  'Seeded all roles for testing role switching',
  NOW(), NOW()
)
ON CONFLICT (microsoft_email) DO UPDATE SET
  roles = EXCLUDED.roles,
  assigned_by = EXCLUDED.assigned_by,
  notes = EXCLUDED.notes,
  updated_at = NOW();

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
);

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
);
CREATE INDEX IF NOT EXISTS idx_monitoring_telemetry_device_time ON monitoring_telemetry (device_id, reported_at DESC);

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
);
CREATE INDEX IF NOT EXISTS idx_monitoring_azure_resources_owner_email ON monitoring_azure_resources (owner_email);

CREATE TABLE IF NOT EXISTS monitoring_presence_log (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  user_id VARCHAR(255),
  activity VARCHAR(50) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_presence_log_user_date ON monitoring_presence_log (user_email, timestamp DESC);

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
);
CREATE INDEX IF NOT EXISTS idx_intune_devices_hostname ON monitoring_intune_devices (hostname);

CREATE TABLE IF NOT EXISTS project_workspace_projects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  owner VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'Planning',
  progress INTEGER NOT NULL DEFAULT 0,
  due_date DATE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

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
);

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
);

-- Demo seed rows (fresh environments only — WHERE NOT EXISTS guards re-runs).
INSERT INTO project_workspace_projects (id, name, owner, status, progress, due_date)
SELECT 1, 'ITSM Upgrade', 'Alicia', 'Active', 72, '2026-08-20'
WHERE NOT EXISTS (SELECT 1 FROM project_workspace_projects WHERE id = 1);

INSERT INTO project_workspace_projects (id, name, owner, status, progress, due_date)
SELECT 2, 'Mobile App Rollout', 'Daniel', 'Planning', 24, '2026-09-10'
WHERE NOT EXISTS (SELECT 1 FROM project_workspace_projects WHERE id = 2);

INSERT INTO project_workspace_tasks (id, project_id, title, assignee, status, priority, due_date)
SELECT 101, 1, 'Configure workflow approvals', 'Nadia', 'In Progress', 'High', '2026-08-05'
WHERE NOT EXISTS (SELECT 1 FROM project_workspace_tasks WHERE id = 101);

INSERT INTO project_workspace_tasks (id, project_id, title, assignee, status, priority, due_date)
SELECT 102, 2, 'Prepare deployment checklist', 'Omar', 'To Do', 'Medium', '2026-08-15'
WHERE NOT EXISTS (SELECT 1 FROM project_workspace_tasks WHERE id = 102);

INSERT INTO project_workspace_time_logs (id, task_id, project_id, "user", hours, date, note)
SELECT 1001, 101, 1, 'Nadia', 4.5, '2026-08-02', 'Approval design and testing'
WHERE NOT EXISTS (SELECT 1 FROM project_workspace_time_logs WHERE id = 1001);

-- Legacy CHECK constraints that restrict role values to an old, smaller set.
ALTER TABLE IF EXISTS user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE IF EXISTS users DROP CONSTRAINT IF EXISTS users_role_check;
