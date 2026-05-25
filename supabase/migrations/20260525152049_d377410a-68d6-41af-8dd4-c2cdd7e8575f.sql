-- Add user_id to post_performance so rows are owner-scoped even when post_id is NULL
ALTER TABLE public.post_performance ADD COLUMN IF NOT EXISTS user_id uuid;

-- Backfill from post_history
UPDATE public.post_performance pp
   SET user_id = ph.user_id
  FROM public.post_history ph
 WHERE pp.user_id IS NULL AND pp.post_id = ph.id;

CREATE INDEX IF NOT EXISTS idx_post_performance_user_id ON public.post_performance(user_id);

-- Replace SELECT policy to use direct user_id ownership (covers NULL post_id rows)
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
     WHERE polrelid = 'public.post_performance'::regclass
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.post_performance', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "Users can view their own post_performance"
  ON public.post_performance FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (post_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.post_history ph
       WHERE ph.id = post_performance.post_id AND ph.user_id = auth.uid()
    ))
  );

CREATE POLICY "Users can insert their own post_performance"
  ON public.post_performance FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own post_performance"
  ON public.post_performance FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());