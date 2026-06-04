ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS oauth_project text NOT NULL DEFAULT 'A';

ALTER TABLE public.social_accounts
  DROP CONSTRAINT IF EXISTS social_accounts_oauth_project_check;
ALTER TABLE public.social_accounts
  ADD CONSTRAINT social_accounts_oauth_project_check
  CHECK (oauth_project IN ('A','B'));

-- Backfill: every existing YouTube row belongs to Project A (shorts).
UPDATE public.social_accounts
   SET oauth_project = 'A'
 WHERE platform = 'youtube' AND oauth_project IS DISTINCT FROM 'A';

CREATE INDEX IF NOT EXISTS social_accounts_user_platform_project_idx
  ON public.social_accounts (user_id, platform, oauth_project);
