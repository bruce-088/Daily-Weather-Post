INSERT INTO storage.buckets (id, name, public)
VALUES ('weather-videos', 'weather-videos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can read own videos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'weather-videos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Service role can insert videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'weather-videos');

CREATE POLICY "Service role can delete videos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'weather-videos' AND (storage.foldername(name))[1] = auth.uid()::text);