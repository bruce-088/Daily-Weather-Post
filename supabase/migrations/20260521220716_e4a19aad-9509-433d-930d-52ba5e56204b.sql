
CREATE TABLE public.post_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NULL,
  city text NOT NULL,
  platform text NOT NULL,
  slot text NULL CHECK (slot IS NULL OR slot IN ('morning','afternoon','evening')),
  title text NOT NULL,
  caption text NULL,
  hook_text text NULL,
  tone text NULL,
  style text NULL,
  weather_condition text NULL,
  posted_with_voice boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL,
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  impressions integer NULL,
  ctr numeric NULL,
  engagement_score numeric NULL,
  source text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX post_performance_post_platform_uidx
  ON public.post_performance (post_id, platform)
  WHERE post_id IS NOT NULL;

CREATE INDEX post_performance_city_idx ON public.post_performance (city);
CREATE INDEX post_performance_platform_idx ON public.post_performance (platform);
CREATE INDEX post_performance_published_at_idx ON public.post_performance (published_at DESC);
CREATE INDEX post_performance_city_platform_published_idx
  ON public.post_performance (city, platform, published_at DESC);
CREATE INDEX post_performance_post_id_idx ON public.post_performance (post_id);

ALTER TABLE public.post_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access post_performance"
  ON public.post_performance
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Users read own post_performance"
  ON public.post_performance
  FOR SELECT
  TO authenticated
  USING (
    post_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.post_history ph
       WHERE ph.id = post_performance.post_id
         AND ph.user_id = auth.uid()
    )
  );

CREATE TRIGGER post_performance_set_updated_at
  BEFORE UPDATE ON public.post_performance
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
