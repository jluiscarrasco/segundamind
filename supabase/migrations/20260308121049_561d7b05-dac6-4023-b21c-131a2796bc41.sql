
CREATE TABLE public.allowed_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.allowed_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read allowed_emails"
  ON public.allowed_emails
  FOR SELECT
  TO authenticated
  USING (true);

INSERT INTO public.allowed_emails (email) VALUES
  ('jamwix@gmail.com'),
  ('jluis.carrasco@gmail.com'),
  ('clarevion@gmail.com'),
  ('jlcarras@its.jnj.com');
