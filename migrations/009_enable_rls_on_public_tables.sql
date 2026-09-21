-- Enable RLS on public tables flagged by Supabase Security Advisor.
-- This addresses:
-- 1) rls_disabled_in_public
-- 2) sensitive_columns_exposed (users.password)
--
-- Note:
-- Enabling RLS is the minimum secure baseline. Add explicit policies if you
-- need anon/authenticated client access through PostgREST.

ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_closure ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ssl_alert_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.cloudops_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.recycled_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ihub_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ihub_alert_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ssl_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ssl_expiry_alert_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.recycle_bin ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.email_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_name_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.alertmanager_ssl_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.reply_authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_roles ENABLE ROW LEVEL SECURITY;
