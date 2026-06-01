-- Phase 12CC-B Fix #1: Patch the monthly recap cron to send the x-cron-secret
-- header (the edge function's requireCronOrUser gate rejects the request
-- without it). Mirrors the weekly recap cron exactly, including the 60s
-- timeout.

SELECT cron.unschedule('create-monthly-recap-month-end');

SELECT cron.schedule(
  'create-monthly-recap-month-end',
  '59 23 28-31 * *',
  $cron$
  DO $body$
  DECLARE _cs text;
  BEGIN
    SELECT decrypted_secret INTO _cs FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
    PERFORM net.http_post(
      url := 'https://pewdswjhsesfondewucc.supabase.co/functions/v1/create-monthly-recap',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBld2Rzd2poc2VzZm9uZGV3dWNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTY2MTcsImV4cCI6MjA4ODM5MjYxN30.QoTkj77PCpn5XIP4Or6JBxbZF1ZQrPorNykx9gWmjSI',
        'x-cron-secret', _cs
      ),
      body := jsonb_build_object('trigger', 'cron', 'time', now()),
      timeout_milliseconds := 60000
    );
  END
  $body$;
  $cron$
);