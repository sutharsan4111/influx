-- Create user_roles table to store Microsoft email → role mapping
-- This is the source of truth for role assignments
CREATE TABLE IF NOT EXISTS user_roles (
  id SERIAL PRIMARY KEY,
  microsoft_email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'support', 'user')),
  assigned_by VARCHAR(255),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_roles_email ON user_roles(microsoft_email);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
