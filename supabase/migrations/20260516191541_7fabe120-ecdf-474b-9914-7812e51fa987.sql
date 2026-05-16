ALTER TABLE public.post_analytics
  ADD COLUMN IF NOT EXISTS performance_score numeric,
  ADD COLUMN IF NOT EXISTS winning_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS losing_factors jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS post_analytics_user_perfscore_idx
  ON public.post_analytics (user_id, performance_score DESC NULLS LAST);