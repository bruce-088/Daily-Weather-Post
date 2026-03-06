-- Create weather_settings table
CREATE TABLE public.weather_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  city TEXT NOT NULL DEFAULT 'San Francisco',
  openweather_api_key TEXT,
  instagram_api_key TEXT,
  tiktok_api_key TEXT,
  post_time TIME NOT NULL DEFAULT '08:00:00',
  auto_post BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.weather_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read weather_settings"
  ON public.weather_settings FOR SELECT USING (true);

CREATE POLICY "Allow public insert weather_settings"
  ON public.weather_settings FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update weather_settings"
  ON public.weather_settings FOR UPDATE USING (true);

-- Create post_history table
CREATE TABLE public.post_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('success', 'failed', 'pending')),
  platform TEXT CHECK (platform IN ('instagram', 'tiktok', 'both')),
  city TEXT NOT NULL,
  temperature NUMERIC,
  condition TEXT,
  image_url TEXT,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.post_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read post_history"
  ON public.post_history FOR SELECT USING (true);

CREATE POLICY "Allow public insert post_history"
  ON public.post_history FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update post_history"
  ON public.post_history FOR UPDATE USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_weather_settings_updated_at
  BEFORE UPDATE ON public.weather_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default settings row
INSERT INTO public.weather_settings (city, post_time) VALUES ('San Francisco', '08:00:00');