ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS test_type text NOT NULL DEFAULT 'content',
  ADD COLUMN IF NOT EXISTS scheduled_time_offset_a integer,
  ADD COLUMN IF NOT EXISTS scheduled_time_offset_b integer;

CREATE INDEX IF NOT EXISTS idx_experiments_test_type ON public.experiments(test_type);
CREATE INDEX IF NOT EXISTS idx_ai_memory_user_type ON public.ai_memory(user_id, memory_type);