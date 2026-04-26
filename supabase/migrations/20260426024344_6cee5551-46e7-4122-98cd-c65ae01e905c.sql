ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS morning_skip_date date,
  ADD COLUMN IF NOT EXISTS afternoon_skip_date date,
  ADD COLUMN IF NOT EXISTS evening_skip_date date;