CREATE TABLE public.mena_whatsapp_cloud_connections (
  id text PRIMARY KEY,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  environment text NOT NULL
    CHECK (environment IN ('test', 'production')),
  onboarding_method text NOT NULL
    CHECK (onboarding_method IN ('developer_test', 'embedded_signup_v4')),
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'reauthorization_required', 'disconnected', 'failed')),
  created_by text NOT NULL,
  last_checked_at timestamptz,
  last_check_status text
    CHECK (last_check_status IS NULL OR last_check_status IN ('passed', 'failed')),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_connections_workspace_id_key
    UNIQUE (workspace_id, id),
  CONSTRAINT mena_whatsapp_cloud_connections_workspace_env_id_key
    UNIQUE (workspace_id, environment, id)
);

CREATE INDEX mena_whatsapp_cloud_connections_workspace_status_idx
  ON public.mena_whatsapp_cloud_connections (workspace_id, status);

CREATE TABLE public.mena_whatsapp_cloud_credentials (
  workspace_id text NOT NULL,
  connection_id text NOT NULL,
  encrypted_access_token text NOT NULL,
  access_token_expires_at timestamptz,
  granted_permissions text[] NOT NULL DEFAULT '{}',
  permissions_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_credentials_pkey
    PRIMARY KEY (workspace_id, connection_id),
  CONSTRAINT mena_whatsapp_cloud_credentials_connection_fk
    FOREIGN KEY (workspace_id, connection_id)
    REFERENCES public.mena_whatsapp_cloud_connections (workspace_id, id)
    ON DELETE CASCADE
);

CREATE TABLE public.mena_whatsapp_cloud_accounts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  connection_id text NOT NULL,
  meta_waac_id text,
  business_display_name text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_accounts_connection_fk
    FOREIGN KEY (workspace_id, environment, connection_id)
    REFERENCES public.mena_whatsapp_cloud_connections
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_accounts_workspace_env_id_key
    UNIQUE (workspace_id, environment, id)
);

CREATE UNIQUE INDEX mena_whatsapp_cloud_accounts_env_waac_key
  ON public.mena_whatsapp_cloud_accounts (environment, meta_waac_id)
  WHERE meta_waac_id IS NOT NULL;
CREATE INDEX mena_whatsapp_cloud_accounts_workspace_connection_idx
  ON public.mena_whatsapp_cloud_accounts (workspace_id, connection_id);

CREATE TABLE public.mena_whatsapp_cloud_messaging_accounts (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  connection_id text NOT NULL,
  whatsapp_account_id text,
  meta_messaging_account_id text NOT NULL,
  display_name text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_messaging_accounts_connection_fk
    FOREIGN KEY (workspace_id, environment, connection_id)
    REFERENCES public.mena_whatsapp_cloud_connections
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_messaging_accounts_waac_fk
    FOREIGN KEY (workspace_id, environment, whatsapp_account_id)
    REFERENCES public.mena_whatsapp_cloud_accounts
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_messaging_accounts_workspace_env_id_key
    UNIQUE (workspace_id, environment, id),
  CONSTRAINT mena_whatsapp_cloud_messaging_accounts_env_meta_id_key
    UNIQUE (environment, meta_messaging_account_id)
);

CREATE INDEX mena_whatsapp_cloud_messaging_accounts_workspace_connection_idx
  ON public.mena_whatsapp_cloud_messaging_accounts
    (workspace_id, connection_id);

CREATE TABLE public.mena_whatsapp_cloud_phone_numbers (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  whatsapp_account_id text,
  meta_phone_number_id text NOT NULL,
  phone_number text NOT NULL,
  verified_name text,
  code_verification_status text,
  registration_status text,
  quality_rating text,
  platform_type text,
  observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_phone_numbers_waac_fk
    FOREIGN KEY (workspace_id, environment, whatsapp_account_id)
    REFERENCES public.mena_whatsapp_cloud_accounts
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_phone_numbers_workspace_env_id_key
    UNIQUE (workspace_id, environment, id),
  CONSTRAINT mena_whatsapp_cloud_phone_numbers_env_meta_id_key
    UNIQUE (environment, meta_phone_number_id)
);

CREATE INDEX mena_whatsapp_cloud_phone_numbers_workspace_idx
  ON public.mena_whatsapp_cloud_phone_numbers (workspace_id, environment);

CREATE TABLE public.mena_whatsapp_cloud_messaging_account_phone_numbers (
  workspace_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  messaging_account_id text NOT NULL,
  phone_number_id text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_account_phone_numbers_pair_key
    UNIQUE (workspace_id, environment, messaging_account_id, phone_number_id),
  CONSTRAINT mena_whatsapp_cloud_account_phone_numbers_messaging_fk
    FOREIGN KEY (workspace_id, environment, messaging_account_id)
    REFERENCES public.mena_whatsapp_cloud_messaging_accounts
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_account_phone_numbers_phone_fk
    FOREIGN KEY (workspace_id, environment, phone_number_id)
    REFERENCES public.mena_whatsapp_cloud_phone_numbers
      (workspace_id, environment, id)
    ON DELETE CASCADE
);

ALTER TABLE public.mena_whatsapp_cloud_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_cloud_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_cloud_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_cloud_messaging_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_cloud_phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_cloud_messaging_account_phone_numbers
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.mena_whatsapp_cloud_connections,
  public.mena_whatsapp_cloud_credentials,
  public.mena_whatsapp_cloud_accounts,
  public.mena_whatsapp_cloud_messaging_accounts,
  public.mena_whatsapp_cloud_phone_numbers,
  public.mena_whatsapp_cloud_messaging_account_phone_numbers
FROM anon, authenticated;
