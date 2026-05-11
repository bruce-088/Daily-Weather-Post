ALTER TABLE public.weather_settings ALTER COLUMN use_jobs_pipeline SET DEFAULT true;
UPDATE public.weather_settings SET use_jobs_pipeline = true WHERE use_jobs_pipeline = false;