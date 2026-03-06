ALTER TABLE public.weather_settings 
  ADD COLUMN tiktok_access_token text DEFAULT null,
  ADD COLUMN tiktok_refresh_token text DEFAULT null,
  ADD COLUMN tiktok_open_id text DEFAULT null,
  ADD COLUMN tiktok_token_expires_at timestamp with time zone DEFAULT null;