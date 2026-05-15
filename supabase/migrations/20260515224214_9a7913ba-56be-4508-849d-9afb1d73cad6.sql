CREATE POLICY "Users can update their own weather videos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'weather-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'weather-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);