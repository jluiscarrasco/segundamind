-- Secure whitelist access for signup checks without exposing the email list
DROP POLICY IF EXISTS "Allow authenticated users to read allowed_emails" ON public.allowed_emails;

CREATE POLICY "No direct reads from clients"
ON public.allowed_emails
FOR SELECT
USING (false);

CREATE OR REPLACE FUNCTION public.is_email_allowed(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.allowed_emails
    WHERE lower(email) = lower(trim(_email))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_email_allowed(text) TO anon, authenticated;