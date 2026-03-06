
-- Create scheduled_posts table
CREATE TABLE public.scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  city text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  platform text NOT NULL DEFAULT 'both',
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_posts ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can read own scheduled posts"
  ON public.scheduled_posts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own scheduled posts"
  ON public.scheduled_posts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own scheduled posts"
  ON public.scheduled_posts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access scheduled posts"
  ON public.scheduled_posts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Validation trigger: scheduled_at must be in the future on INSERT
CREATE OR REPLACE FUNCTION public.validate_scheduled_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.scheduled_at <= now() THEN
    RAISE EXCEPTION 'scheduled_at must be in the future';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_scheduled_at
  BEFORE INSERT ON public.scheduled_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_scheduled_at();
