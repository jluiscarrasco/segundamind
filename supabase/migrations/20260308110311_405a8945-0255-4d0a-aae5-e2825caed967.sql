
-- Create a public storage bucket for temporary attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', true);

-- Allow anyone to upload to the attachments bucket (no auth required for this app)
CREATE POLICY "Allow public uploads to attachments" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'attachments');

-- Allow anyone to read from attachments bucket
CREATE POLICY "Allow public reads from attachments" ON storage.objects
  FOR SELECT USING (bucket_id = 'attachments');

-- Allow anyone to delete from attachments bucket
CREATE POLICY "Allow public deletes from attachments" ON storage.objects
  FOR DELETE USING (bucket_id = 'attachments');
