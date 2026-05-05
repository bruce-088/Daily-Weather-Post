ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS city_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_social_accounts_user_city_platform
  ON public.social_accounts (user_id, city_id, platform);

CREATE INDEX IF NOT EXISTS idx_social_accounts_user_platform
  ON public.social_accounts (user_id, platform);