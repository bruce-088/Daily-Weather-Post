ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS morning_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS afternoon_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evening_platforms jsonb NOT NULL DEFAULT '[]'::jsonb;