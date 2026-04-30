REVOKE EXECUTE ON FUNCTION public.claim_next_jobs(text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recover_stuck_jobs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_job(uuid, text, jsonb, uuid, uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;