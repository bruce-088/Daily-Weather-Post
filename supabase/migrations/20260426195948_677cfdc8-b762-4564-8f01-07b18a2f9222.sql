ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS voiceover_speed numeric NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS voiceover_stability numeric NOT NULL DEFAULT 0.55,
  ADD COLUMN IF NOT EXISTS voiceover_similarity numeric NOT NULL DEFAULT 0.78;