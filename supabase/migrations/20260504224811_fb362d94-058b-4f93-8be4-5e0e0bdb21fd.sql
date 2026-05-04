ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS likes_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retention_rate numeric(5,4),
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_post_history_user_created
  ON public.post_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_history_external_id
  ON public.post_history (external_id) WHERE external_id IS NOT NULL;