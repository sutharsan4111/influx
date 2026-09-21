-- Baselines 7 tables that were created by hand directly against the live
-- database and, until now, existed in no migration file — including `users`,
-- which holds login credentials. Schema captured by introspecting the live
-- database (information_schema + pg_constraint + pg_indexes) on 2026-09-21.
-- Needed before 011_rls_backend_only_policies.sql, which adds CREATE POLICY
-- statements against these tables (CREATE POLICY requires the table to exist).

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_closure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  closed_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recycle_bin (
  id SERIAL PRIMARY KEY,
  zoho_ticket_id VARCHAR(50) NOT NULL,
  ticket_number VARCHAR(50),
  subject VARCHAR(500),
  email VARCHAR(255),
  priority VARCHAR(50),
  status VARCHAR(50),
  category VARCHAR(255),
  assigned_to VARCHAR(255),
  ticket_data JSONB,
  deleted_by VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recycle_bin_expires_at ON recycle_bin(expires_at);

CREATE TABLE IF NOT EXISTS email_tickets (
  id SERIAL PRIMARY KEY,
  ticket_number VARCHAR(50) NOT NULL UNIQUE,
  subject VARCHAR(500) NOT NULL,
  description TEXT,
  application VARCHAR(255),
  environment VARCHAR(100),
  url VARCHAR(500),
  hostname VARCHAR(255),
  responsible_person VARCHAR(255),
  assigned_to VARCHAR(255),
  from_email VARCHAR(255),
  to_email VARCHAR(255),
  original_email_date TIMESTAMPTZ,
  is_high_importance BOOLEAN DEFAULT FALSE,
  category VARCHAR(100) DEFAULT 'Other',
  priority VARCHAR(50) DEFAULT 'High',
  status VARCHAR(50) NOT NULL DEFAULT 'Open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS user_name_mapping (
  id SERIAL PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (display_name, email)
);

CREATE TABLE IF NOT EXISTS cloudops_members (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ssl_alert_tickets (
  id SERIAL PRIMARY KEY,
  ticket_number VARCHAR(50) NOT NULL UNIQUE,
  subject VARCHAR(500) NOT NULL,
  description TEXT,
  alert_name VARCHAR(100),
  client VARCHAR(100),
  environment VARCHAR(100),
  application VARCHAR(100),
  instance_url VARCHAR(500),
  hostname VARCHAR(255),
  ip_address VARCHAR(50),
  responsible VARCHAR(255),
  assigned_to VARCHAR(255),
  severity VARCHAR(50),
  priority VARCHAR(50) DEFAULT 'Medium',
  status VARCHAR(50) DEFAULT 'Open',
  category VARCHAR(100) DEFAULT 'SSL Certificate',
  alert_data JSONB,
  created_by VARCHAR(255) DEFAULT 'alertmanager',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_ssl_tickets_status ON ssl_alert_tickets(status);
CREATE INDEX IF NOT EXISTS idx_ssl_tickets_assigned_to ON ssl_alert_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ssl_tickets_client ON ssl_alert_tickets(client);
CREATE INDEX IF NOT EXISTS idx_ssl_tickets_created_at ON ssl_alert_tickets(created_at DESC);
