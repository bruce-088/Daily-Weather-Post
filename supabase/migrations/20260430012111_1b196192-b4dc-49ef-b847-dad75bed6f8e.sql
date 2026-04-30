CREATE TABLE IF NOT EXISTS public.weather_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  city TEXT NOT NULL,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  payload JSONB NOT NULL,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- One cache row per (city, state, country). Use COALESCE because state can be NULL.
CREATE UNIQUE INDEX IF NOT EXISTS weather_cache_location_unique_idx
  ON public.weather_cache (lower(city), lower(COALESCE(state, '')), lower(country));

CREATE INDEX IF NOT EXISTS weather_cache_fetched_at_idx
  ON public.weather_cache (fetched_at DESC);

ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access weather_cache"
  ON public.weather_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can read weather_cache"
  ON public.weather_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_weather_cache_updated_at
  BEFORE UPDATE ON public.weather_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();