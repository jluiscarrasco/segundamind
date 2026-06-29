-- user_folders
CREATE TABLE public.user_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  parent_id UUID REFERENCES public.user_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own folders"
ON public.user_folders
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_user_folders_user_parent ON public.user_folders(user_id, parent_id);

CREATE TRIGGER update_user_folders_updated_at
BEFORE UPDATE ON public.user_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- user_files
CREATE TABLE public.user_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  folder_id UUID REFERENCES public.user_folders(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.user_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own files"
ON public.user_files
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_user_files_user_folder ON public.user_files(user_id, folder_id);

CREATE TRIGGER update_user_files_updated_at
BEFORE UPDATE ON public.user_files
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- user_file_tags
CREATE TABLE public.user_file_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  file_id UUID NOT NULL REFERENCES public.user_files(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (file_id, tag)
);

ALTER TABLE public.user_file_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own file tags"
ON public.user_file_tags
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_user_file_tags_user_file ON public.user_file_tags(user_id, file_id);
CREATE INDEX idx_user_file_tags_user_tag ON public.user_file_tags(user_id, tag);

-- Recursive folder delete function
CREATE OR REPLACE FUNCTION public.delete_folder_recursive(_folder_id UUID)
RETURNS SETOF TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _owner UUID;
  _path TEXT;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT user_id INTO _owner FROM public.user_folders WHERE id = _folder_id;
  IF _owner IS NULL THEN
    RETURN;
  END IF;
  IF _owner <> _uid THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Collect all descendant folder ids (including self)
  WITH RECURSIVE descendants AS (
    SELECT id FROM public.user_folders WHERE id = _folder_id AND user_id = _uid
    UNION ALL
    SELECT f.id FROM public.user_folders f
    INNER JOIN descendants d ON f.parent_id = d.id
    WHERE f.user_id = _uid
  )
  SELECT storage_path FROM public.user_files
  WHERE user_id = _uid AND folder_id IN (SELECT id FROM descendants)
  INTO _path;

  -- Return all storage paths to be deleted by the client
  RETURN QUERY
  WITH RECURSIVE descendants AS (
    SELECT id FROM public.user_folders WHERE id = _folder_id AND user_id = _uid
    UNION ALL
    SELECT f.id FROM public.user_folders f
    INNER JOIN descendants d ON f.parent_id = d.id
    WHERE f.user_id = _uid
  )
  SELECT storage_path FROM public.user_files
  WHERE user_id = _uid AND folder_id IN (SELECT id FROM descendants);

  -- Delete files rows
  WITH RECURSIVE descendants AS (
    SELECT id FROM public.user_folders WHERE id = _folder_id AND user_id = _uid
    UNION ALL
    SELECT f.id FROM public.user_folders f
    INNER JOIN descendants d ON f.parent_id = d.id
    WHERE f.user_id = _uid
  )
  DELETE FROM public.user_files
  WHERE user_id = _uid AND folder_id IN (SELECT id FROM descendants);

  -- Delete folder (cascade will remove subfolders)
  DELETE FROM public.user_folders WHERE id = _folder_id AND user_id = _uid;
END;
$$;

-- Anti-cycle check when moving folders
CREATE OR REPLACE FUNCTION public.check_folder_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _current UUID;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A folder cannot be its own parent';
  END IF;

  _current := NEW.parent_id;
  WHILE _current IS NOT NULL LOOP
    IF _current = NEW.id THEN
      RAISE EXCEPTION 'Cycle detected in folder hierarchy';
    END IF;
    SELECT parent_id INTO _current FROM public.user_folders WHERE id = _current;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_folders_cycle_check
BEFORE INSERT OR UPDATE ON public.user_folders
FOR EACH ROW EXECUTE FUNCTION public.check_folder_cycle();