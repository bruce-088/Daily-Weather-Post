-- =========================================
-- JOB-BASED PIPELINE FOUNDATION
-- =========================================

-- 1. Feature flag (default OFF — side-by-side rollout)
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS use_jobs_pipeline boolean NOT NULL DEFAULT false;

-- 2. Jobs table
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  -- Pipeline step type
  type text NOT NULL CHECK (type IN ('generate_content', 'generate_voice', 'render_video', 'publish_post')),
  -- pending | processing | succeeded | failed | cancelled
  status text NOT NULL DEFAULT 'pending',
  -- Payload passed between steps (weather, caption, voiceover_url, video_url, platform, city, etc.)
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Result of this step (merged into next job's payload)
  result jsonb,
  -- Retry / locking
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 2,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  -- Lineage for timeline view
  parent_job_id uuid,
  root_job_id uuid,
  scheduled_post_id uuid,
  -- Convenience for filtering
  city text,
  platform text,
  -- Timing
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the worker hot-path
CREATE INDEX IF NOT EXISTS idx_jobs_claim
  ON public.jobs (status, scheduled_for)
  WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON public.jobs (user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_root ON public.jobs (root_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_post ON public.jobs (scheduled_post_id);
CREATE INDEX IF NOT EXISTS idx_jobs_locked ON public.jobs (locked_at) WHERE status = 'processing';

-- Updated_at trigger
DROP TRIGGER IF EXISTS jobs_updated_at ON public.jobs;
CREATE TRIGGER jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3. RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own jobs" ON public.jobs;
CREATE POLICY "Users read own jobs" ON public.jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access jobs" ON public.jobs;
CREATE POLICY "Service role full access jobs" ON public.jobs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Atomic claim function — FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_next_jobs(p_worker_id text, p_limit int DEFAULT 5)
RETURNS SETOF public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.jobs
    WHERE status IN ('pending', 'retrying')
      AND scheduled_for <= now()
    ORDER BY scheduled_for ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.jobs j
     SET status = 'processing',
         locked_at = now(),
         locked_by = p_worker_id,
         started_at = COALESCE(j.started_at, now()),
         attempts = j.attempts + 1
    FROM claimed
   WHERE j.id = claimed.id
   RETURNING j.*;
END;
$$;

-- 5. Recovery: jobs stuck in processing > 10 min => retrying
CREATE OR REPLACE FUNCTION public.recover_stuck_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rows_recovered integer;
BEGIN
  UPDATE public.jobs
     SET status = 'retrying',
         locked_at = NULL,
         locked_by = NULL,
         scheduled_for = now(),
         last_error = COALESCE(last_error, '') || ' [recovered from stuck processing]'
   WHERE status = 'processing'
     AND locked_at < now() - interval '10 minutes';
  GET DIAGNOSTICS rows_recovered = ROW_COUNT;
  RETURN rows_recovered;
END;
$$;

-- 6. Helper: enqueue child job with exponential backoff defaults
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_user_id uuid,
  p_type text,
  p_payload jsonb,
  p_parent_job_id uuid DEFAULT NULL,
  p_root_job_id uuid DEFAULT NULL,
  p_scheduled_post_id uuid DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.jobs (
    user_id, type, payload, parent_job_id, root_job_id,
    scheduled_post_id, city, platform, scheduled_for
  ) VALUES (
    p_user_id, p_type, COALESCE(p_payload, '{}'::jsonb),
    p_parent_job_id,
    COALESCE(p_root_job_id, p_parent_job_id),
    p_scheduled_post_id, p_city, p_platform, p_scheduled_for
  )
  RETURNING id INTO new_id;

  -- Self-reference root if this is the root
  IF p_parent_job_id IS NULL THEN
    UPDATE public.jobs SET root_job_id = new_id WHERE id = new_id;
  END IF;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_jobs(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stuck_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_job(uuid, text, jsonb, uuid, uuid, uuid, text, text, timestamptz) TO service_role;