-- Persist user preference for AI voiceover on auto-posts
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS enable_voiceover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voiceover_voice_id text NOT NULL DEFAULT 'female';

-- Track voiceover intent + (optional) pre-generated audio URL on each scheduled post
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS include_voiceover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voiceover_url text;