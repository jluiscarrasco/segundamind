REVOKE EXECUTE ON FUNCTION public.is_email_allowed(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_email_whitelist() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_folder_recursive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_folder_recursive(uuid) TO authenticated;