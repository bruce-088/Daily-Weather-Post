
-- 1. Repair any US automations stuck on UTC (treat as misconfigured legacy rows)
UPDATE public.automations a
SET timezone = 'America/New_York', updated_at = now()
FROM public.cities c
WHERE a.city_id = c.id
  AND a.timezone = 'UTC'
  AND c.country = 'US';

-- 2. Helper that lets an authenticated edge function (running with the service
--    role key) rewrite the vault `cron_secret` to match a known value, so that
--    pg_cron's HTTP calls authenticate against the edge function's CRON_SECRET
--    env var.  SECURITY DEFINER + restrictive grants — callable only from
--    inside Postgres by superuser/service role.
CREATE OR REPLACE FUNCTION public.admin_set_cron_secret(p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_value IS NULL OR length(p_value) < 8 THEN
    RAISE EXCEPTION 'cron secret too short';
  END IF;
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'cron_secret' LIMIT 1;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_value, 'cron_secret', 'Shared HMAC for pg_cron -> edge function calls');
  ELSE
    PERFORM vault.update_secret(v_id, p_value, 'cron_secret', 'Shared HMAC for pg_cron -> edge function calls');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_cron_secret(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_cron_secret(text) TO service_role;
