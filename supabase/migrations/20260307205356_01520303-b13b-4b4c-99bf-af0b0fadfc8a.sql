
-- Add LinkedIn columns to weather_settings
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS linkedin_access_token text,
  ADD COLUMN IF NOT EXISTS linkedin_refresh_token text,
  ADD COLUMN IF NOT EXISTS linkedin_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS linkedin_person_urn text;

-- Update post_history platform check to include linkedin
ALTER TABLE public.post_history DROP CONSTRAINT IF EXISTS post_history_platform_check;
ALTER TABLE public.post_history ADD CONSTRAINT post_history_platform_check
  CHECK (platform IN ('instagram', 'tiktok', 'youtube', 'twitter', 'linkedin', 'both', 'none'));
