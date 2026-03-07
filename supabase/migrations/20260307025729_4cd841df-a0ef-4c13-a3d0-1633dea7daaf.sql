ALTER TABLE public.weather_settings
  ADD COLUMN morning_post_time time without time zone NOT NULL DEFAULT '07:00:00',
  ADD COLUMN afternoon_post_time time without time zone NOT NULL DEFAULT '13:00:00',
  ADD COLUMN evening_post_time time without time zone NOT NULL DEFAULT '18:00:00',
  ADD COLUMN auto_post_morning boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_post_afternoon boolean NOT NULL DEFAULT true,
  ADD COLUMN auto_post_evening boolean NOT NULL DEFAULT true;