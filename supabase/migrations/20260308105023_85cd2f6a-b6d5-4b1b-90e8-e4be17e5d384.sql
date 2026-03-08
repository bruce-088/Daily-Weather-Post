-- Create bucket for generated weather images
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-images', 'generated-images', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: Users can only access their own images
CREATE POLICY "Users can read own generated images"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can insert own generated images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete own generated images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'generated-images' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Service role can access all for edge functions
CREATE POLICY "Service role full access generated images"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'generated-images')
WITH CHECK (bucket_id = 'generated-images');