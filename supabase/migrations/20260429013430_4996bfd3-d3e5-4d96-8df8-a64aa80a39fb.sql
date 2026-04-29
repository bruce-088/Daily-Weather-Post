-- Repoint any user_cities and automations from the bare "Gainesville" (no state)
-- to the canonical "Gainesville, Florida" city, then delete the bare city row.

-- 1. Repoint user_cities (skip if user already has the FL one to avoid dup link)
UPDATE public.user_cities uc
SET city_id = 'cdd5253e-dbf0-4e59-b285-81afff111bad'
WHERE uc.city_id = '07f68d3e-3773-4b29-9905-f042f92f3866'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_cities uc2
    WHERE uc2.user_id = uc.user_id
      AND uc2.city_id = 'cdd5253e-dbf0-4e59-b285-81afff111bad'
  );

-- 2. Delete any leftover user_cities still pointing at bare row (means user already had FL)
DELETE FROM public.user_cities WHERE city_id = '07f68d3e-3773-4b29-9905-f042f92f3866';

-- 3. Repoint automations similarly
UPDATE public.automations a
SET city_id = 'cdd5253e-dbf0-4e59-b285-81afff111bad'
WHERE a.city_id = '07f68d3e-3773-4b29-9905-f042f92f3866'
  AND NOT EXISTS (
    SELECT 1 FROM public.automations a2
    WHERE a2.user_id = a.user_id
      AND a2.city_id = 'cdd5253e-dbf0-4e59-b285-81afff111bad'
  );

DELETE FROM public.automations WHERE city_id = '07f68d3e-3773-4b29-9905-f042f92f3866';

-- 4. Repoint scheduled_posts
UPDATE public.scheduled_posts SET city_id = 'cdd5253e-dbf0-4e59-b285-81afff111bad'
WHERE city_id = '07f68d3e-3773-4b29-9905-f042f92f3866';

-- 5. Delete the bare duplicate city row
DELETE FROM public.cities WHERE id = '07f68d3e-3773-4b29-9905-f042f92f3866';

-- 6. Prevent future duplicates: enforce unique (lower(name), coalesce(lower(state),''), country)
CREATE UNIQUE INDEX IF NOT EXISTS cities_unique_name_state_country
  ON public.cities (lower(name), lower(coalesce(state, '')), country);
