CREATE TABLE IF NOT EXISTS public.system_health (
  id TEXT NOT NULL PRIMARY KEY,
  last_run_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_status TEXT,
  last_message TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read system_health"
  ON public.system_health FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role full access system_health"
  ON public.system_health FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.system_health (id, last_status, last_message)
VALUES ('auto-post-scheduler', 'init', 'created')
ON CONFLICT (id) DO NOTHING;