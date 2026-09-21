-- Comprehensive backend-only RLS baseline across every table this app owns.
-- Supabase auto-exposes all public-schema tables via PostgREST to the anon/
-- authenticated roles unless RLS is enabled; this app never uses PostgREST
-- (it only talks to Postgres via the pool in db.js), so PostgREST access to
-- these tables must always be denied.
--
-- Previously this list was re-applied on every server boot (runMigrations() in
-- server.js) specifically so a newly added table, or one whose policy was
-- manually dropped, could never silently regress to world-readable. Schema no
-- longer runs at boot (see runMigration.js) — re-apply this file (via
-- `npm run migrate`) whenever a new table is added instead.
--
-- Every statement is idempotent: ENABLE ROW LEVEL SECURITY is a no-op if
-- already enabled, and DROP POLICY IF EXISTS guards the CREATE POLICY that
-- Postgres has no IF NOT EXISTS form for.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
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
    'cloudops_asset_page_rows', 'azure_backup_reports'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "backend_only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "backend_only" ON public.%I AS RESTRICTIVE FOR ALL TO public USING (false)', t);
  END LOOP;
END $$;
