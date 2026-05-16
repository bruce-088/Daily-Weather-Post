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

  -- Safety: block if another scheduled_post already succeeded today for this key
  IF EXISTS (
    SELECT 1 FROM public.scheduled_posts
     WHERE user_id = p_user
       AND city_id = p_city_id
       AND slot = p_slot
       AND platform = p_platform
       AND status = 'posted'
       AND (COALESCE(scheduled_at, created_at) AT TIME ZONE v_tz)::date = v_local_date
       AND (p_scheduled_post_id IS NULL OR id <> p_scheduled_post_id)
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

REVOKE EXECUTE ON FUNCTION public.check_publish_lock(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acquire_publish_lock(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_publish_lock(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_publish_lock(uuid, uuid, text, text, text, uuid) TO service_role;