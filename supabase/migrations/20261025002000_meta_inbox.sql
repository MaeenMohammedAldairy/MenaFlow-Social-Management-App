CREATE TABLE public.mena_meta_inbox_items (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  kind text NOT NULL CHECK (kind IN ('message', 'comment')),
  external_id text NOT NULL,
  conversation_id text NOT NULL,
  parent_id text,
  actor_id text,
  actor_name text,
  text text NOT NULL,
  occurred_at timestamptz NOT NULL,
  reply_text text,
  reply_external_id text,
  replied_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_meta_inbox_workspace_external_key
    UNIQUE (workspace_id, platform, external_id)
);

CREATE INDEX mena_meta_inbox_workspace_time_idx
  ON public.mena_meta_inbox_items (workspace_id, occurred_at);

ALTER TABLE public.mena_meta_inbox_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_meta_inbox_items FROM anon, authenticated;

CREATE TABLE public.mena_meta_webhook_subscriptions (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  account_id text NOT NULL,
  subscribed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  subscribed_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_meta_webhook_subscriptions_workspace_platform_key
    UNIQUE (workspace_id, platform)
);

ALTER TABLE public.mena_meta_webhook_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_meta_webhook_subscriptions FROM anon, authenticated;
