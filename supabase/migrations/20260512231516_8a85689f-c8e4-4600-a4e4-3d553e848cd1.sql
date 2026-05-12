
CREATE TABLE IF NOT EXISTS public.preview_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city_id uuid,
  city text,
  state text,
  weather_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  caption_text text,
  voice_script text,
  visual_source text NOT NULL DEFAULT 'unknown',
  content_type text NOT NULL DEFAULT 'video',
  storage_bucket text,
  storage_path text,
  asset_url text,
  audio_url text,
  background_url text,
  template_id text,
  render_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  status text NOT NULL DEFAULT 'locked',
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS preview_bundles_user_idx ON public.preview_bundles(user_id, generated_at DESC);

ALTER TABLE public.preview_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access preview_bundles"
  ON public.preview_bundles FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users read own preview_bundles"
  ON public.preview_bundles FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS preview_bundle_id uuid,
  ADD COLUMN IF NOT EXISTS published_visual_source text;
