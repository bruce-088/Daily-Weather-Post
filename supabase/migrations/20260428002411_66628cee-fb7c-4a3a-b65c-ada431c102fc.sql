
CREATE TABLE public.post_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid,
  platform text NOT NULL,
  views integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_analytics_user ON public.post_analytics(user_id);
CREATE INDEX idx_post_analytics_post ON public.post_analytics(post_id);
ALTER TABLE public.post_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own post_analytics" ON public.post_analytics
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own post_analytics" ON public.post_analytics
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own post_analytics" ON public.post_analytics
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role full access post_analytics" ON public.post_analytics
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.post_hooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid,
  hook_text text,
  tone text,
  platform text,
  city text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_hooks_user ON public.post_hooks(user_id);
CREATE INDEX idx_post_hooks_post ON public.post_hooks(post_id);
ALTER TABLE public.post_hooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own post_hooks" ON public.post_hooks
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own post_hooks" ON public.post_hooks
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Service role full access post_hooks" ON public.post_hooks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
