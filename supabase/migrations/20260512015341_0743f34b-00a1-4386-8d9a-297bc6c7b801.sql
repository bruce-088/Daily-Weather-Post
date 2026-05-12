
CREATE TABLE IF NOT EXISTS public.pipeline_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city text,
  scheduled_post_id uuid,
  job_id uuid,
  visual_style text,
  voice_tone text,
  hook_type text,
  views integer NOT NULL DEFAULT 0,
  engagement integer NOT NULL DEFAULT 0,
  user_avg_views numeric NOT NULL DEFAULT 0,
  performance text NOT NULL DEFAULT 'unknown',
  recommendation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_reflections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access pipeline_reflections"
  ON public.pipeline_reflections FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Users read own pipeline_reflections"
  ON public.pipeline_reflections FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS pipeline_reflections_user_city_created_idx
  ON public.pipeline_reflections (user_id, city, created_at DESC);
