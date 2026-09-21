-- Add explicit deny-all RLS policies for all backend-only tables.
-- These tables are accessed exclusively via the Node.js service-role connection
-- which bypasses RLS. PostgREST (anon/authenticated) must never access them directly.
--
-- Postgres has no `CREATE POLICY IF NOT EXISTS` — DROP IF EXISTS first so this
-- migration can be re-run (e.g. against an environment where it partially applied).

DROP POLICY IF EXISTS "backend_only" ON public.users;
DROP POLICY IF EXISTS "backend_only" ON public.ticket_closure;
DROP POLICY IF EXISTS "backend_only" ON public.ssl_alert_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.cloudops_members;
DROP POLICY IF EXISTS "backend_only" ON public.recycled_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.ihub_assets;
DROP POLICY IF EXISTS "backend_only" ON public.ihub_alert_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.ssl_assets;
DROP POLICY IF EXISTS "backend_only" ON public.ssl_expiry_alert_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.ticket_assignments;
DROP POLICY IF EXISTS "backend_only" ON public.recycle_bin;
DROP POLICY IF EXISTS "backend_only" ON public.email_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.user_name_mapping;
DROP POLICY IF EXISTS "backend_only" ON public.alertmanager_ssl_tickets;
DROP POLICY IF EXISTS "backend_only" ON public.reply_authors;
DROP POLICY IF EXISTS "backend_only" ON public.user_roles;

CREATE POLICY "backend_only" ON public.users                    AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ticket_closure           AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ssl_alert_tickets        AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.cloudops_members         AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.recycled_tickets         AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ihub_assets              AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ihub_alert_tickets       AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ssl_assets               AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ssl_expiry_alert_tickets AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.ticket_assignments       AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.recycle_bin              AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.email_tickets            AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.user_name_mapping        AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.alertmanager_ssl_tickets AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.reply_authors            AS RESTRICTIVE FOR ALL TO public USING (false);
CREATE POLICY "backend_only" ON public.user_roles               AS RESTRICTIVE FOR ALL TO public USING (false);
