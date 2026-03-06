
-- Add user_id to weather_settings
ALTER TABLE public.weather_settings ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add user_id to post_history
ALTER TABLE public.post_history ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Drop old permissive policies on weather_settings
DROP POLICY IF EXISTS "Allow public read weather_settings" ON public.weather_settings;
DROP POLICY IF EXISTS "Allow public insert weather_settings" ON public.weather_settings;
DROP POLICY IF EXISTS "Allow public update weather_settings" ON public.weather_settings;

-- Drop old permissive policies on post_history
DROP POLICY IF EXISTS "Allow public read post_history" ON public.post_history;
DROP POLICY IF EXISTS "Allow public insert post_history" ON public.post_history;
DROP POLICY IF EXISTS "Allow public update post_history" ON public.post_history;

-- New RLS policies for weather_settings scoped to authenticated user
CREATE POLICY "Users can read own settings"
  ON public.weather_settings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own settings"
  ON public.weather_settings FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own settings"
  ON public.weather_settings FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- New RLS policies for post_history scoped to authenticated user
CREATE POLICY "Users can read own posts"
  ON public.post_history FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own posts"
  ON public.post_history FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Allow service_role full access for edge functions
CREATE POLICY "Service role full access settings"
  ON public.weather_settings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role full access history"
  ON public.post_history FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
