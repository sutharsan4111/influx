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
);

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
);

-- Same security baseline as ihub_assets/ihub_alert_tickets (see 009/011):
-- backend-only tables, accessed exclusively via the Node.js service-role connection.
ALTER TABLE IF EXISTS public.ihub_certificate_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ihub_certificate_alert_tickets ENABLE ROW LEVEL SECURITY;

-- Postgres has no `CREATE POLICY IF NOT EXISTS` — DROP IF EXISTS first so this
-- migration can be re-run.
DROP POLICY IF EXISTS "backend_only" ON public.ihub_certificate_assets;
DROP POLICY IF EXISTS "backend_only" ON public.ihub_certificate_alert_tickets;

CREATE POLICY "backend_only" ON public.ihub_certificate_assets        AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ihub_certificate_alert_tickets AS RESTRICTIVE FOR ALL TO public USING (false);
