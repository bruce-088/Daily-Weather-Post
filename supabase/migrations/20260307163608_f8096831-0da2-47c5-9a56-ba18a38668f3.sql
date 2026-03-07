-- Make weather-videos bucket private
UPDATE storage.buckets SET public = false WHERE id = 'weather-videos';

-- Create a separate public bucket for brand assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read brand assets
CREATE POLICY "Public read access for brand assets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'brand-assets');

-- Allow service role to read all videos (for edge functions)
CREATE POLICY "Service role can read all videos"
ON storage.objects FOR SELECT
TO service_role
USING (bucket_id = 'weather-videos');