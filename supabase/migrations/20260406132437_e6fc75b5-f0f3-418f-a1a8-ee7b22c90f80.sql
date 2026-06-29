
-- Remove public (unauthenticated) policies
DROP POLICY IF EXISTS "Allow public deletes from attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow public reads from attachments" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads to attachments" ON storage.objects;

-- Remove old authenticated policies (no ownership check)
DROP POLICY IF EXISTS "Auth users can delete own attachments" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can read own attachments" ON storage.objects;
DROP POLICY IF EXISTS "Auth users can upload to attachments" ON storage.objects;

-- Create new authenticated policies with ownership checks
CREATE POLICY "Auth users can read own attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Auth users can upload to attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Auth users can delete own attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'attachments' AND (storage.foldername(name))[1] = auth.uid()::text);
