ALTER TABLE public.automations
  ADD COLUMN IF NOT EXISTS pinned_comment_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_comment_text text;

ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS pinned_comment_id text;