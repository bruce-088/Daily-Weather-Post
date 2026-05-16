-- Fix 1: persist slot + source columns
ALTER TABLE public.scheduled_posts
  ADD COLUMN IF NOT EXISTS slot text,
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.post_history
  ADD COLUMN IF NOT EXISTS slot text,
  ADD COLUMN IF NOT EXISTS source text;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_city_slot
  ON public.scheduled_posts (user_id, city_id, slot, platform);
CREATE INDEX IF NOT EXISTS idx_post_history_city_slot
  ON public.post_history (user_id, city, slot, platform, status);

-- Fix 3: publish_locks table
CREATE TABLE IF NOT EXISTS public.publish_locks (
  user_id uuid NOT NULL,
  city_id uuid NOT NULL,
  slot text NOT NULL,
  platform text NOT NULL,
  local_date date NOT NULL,
  scheduled_post_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, city_id, slot, platform, local_date)
);

ALTER TABLE public.publish_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access publish_locks" ON public.publish_locks;
CREATE POLICY "Service role full access publish_locks"
  ON public.publish_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Users read own publish_locks" ON public.publish_locks;
CREATE POLICY "Users read own publish_locks"
  ON public.publish_locks
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Helper: resolve timezone for a city (automations.timezone -> weather_settings.timezone -> UTC)
CREATE OR REPLACE FUNCTION public.resolve_city_timezone(p_user uuid, p_city_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT timezone INTO v_tz
    FROM public.automations
   WHERE user_id = p_user AND city_id = p_city_id
   LIMIT 1;
  IF v_tz IS NOT NULL AND length(v_tz) > 0 THEN
    RETURN v_tz;
  END IF;

  SELECT timezone INTO v_tz
    FROM public.weather_settings
   WHERE user_id = p_user
   LIMIT 1;
  IF v_tz IS NOT NULL AND length(v_tz) > 0 THEN
    RETURN v_tz;
  END IF;

  RETURN 'UTC';
END;
$$;

-- check_publish_lock: read-only — returns true if lock available, false if held/already posted
CREATE OR REPLACE FUNCTION public.check_publish_lock(
  p_user uuid,
  p_city_id uuid,
  p_slot text,
  p_platform text,
  p_tz text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_local_date date;
BEGIN
  v_tz := COALESCE(p_tz, public.resolve_city_timezone(p_user, p_city_id), 'UTC');
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  IF EXISTS (
    SELECT 1 FROM public.publish_locks
     WHERE user_id = p_user AND city_id = p_city_id
       AND slot = p_slot AND platform = p_platform
       AND local_date = v_local_date
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.post_history
     WHERE user_id = p_user
       AND city_id IS NOT DISTINCT FROM p_city_id
       AND slot = p_slot
       AND platform = p_platform
       AND status = 'success'
       AND (created_at AT TIME ZONE v_tz)::date = v_local_date
  ) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scheduled_posts
     WHERE user_id = p_user
       AND city_id = p_city_id
       AND slot = p_slot
       AND platform = p_platform
       AND status IN ('posted', 'processing')
       AND (COALESCE(scheduled_at, created_at) AT TIME ZONE v_tz)::date = v_local_date
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- acquire_publish_lock: atomic. Inserts lock row if available; returns true if acquired.
CREATE OR REPLACE FUNCTION public.acquire_publish_lock(
  p_user uuid,
  p_city_id uuid,
  p_slot text,
  p_platform text,
  p_tz text DEFAULT NULL,
  p_scheduled_post_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_local_date date;
  v_inserted integer;
BEGIN
  v_tz := COALESCE(p_tz, public.resolve_city_timezone(p_user, p_city_id), 'UTC');
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  -- Block if an already-successful post exists today for this key
  IF EXISTS (
    SELECT 1 FROM public.post_history
     WHERE user_id = p_user
       AND city_id IS NOT DISTINCT FROM p_city_id
       AND slot = p_slot
       AND platform = p_platform
       AND status = 'success'
       AND (created_at AT TIME ZONE v_tz)::date = v_local_date
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.publish_locks (user_id, city_id, slot, platform, local_date, scheduled_post_id)
       VALUES (p_user, p_city_id, p_slot, p_platform, v_local_date, p_scheduled_post_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN v_inserted > 0;
END;
$$;

-- release_publish_lock: delete the lock row for today (called on publish failure)
CREATE OR REPLACE FUNCTION public.release_publish_lock(
  p_user uuid,
  p_city_id uuid,
  p_slot text,
  p_platform text,
  p_tz text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_local_date date;
BEGIN
  v_tz := COALESCE(p_tz, public.resolve_city_timezone(p_user, p_city_id), 'UTC');
  v_local_date := (now() AT TIME ZONE v_tz)::date;

  DELETE FROM public.publish_locks
   WHERE user_id = p_user
     AND city_id = p_city_id
     AND slot = p_slot
     AND platform = p_platform
     AND local_date = v_local_date;
END;
$$;