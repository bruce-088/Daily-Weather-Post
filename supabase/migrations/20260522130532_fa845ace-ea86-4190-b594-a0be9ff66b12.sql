-- 1. Delete duplicate automations, keep most recent per (user_id, city_id)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, city_id
           ORDER BY updated_at DESC, created_at DESC
         ) AS rn
  FROM public.automations
)
DELETE FROM public.automations a
USING ranked r
WHERE a.id = r.id AND r.rn > 1;

-- 2. Enforce uniqueness going forward
ALTER TABLE public.automations
  ADD CONSTRAINT automations_user_city_unique UNIQUE (user_id, city_id);

-- 3. Partial unique index on active generate_content jobs per slot per UTC day
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_generate_content_slot_uniq
  ON public.jobs (
    user_id, city, platform,
    ((payload->>'slot')),
    ((date_trunc('day', created_at AT TIME ZONE 'UTC')))
  )
  WHERE type = 'generate_content'
    AND status IN ('pending','processing','retrying');