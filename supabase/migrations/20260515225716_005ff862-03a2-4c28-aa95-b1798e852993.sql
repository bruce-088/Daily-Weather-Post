-- 1) Lock down the shared cities reference table — only the backend (service_role) can insert.
DROP POLICY IF EXISTS "Authenticated can insert cities" ON public.cities;

-- 2) Lock down skybrief-media uploads — only the backend (service_role) can upload.
DROP POLICY IF EXISTS "Authenticated upload skybrief-media" ON storage.objects;

-- 3) Provision a cron-auth shared secret in Vault and wire it into every pg_cron job.
DO $cron$
DECLARE
  v_secret text;
  v_job RECORD;
  v_existing uuid;
  v_new_command text;
BEGIN
  -- Fetch existing or create a new vault secret named 'cron_secret'.
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'cron_secret' LIMIT 1;
  IF v_existing IS NULL THEN
    v_secret := encode(gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(v_secret, 'cron_secret', 'pg_cron -> edge function shared auth secret');
    RAISE NOTICE '======================================================================';
    RAISE NOTICE 'CRON_SECRET (copy this exact value into the CRON_SECRET backend secret):';
    RAISE NOTICE '%', v_secret;
    RAISE NOTICE '======================================================================';
  ELSE
    RAISE NOTICE 'cron_secret already exists in Vault — keeping existing value.';
  END IF;

  -- Rewrite each cron job command to include the x-cron-secret header pulled from Vault.
  FOR v_job IN
    SELECT jobid, jobname, command FROM cron.job
    WHERE command LIKE '%/functions/v1/%'
      AND command NOT LIKE '%x-cron-secret%'
  LOOP
    v_new_command := format(
      $cmd$
      DO $body$
      DECLARE _cs text;
      BEGIN
        SELECT decrypted_secret INTO _cs FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
        PERFORM net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', %L,
            'x-cron-secret', _cs
          ),
          body := '{"trigger":"cron"}'::jsonb,
          timeout_milliseconds := 60000
        );
      END
      $body$;
      $cmd$,
      -- Extract URL from existing command (best-effort regex).
      (regexp_match(v_job.command, 'https://[^''" ]+/functions/v1/[a-zA-Z0-9_-]+'))[1],
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBld2Rzd2poc2VzZm9uZGV3dWNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTY2MTcsImV4cCI6MjA4ODM5MjYxN30.QoTkj77PCpn5XIP4Or6JBxbZF1ZQrPorNykx9gWmjSI'
    );
    PERFORM cron.alter_job(job_id := v_job.jobid, command := v_new_command);
    RAISE NOTICE 'Updated cron job % (id=%) with x-cron-secret header.', v_job.jobname, v_job.jobid;
  END LOOP;
END
$cron$;