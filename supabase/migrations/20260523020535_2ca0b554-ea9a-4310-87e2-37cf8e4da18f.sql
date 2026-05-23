ALTER TABLE public.post_history DROP CONSTRAINT IF EXISTS post_history_status_check;
ALTER TABLE public.post_history ADD CONSTRAINT post_history_status_check
  CHECK (status = ANY (ARRAY['success'::text, 'failed'::text, 'pending'::text, 'validation_failed'::text]));