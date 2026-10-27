CREATE TABLE public.mena_meta_auto_reply_settings (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  facebook_messages_enabled boolean NOT NULL DEFAULT false,
  facebook_comments_enabled boolean NOT NULL DEFAULT false,
  instagram_messages_enabled boolean NOT NULL DEFAULT false,
  instagram_comments_enabled boolean NOT NULL DEFAULT false,
  language text NOT NULL DEFAULT 'ar' CHECK (language IN ('ar', 'match_customer')),
  tone text NOT NULL DEFAULT 'friendly_professional'
    CHECK (tone IN ('friendly_professional', 'concise', 'formal')),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_meta_auto_reply_settings_workspace_key
    UNIQUE (workspace_id)
);

ALTER TABLE public.mena_meta_auto_reply_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_meta_auto_reply_settings FROM anon, authenticated;

CREATE TABLE public.mena_meta_auto_reply_jobs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  inbox_item_id text NOT NULL REFERENCES public.mena_meta_inbox_items(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'sending', 'sent', 'failed', 'skipped', 'unknown')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 3),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT mena_meta_auto_reply_jobs_workspace_item_key
    UNIQUE (workspace_id, inbox_item_id)
);

CREATE INDEX mena_meta_auto_reply_jobs_pending_idx
  ON public.mena_meta_auto_reply_jobs (status, next_run_at);
CREATE INDEX mena_meta_auto_reply_jobs_lease_idx
  ON public.mena_meta_auto_reply_jobs (status, lease_expires_at);

ALTER TABLE public.mena_meta_auto_reply_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_meta_auto_reply_jobs FROM anon, authenticated;
