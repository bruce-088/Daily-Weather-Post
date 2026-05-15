-- Rename misleading DELETE policy on weather-videos and split into two:
-- 1) authenticated users can delete only their own folder
-- 2) service_role can delete anything in the bucket
DROP POLICY IF EXISTS "Service role can delete videos" ON storage.objects;

CREATE POLICY "Users can delete own videos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'weather-videos'
  AND (storage.foldername(name))[1] = (auth.uid())::text
);

CREATE POLICY "Service role can delete any video"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'weather-videos');

-- Explicit deny for authenticated INSERT into the public skybrief-media bucket.
-- Uploads must go through the service_role client (edge functions).
DROP POLICY IF EXISTS "Deny authenticated insert skybrief-media" ON storage.objects;
CREATE POLICY "Deny authenticated insert skybrief-media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id <> 'skybrief-media');
