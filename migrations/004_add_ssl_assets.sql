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
);

CREATE INDEX IF NOT EXISTS idx_ssl_assets_expiry
  ON ssl_assets(ssl_expiry);
