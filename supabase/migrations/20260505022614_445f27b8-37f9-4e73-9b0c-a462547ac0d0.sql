ALTER TABLE public.ai_memory
  ADD COLUMN IF NOT EXISTS voice_id text,
  ADD COLUMN IF NOT EXISTS voice_style text,
  ADD COLUMN IF NOT EXISTS time_of_day text,
  ADD COLUMN IF NOT EXISTS views integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ai_memory_voice_lookup
  ON public.ai_memory(user_id, condition, time_of_day, voice_id)
  WHERE voice_id IS NOT NULL;