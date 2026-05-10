ALTER TABLE public.post_history ADD COLUMN IF NOT EXISTS visual_metadata jsonb;
CREATE INDEX IF NOT EXISTS idx_post_history_visual_style ON public.post_history ((visual_metadata->>'visual_style'));