-- Azure Backup monitoring reports were written to /app/azure-monitoring on the
-- container filesystem, which has no volume — every restart/rollout wiped it and
-- both live pods held zero report files. Persist to Postgres instead.

CREATE TABLE IF NOT EXISTS azure_backup_reports (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  records JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_azure_backup_reports_generated_at ON azure_backup_reports(generated_at DESC);

ALTER TABLE IF EXISTS public.azure_backup_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backend_only" ON public.azure_backup_reports;
CREATE POLICY "backend_only" ON public.azure_backup_reports AS RESTRICTIVE FOR ALL TO public USING (false);
