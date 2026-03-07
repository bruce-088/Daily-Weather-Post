-- Add Twitter/X columns to weather_settings
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS twitter_access_token text,
  ADD COLUMN IF NOT EXISTS twitter_access_token_secret text,
  ADD COLUMN IF NOT EXISTS twitter_user_id text;

-- Update post_history platform check constraint to include 'twitter'
ALTER TABLE public.post_history DROP CONSTRAINT IF EXISTS post_history_platform_check;
ALTER TABLE public.post_history ADD CONSTRAINT post_history_platform_check
  CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'twitter', 'both', 'none'));