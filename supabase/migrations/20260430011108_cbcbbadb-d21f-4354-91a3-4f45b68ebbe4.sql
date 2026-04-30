-- Add idempotency unique constraint to scheduled_posts so the same
-- (user_id, city, platform, scheduled_at) tuple can only ever exist once.
-- Existing duplicates (if any) are collapsed to the earliest row before
-- the constraint is applied.

-- Step 1: dedupe — keep the oldest row per (user_id, city, platform, scheduled_at)
DELETE FROM public.scheduled_posts a
USING public.scheduled_posts b
WHERE a.user_id = b.user_id
  AND a.city = b.city
  AND a.platform = b.platform
  AND a.scheduled_at = b.scheduled_at
  AND a.created_at > b.created_at;

-- Step 2: add unique constraint (acts as the idempotency key)
ALTER TABLE public.scheduled_posts
  ADD CONSTRAINT scheduled_posts_unique_job
  UNIQUE (user_id, city, platform, scheduled_at);

-- Step 3: helpful index for the atomic-claim query in the processor
CREATE INDEX IF NOT EXISTS scheduled_posts_status_due_idx
  ON public.scheduled_posts (status, scheduled_at);