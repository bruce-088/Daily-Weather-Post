
CREATE POLICY "Users can delete own settings"
ON public.weather_settings
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

DO $$
DECLARE
  col text;
  cols text[] := ARRAY[
    'instagram_api_key','tiktok_api_key',
    'tiktok_access_token','tiktok_refresh_token','tiktok_open_id',
    'youtube_access_token','youtube_refresh_token','youtube_channel_id',
    'twitter_access_token','twitter_access_token_secret','twitter_user_id',
    'linkedin_access_token','linkedin_refresh_token',
    'linkedin_person_urn','linkedin_organization_urn'
  ];
BEGIN
  FOREACH col IN ARRAY cols LOOP
    EXECUTE format('REVOKE SELECT (%I) ON public.weather_settings FROM authenticated, anon', col);
  END LOOP;
END$$;

ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS tiktok_connected boolean GENERATED ALWAYS AS (tiktok_access_token IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS youtube_connected boolean GENERATED ALWAYS AS (youtube_access_token IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS twitter_connected boolean GENERATED ALWAYS AS (twitter_access_token IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS linkedin_connected boolean GENERATED ALWAYS AS (linkedin_access_token IS NOT NULL) STORED,
  ADD COLUMN IF NOT EXISTS youtube_has_refresh_token boolean GENERATED ALWAYS AS (youtube_refresh_token IS NOT NULL) STORED;

DROP POLICY IF EXISTS "Brand assets admin write" ON storage.objects;
CREATE POLICY "Brand assets admin write"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'brand-assets' AND false);

DROP POLICY IF EXISTS "Brand assets admin update" ON storage.objects;
CREATE POLICY "Brand assets admin update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'brand-assets' AND false);

DROP POLICY IF EXISTS "Brand assets admin delete" ON storage.objects;
CREATE POLICY "Brand assets admin delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'brand-assets' AND false);
