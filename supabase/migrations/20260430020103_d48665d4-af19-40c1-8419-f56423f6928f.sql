-- 1. Extend post_analytics with learning context
ALTER TABLE public.post_analytics
  ADD COLUMN IF NOT EXISTS tone text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS time_of_day text,
  ADD COLUMN IF NOT EXISTS has_voiceover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_local_reference boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_id text;

CREATE INDEX IF NOT EXISTS idx_post_analytics_user_platform_external
  ON public.post_analytics (user_id, platform, external_id);

CREATE INDEX IF NOT EXISTS idx_post_analytics_grouping
  ON public.post_analytics (user_id, condition, tone, time_of_day);

-- 2. Performance-learning toggle on weather_settings
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS use_performance_learning boolean NOT NULL DEFAULT true;

-- 3. content_insights table
CREATE TABLE IF NOT EXISTS public.content_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  condition text NOT NULL,
  tone text NOT NULL,
  time_of_day text NOT NULL,
  avg_views numeric NOT NULL DEFAULT 0,
  avg_engagement numeric NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  top_hook text,
  delta_pct numeric,
  rank integer NOT NULL DEFAULT 0,
  computed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, condition, tone, time_of_day)
);

ALTER TABLE public.content_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own content_insights"
  ON public.content_insights FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access content_insights"
  ON public.content_insights FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_content_insights_lookup
  ON public.content_insights (user_id, condition, time_of_day, rank);
