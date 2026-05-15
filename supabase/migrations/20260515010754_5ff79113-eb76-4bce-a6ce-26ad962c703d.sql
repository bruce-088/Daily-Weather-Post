
ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS hook_used text,
  ADD COLUMN IF NOT EXISTS hook_id text,
  ADD COLUMN IF NOT EXISTS cinematic_mode boolean,
  ADD COLUMN IF NOT EXISTS cinematic_trigger text,
  ADD COLUMN IF NOT EXISTS voice_name text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'post_history'
      AND policyname = 'Users can update own posts'
  ) THEN
    CREATE POLICY "Users can update own posts"
      ON public.post_history
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END$$;
