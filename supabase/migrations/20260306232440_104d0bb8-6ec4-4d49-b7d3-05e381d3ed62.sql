ALTER TABLE public.weather_settings
ADD COLUMN youtube_access_token text,
ADD COLUMN youtube_refresh_token text,
ADD COLUMN youtube_channel_id text,
ADD COLUMN youtube_token_expires_at timestamptz;