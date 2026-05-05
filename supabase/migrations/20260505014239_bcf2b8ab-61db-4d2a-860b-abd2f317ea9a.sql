CREATE TABLE public.ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  memory_type text NOT NULL CHECK (memory_type IN ('hook','script','tone')),
  content text NOT NULL,
  performance_score double precision NOT NULL DEFAULT 0,
  condition text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_memory_user_type ON public.ai_memory(user_id, memory_type);
CREATE INDEX idx_ai_memory_condition ON public.ai_memory(condition) WHERE condition IS NOT NULL;

ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access ai_memory"
  ON public.ai_memory FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Users read own ai_memory"
  ON public.ai_memory FOR SELECT TO authenticated
  USING (user_id = auth.uid());