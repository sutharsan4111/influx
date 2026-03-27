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
);

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
);