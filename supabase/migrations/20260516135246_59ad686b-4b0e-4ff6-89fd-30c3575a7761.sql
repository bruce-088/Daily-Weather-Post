REVOKE EXECUTE ON FUNCTION public.resolve_city_timezone(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_publish_lock(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.acquire_publish_lock(uuid, uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_publish_lock(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_city_timezone(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.check_publish_lock(uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_publish_lock(uuid, uuid, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_publish_lock(uuid, uuid, text, text, text) TO service_role;