ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS smart_cost_strategy boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS strict_visuals_gainesville boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exclude_fallback_from_learning boolean NOT NULL DEFAULT true;