-- Add helpful index for analytics lookups
CREATE INDEX IF NOT EXISTS idx_post_analytics_post_id ON public.post_analytics(post_id);
CREATE INDEX IF NOT EXISTS idx_post_analytics_user_platform ON public.post_analytics(user_id, platform);

-- Add external_id column to post_history so we can later refresh metrics from the platform API
ALTER TABLE public.post_history ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE INDEX IF NOT EXISTS idx_post_history_external_id ON public.post_history(external_id) WHERE external_id IS NOT NULL;