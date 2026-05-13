ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS health_score integer,
  ADD COLUMN IF NOT EXISTS health_breakdown jsonb;