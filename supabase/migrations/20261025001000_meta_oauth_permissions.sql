ALTER TABLE public.mena_meta_connections
  ADD COLUMN granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN authorization_verified_at timestamptz,
  ADD COLUMN access_token_expires_at timestamptz;

ALTER TABLE public.mena_oauth_states
  ADD COLUMN requested_integration text NOT NULL DEFAULT 'facebook',
  ADD CONSTRAINT mena_oauth_states_requested_integration_check
    CHECK (requested_integration IN ('facebook', 'instagram'));
