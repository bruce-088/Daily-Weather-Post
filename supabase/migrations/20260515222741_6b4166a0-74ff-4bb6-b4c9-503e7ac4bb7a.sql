
-- Layer 1: extend post_analytics
ALTER TABLE public.post_analytics
  ADD COLUMN IF NOT EXISTS hook_type text,
  ADD COLUMN IF NOT EXISTS hook_text text,
  ADD COLUMN IF NOT EXISTS cinematic boolean,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_hour smallint,
  ADD COLUMN IF NOT EXISTS views_24h integer,
  ADD COLUMN IF NOT EXISTS views_7d integer,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS city text;

CREATE INDEX IF NOT EXISTS idx_post_analytics_user_city ON public.post_analytics(user_id, city);
CREATE INDEX IF NOT EXISTS idx_post_analytics_posted_at ON public.post_analytics(posted_at);

-- Backfill from post_history where possible
UPDATE public.post_analytics pa
   SET city         = COALESCE(pa.city, ph.city),
       posted_at    = COALESCE(pa.posted_at, ph.created_at),
       posted_hour  = COALESCE(pa.posted_hour, EXTRACT(HOUR FROM ph.created_at)::smallint),
       cinematic    = COALESCE(pa.cinematic, ph.cinematic_mode),
       hook_text    = COALESCE(pa.hook_text, ph.hook_used),
       hook_type    = COALESCE(pa.hook_type,
         CASE
           WHEN ph.hook_id ILIKE '%a%' OR ph.hook_id = '0' THEN 'A'
           WHEN ph.hook_id ILIKE '%b%' OR ph.hook_id = '1' THEN 'B'
           WHEN ph.hook_id ILIKE '%c%' OR ph.hook_id = '2' THEN 'C'
           ELSE NULL
         END),
       views_24h    = COALESCE(pa.views_24h, ph.views_count),
       score        = COALESCE(pa.score,
         (COALESCE(ph.views_count,0)::numeric * 1.0)
         + (COALESCE(ph.likes_count,0)::numeric * 10.0)
         + (COALESCE(ph.retention_rate,0)::numeric * 50.0))
  FROM public.post_history ph
 WHERE pa.post_id = ph.id;

-- Layer 2: winner_stats
CREATE TABLE IF NOT EXISTS public.winner_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  best_hook_type text,
  best_hook_avg numeric,
  best_hour smallint,
  best_hour_avg numeric,
  worst_hour smallint,
  worst_hour_avg numeric,
  best_condition text,
  best_condition_avg numeric,
  cinematic_lift_pct numeric,
  voice_lift_pct numeric,
  city_avg_views numeric,
  sample_size integer NOT NULL DEFAULT 0,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(user_id, city)
);
ALTER TABLE public.winner_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access winner_stats" ON public.winner_stats
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own winner_stats" ON public.winner_stats
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Layer 5: winner_repost_suggestions
CREATE TABLE IF NOT EXISTS public.winner_repost_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid NOT NULL,
  city text,
  suggested_at timestamptz NOT NULL DEFAULT now(),
  reason text,
  status text NOT NULL DEFAULT 'pending',
  views_24h integer,
  city_avg numeric,
  UNIQUE(post_id)
);
ALTER TABLE public.winner_repost_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access winner_repost_suggestions" ON public.winner_repost_suggestions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own winner_repost_suggestions" ON public.winner_repost_suggestions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own winner_repost_suggestions" ON public.winner_repost_suggestions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Layer 4: opt-in toggles on weather_settings
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS auto_apply_winning_hook boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_adjust_post_times boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_cinematic_for_storms boolean NOT NULL DEFAULT false;
