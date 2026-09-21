-- Enable RLS on public tables flagged (again) by the Supabase Security Advisor
-- (rls_disabled_in_public). These tables were added after the 009/011 baseline
-- and, in the case of the ihub_certificate_* tables, the RLS statements that
-- already existed in 013 were apparently never actually applied to this DB.
--
-- Same rationale as 009/011: these tables are accessed exclusively via the
-- Node.js backend's direct Postgres connection (which bypasses RLS).
-- PostgREST (anon/authenticated) must never access them directly.
--
-- NOTE: Schema no longer runs at server boot (see runMigration.js) — apply
-- this, and every other file here, via `npm run migrate` so it can't
-- silently regress again the way 013's policies did.

ALTER TABLE IF EXISTS public.cloudops_tasks                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.monitoring_azure_resources        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_task_assignees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.monitoring_devices                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.monitoring_telemetry                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.monitoring_presence_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.monitoring_intune_devices           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_role_bindings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_role_bindings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_project_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_projects                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.project_workspace_projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.project_workspace_tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.project_workspace_time_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_arrival_notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ihub_certificate_assets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ihub_certificate_alert_tickets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_asset_pages                ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_asset_page_columns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_asset_page_rows            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backend_only" ON public.cloudops_tasks;
DROP POLICY IF EXISTS "backend_only" ON public.monitoring_azure_resources;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_task_assignees;
DROP POLICY IF EXISTS "backend_only" ON public.monitoring_devices;
DROP POLICY IF EXISTS "backend_only" ON public.monitoring_telemetry;
DROP POLICY IF EXISTS "backend_only" ON public.monitoring_presence_log;
DROP POLICY IF EXISTS "backend_only" ON public.monitoring_intune_devices;
DROP POLICY IF EXISTS "backend_only" ON public.user_role_bindings;
DROP POLICY IF EXISTS "backend_only" ON public.group_role_bindings;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_project_members;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_projects;
DROP POLICY IF EXISTS "backend_only" ON public.project_workspace_projects;
DROP POLICY IF EXISTS "backend_only" ON public.project_workspace_tasks;
DROP POLICY IF EXISTS "backend_only" ON public.project_workspace_time_logs;
DROP POLICY IF EXISTS "backend_only" ON public.ticket_arrival_notifications;
DROP POLICY IF EXISTS "backend_only" ON public.ihub_certificate_assets;
DROP POLICY IF EXISTS "backend_only" ON public.ihub_certificate_alert_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_asset_pages;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_asset_page_columns;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_asset_page_rows;

CREATE POLICY "backend_only" ON public.cloudops_tasks               AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.monitoring_azure_resources   AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_task_assignees      AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.monitoring_devices           AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.monitoring_telemetry         AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.monitoring_presence_log      AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.monitoring_intune_devices    AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.user_role_bindings           AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.group_role_bindings          AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_project_members     AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_projects            AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.project_workspace_projects   AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.project_workspace_tasks      AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.project_workspace_time_logs  AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ticket_arrival_notifications AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ihub_certificate_assets      AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ihub_certificate_alert_tickets AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_asset_pages         AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_asset_page_columns  AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_asset_page_rows     AS RESTRICTIVE FOR ALL TO public USING (false);
