-- Allow authenticated users to insert new cities (shared lookup table)
CREATE POLICY "Authenticated can insert cities"
ON public.cities
FOR INSERT
TO authenticated
WITH CHECK (true);