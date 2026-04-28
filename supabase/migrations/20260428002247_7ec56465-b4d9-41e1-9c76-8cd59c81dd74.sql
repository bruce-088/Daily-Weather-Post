
-- 1. cities (shared catalog)
CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text,
  country text NOT NULL DEFAULT 'US',
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, state, country)
);

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read cities" ON public.cities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Service role full access cities" ON public.cities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. user_cities (many-to-many)
CREATE TABLE public.user_cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, city_id)
);

CREATE INDEX idx_user_cities_user ON public.user_cities(user_id);
ALTER TABLE public.user_cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own user_cities" ON public.user_cities
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own user_cities" ON public.user_cities
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own user_cities" ON public.user_cities
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own user_cities" ON public.user_cities
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access user_cities" ON public.user_cities
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. social_accounts (global per user)
CREATE TABLE public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL, -- youtube | tiktok | twitter | instagram | linkedin
  account_name text,
  account_external_id text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, platform, account_external_id)
);

CREATE INDEX idx_social_accounts_user ON public.social_accounts(user_id);
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

-- Users can see they have an account but tokens should normally be read via service role.
CREATE POLICY "Users read own social_accounts" ON public.social_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own social_accounts" ON public.social_accounts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own social_accounts" ON public.social_accounts
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own social_accounts" ON public.social_accounts
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access social_accounts" ON public.social_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_social_accounts_updated
  BEFORE UPDATE ON public.social_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. automations (per user+city)
CREATE TABLE public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city_id uuid NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  morning_time time NOT NULL DEFAULT '07:00:00',
  afternoon_time time NOT NULL DEFAULT '13:00:00',
  evening_time time NOT NULL DEFAULT '18:00:00',
  morning_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  afternoon_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  evening_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- map of platform -> social_account.id (which account routes this city's posts)
  platform_account_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  voice_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone text NOT NULL DEFAULT 'professional',
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, city_id)
);

CREATE INDEX idx_automations_user ON public.automations(user_id);
CREATE INDEX idx_automations_city ON public.automations(city_id);
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own automations" ON public.automations
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own automations" ON public.automations
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own automations" ON public.automations
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users delete own automations" ON public.automations
  FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access automations" ON public.automations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER trg_automations_updated
  BEFORE UPDATE ON public.automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. extend scheduled_posts (additive, nullable, no FK enforcement to keep additive)
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS city_id uuid,
  ADD COLUMN IF NOT EXISTS automation_id uuid;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_city ON public.scheduled_posts(city_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_automation ON public.scheduled_posts(automation_id);

-- 6. Backfill from weather_settings
-- 6a. cities
INSERT INTO public.cities (name, state, country, timezone)
SELECT DISTINCT
  ws.city,
  NULLIF(ws.state, ''),
  'US',
  COALESCE(NULLIF(ws.timezone, ''), 'UTC')
FROM public.weather_settings ws
WHERE ws.city IS NOT NULL AND ws.city <> ''
ON CONFLICT (name, state, country) DO NOTHING;

-- 6b. user_cities
INSERT INTO public.user_cities (user_id, city_id, is_primary)
SELECT ws.user_id, c.id, true
FROM public.weather_settings ws
JOIN public.cities c
  ON c.name = ws.city
 AND c.country = 'US'
 AND (c.state IS NOT DISTINCT FROM NULLIF(ws.state, ''))
WHERE ws.user_id IS NOT NULL
ON CONFLICT (user_id, city_id) DO NOTHING;

-- 6c. automations
INSERT INTO public.automations (
  user_id, city_id, enabled,
  morning_time, afternoon_time, evening_time,
  morning_platforms, afternoon_platforms, evening_platforms,
  voice_settings, tone, timezone
)
SELECT
  ws.user_id,
  c.id,
  COALESCE(ws.auto_post, false),
  ws.morning_post_time,
  ws.afternoon_post_time,
  ws.evening_post_time,
  ws.morning_platforms,
  ws.afternoon_platforms,
  ws.evening_platforms,
  jsonb_build_object(
    'enabled', ws.enable_voiceover,
    'voice_id', ws.voiceover_voice_id,
    'speed', ws.voiceover_speed,
    'stability', ws.voiceover_stability,
    'similarity', ws.voiceover_similarity
  ),
  COALESCE(ws.caption_tone, 'professional'),
  COALESCE(NULLIF(ws.timezone, ''), 'UTC')
FROM public.weather_settings ws
JOIN public.cities c
  ON c.name = ws.city
 AND c.country = 'US'
 AND (c.state IS NOT DISTINCT FROM NULLIF(ws.state, ''))
WHERE ws.user_id IS NOT NULL
ON CONFLICT (user_id, city_id) DO NOTHING;

-- 6d. social_accounts (one row per connected platform from weather_settings)
-- YouTube
INSERT INTO public.social_accounts (user_id, platform, account_external_id, access_token, refresh_token, token_expires_at, extra)
SELECT ws.user_id, 'youtube', ws.youtube_channel_id, ws.youtube_access_token, ws.youtube_refresh_token, ws.youtube_token_expires_at, '{}'::jsonb
FROM public.weather_settings ws
WHERE ws.user_id IS NOT NULL AND ws.youtube_access_token IS NOT NULL
ON CONFLICT (user_id, platform, account_external_id) DO NOTHING;

-- TikTok
INSERT INTO public.social_accounts (user_id, platform, account_external_id, access_token, refresh_token, token_expires_at, extra)
SELECT ws.user_id, 'tiktok', ws.tiktok_open_id, ws.tiktok_access_token, ws.tiktok_refresh_token, ws.tiktok_token_expires_at, '{}'::jsonb
FROM public.weather_settings ws
WHERE ws.user_id IS NOT NULL AND ws.tiktok_access_token IS NOT NULL
ON CONFLICT (user_id, platform, account_external_id) DO NOTHING;

-- Twitter
INSERT INTO public.social_accounts (user_id, platform, account_external_id, access_token, extra)
SELECT ws.user_id, 'twitter', ws.twitter_user_id, ws.twitter_access_token,
  jsonb_build_object('access_token_secret', ws.twitter_access_token_secret)
FROM public.weather_settings ws
WHERE ws.user_id IS NOT NULL AND ws.twitter_access_token IS NOT NULL
ON CONFLICT (user_id, platform, account_external_id) DO NOTHING;

-- LinkedIn
INSERT INTO public.social_accounts (user_id, platform, account_external_id, access_token, refresh_token, token_expires_at, extra)
SELECT ws.user_id, 'linkedin', ws.linkedin_person_urn, ws.linkedin_access_token, ws.linkedin_refresh_token, ws.linkedin_token_expires_at,
  jsonb_build_object('organization_urn', ws.linkedin_organization_urn)
FROM public.weather_settings ws
WHERE ws.user_id IS NOT NULL AND ws.linkedin_access_token IS NOT NULL
ON CONFLICT (user_id, platform, account_external_id) DO NOTHING;
