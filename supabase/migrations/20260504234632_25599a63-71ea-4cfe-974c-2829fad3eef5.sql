
-- A/B Experiments engine + Growth Insights feed

CREATE TABLE public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city text,
  variable_tested text NOT NULL CHECK (variable_tested IN ('hook','tone','visuals')),
  variant_a_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  variant_b_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_post_id_a uuid,
  scheduled_post_id_b uuid,
  post_id_a uuid,
  post_id_b uuid,
  winner_post_id uuid,
  winner_variant text CHECK (winner_variant IN ('A','B','tie','none')),
  delta_pct numeric,
  status text NOT NULL DEFAULT 'gathering_data' CHECK (status IN ('gathering_data','concluded','cancelled','no_winner')),
  insight_generated boolean NOT NULL DEFAULT false,
  conclude_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  concluded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_experiments_user_status ON public.experiments(user_id, status);
CREATE INDEX idx_experiments_conclude_at ON public.experiments(conclude_at) WHERE status = 'gathering_data';

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access experiments" ON public.experiments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own experiments" ON public.experiments FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Rollup of repeated wins per (variable, winning value)
CREATE TABLE public.experiment_wins (
  user_id uuid NOT NULL,
  variable text NOT NULL,
  winning_value text NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  win_rate numeric NOT NULL DEFAULT 0,
  last_win_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, variable, winning_value)
);
ALTER TABLE public.experiment_wins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access experiment_wins" ON public.experiment_wins FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own experiment_wins" ON public.experiment_wins FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Persistent Growth Log feed (separate from notifications so it has its own lifecycle)
CREATE TABLE public.growth_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  experiment_id uuid REFERENCES public.experiments(id) ON DELETE CASCADE,
  variable text NOT NULL,
  winner_variant text NOT NULL,
  winner_value text,
  loser_value text,
  delta_pct numeric NOT NULL DEFAULT 0,
  title text NOT NULL,
  message text NOT NULL,
  post_id_a uuid,
  post_id_b uuid,
  city text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_growth_insights_user ON public.growth_insights(user_id, created_at DESC);
ALTER TABLE public.growth_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access growth_insights" ON public.growth_insights FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Users read own growth_insights" ON public.growth_insights FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users update own growth_insights" ON public.growth_insights FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Tag posts with their experiment context
ALTER TABLE public.scheduled_posts
  ADD COLUMN experiment_id uuid,
  ADD COLUMN experiment_variant text CHECK (experiment_variant IN ('A','B'));

ALTER TABLE public.post_history
  ADD COLUMN experiment_id uuid,
  ADD COLUMN experiment_variant text CHECK (experiment_variant IN ('A','B'));

-- Enable realtime for the feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.growth_insights;
