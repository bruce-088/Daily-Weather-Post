-- A/B Testing extension for YouTube Shorts (additive only).
-- Adds explicit experiment_type / rollout_mode / scheduled_slot to experiments,
-- variant_id tagging on scheduled_posts + post_history, and the YouTube
-- retention metrics needed for winner scoring. All columns nullable so
-- existing rows remain valid.

ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS experiment_type text,
  ADD COLUMN IF NOT EXISTS rollout_mode text NOT NULL DEFAULT 'manual_select_winner',
  ADD COLUMN IF NOT EXISTS scheduled_slot text,
  ADD COLUMN IF NOT EXISTS city_id uuid,
  ADD COLUMN IF NOT EXISTS platform text;

ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS variant_id text;

ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS variant_id text;

ALTER TABLE public.post_analytics
  ADD COLUMN IF NOT EXISTS avg_percentage_viewed numeric,
  ADD COLUMN IF NOT EXISTS avg_view_duration_sec numeric,
  ADD COLUMN IF NOT EXISTS subscribers_gained integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_experiment
  ON public.scheduled_posts(experiment_id) WHERE experiment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_post_history_variant
  ON public.post_history(experiment_id, variant_id) WHERE experiment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_experiments_status_type
  ON public.experiments(status, experiment_type);