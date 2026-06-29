
-- Create a trigger function to enforce email whitelist on signup
CREATE OR REPLACE FUNCTION public.enforce_email_whitelist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_email_allowed(NEW.email) THEN
    RAISE EXCEPTION 'Email not authorized for registration';
  END IF;
  RETURN NEW;
END;
$$;

-- Attach the trigger to auth.users so it fires before insert
CREATE TRIGGER check_email_whitelist
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_email_whitelist();
