
CREATE TABLE IF NOT EXISTS public.hook_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  hook_text TEXT NOT NULL,
  uses INTEGER NOT NULL DEFAULT 0,
  total_views NUMERIC NOT NULL DEFAULT 0,
  avg_views NUMERIC NOT NULL DEFAULT 0,
  total_engagement NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  rank INTEGER,
  last_used_at TIMESTAMPTZ,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hook_stats_user_idx ON public.hook_stats(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS hook_stats_user_hook_uniq ON public.hook_stats(user_id, hook_text);
ALTER TABLE public.hook_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own hook_stats" ON public.hook_stats FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access hook_stats" ON public.hook_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.time_slot_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  day_of_week SMALLINT NOT NULL,
  hour SMALLINT NOT NULL,
  posts INTEGER NOT NULL DEFAULT 0,
  total_views NUMERIC NOT NULL DEFAULT 0,
  avg_views NUMERIC NOT NULL DEFAULT 0,
  total_engagement NUMERIC NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_slot_stats_user_idx ON public.time_slot_stats(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS time_slot_stats_user_slot_uniq ON public.time_slot_stats(user_id, day_of_week, hour);
ALTER TABLE public.time_slot_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own time_slot_stats" ON public.time_slot_stats FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access time_slot_stats" ON public.time_slot_stats FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.trend_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  city TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'moderate',
  starts_at TIMESTAMPTZ,
  message TEXT NOT NULL,
  suggested_post_id UUID,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  alert_date DATE NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trend_alerts_user_idx ON public.trend_alerts(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS trend_alerts_dedupe_idx ON public.trend_alerts(user_id, city, alert_type, alert_date);
ALTER TABLE public.trend_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own trend_alerts" ON public.trend_alerts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own trend_alerts" ON public.trend_alerts FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access trend_alerts" ON public.trend_alerts FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.growth_recommendations (
  user_id UUID NOT NULL PRIMARY KEY,
  recommendation TEXT NOT NULL,
  top_hooks JSONB NOT NULL DEFAULT '[]'::jsonb,
  best_slot JSONB,
  variety_score NUMERIC NOT NULL DEFAULT 100,
  recent_tones JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_openers JSONB NOT NULL DEFAULT '[]'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.growth_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own growth_recommendations" ON public.growth_recommendations FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access growth_recommendations" ON public.growth_recommendations FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.post_hooks ADD COLUMN IF NOT EXISTS opener TEXT;
