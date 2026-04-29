
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS voice_status text,
  ADD COLUMN IF NOT EXISTS voice_error text,
  ADD COLUMN IF NOT EXISTS voice_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debug_trace jsonb;

ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS voice_status text,
  ADD COLUMN IF NOT EXISTS voice_error text,
  ADD COLUMN IF NOT EXISTS voice_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debug_trace jsonb;

ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS enable_debug_trace boolean NOT NULL DEFAULT false;
