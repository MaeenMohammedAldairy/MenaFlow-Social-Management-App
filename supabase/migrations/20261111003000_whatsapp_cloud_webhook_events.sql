CREATE TABLE public.mena_whatsapp_cloud_webhook_events (
  id text PRIMARY KEY,
  event_key text NOT NULL,
  workspace_id text REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  connection_id text,
  meta_messaging_account_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'unmatched', 'processing', 'processed', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  last_error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT mena_whatsapp_cloud_webhook_events_event_key
    UNIQUE (event_key),
  CONSTRAINT mena_whatsapp_cloud_webhook_events_connection_scope_check
    CHECK (
      (workspace_id IS NULL AND connection_id IS NULL)
      OR (workspace_id IS NOT NULL AND connection_id IS NOT NULL)
    )
);

CREATE INDEX mena_whatsapp_cloud_webhook_events_pending_idx
  ON public.mena_whatsapp_cloud_webhook_events (status, next_attempt_at, received_at);
CREATE INDEX mena_whatsapp_cloud_webhook_events_workspace_received_idx
  ON public.mena_whatsapp_cloud_webhook_events (workspace_id, received_at);

ALTER TABLE public.mena_whatsapp_cloud_webhook_events
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mena_whatsapp_cloud_webhook_events
  FROM anon, authenticated;
