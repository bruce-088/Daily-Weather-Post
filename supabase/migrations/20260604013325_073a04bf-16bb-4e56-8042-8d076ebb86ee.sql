ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS daily_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS weekly_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_enabled boolean NOT NULL DEFAULT true;