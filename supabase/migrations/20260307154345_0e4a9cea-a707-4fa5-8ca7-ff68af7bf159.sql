DROP POLICY IF EXISTS "Service role can insert videos" ON storage.objects;

CREATE POLICY "Users can insert own videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'weather-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);