CREATE TABLE public.oauth_codes (
  code text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  scope text,
  resource text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.oauth_codes ENABLE ROW LEVEL SECURITY;

-- No client policies: only service role (used by edge function) reads/writes.
CREATE INDEX idx_oauth_codes_expires ON public.oauth_codes(expires_at);

-- Allow distinguishing OAuth-issued tokens (optional metadata column)
ALTER TABLE public.api_tokens ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.api_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;