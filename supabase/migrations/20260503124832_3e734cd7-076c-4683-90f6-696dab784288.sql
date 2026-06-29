CREATE TABLE public.user_file_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  file_id uuid NOT NULL REFERENCES public.user_files(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('area','project','task')),
  entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, entity_type, entity_id)
);

CREATE INDEX idx_user_file_links_entity ON public.user_file_links (user_id, entity_type, entity_id);
CREATE INDEX idx_user_file_links_file ON public.user_file_links (file_id);

ALTER TABLE public.user_file_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own file links"
ON public.user_file_links
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);