ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_processing_last_attempt
  ON public.scheduled_posts (status, last_attempt_at)
  WHERE status = 'processing';