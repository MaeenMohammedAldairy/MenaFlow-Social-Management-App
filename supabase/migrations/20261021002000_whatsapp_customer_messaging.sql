CREATE TABLE public.mena_whatsapp_outbound_messages (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  conversation_jid text NOT NULL,
  idempotency_key text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'accepted', 'failed', 'unknown')),
  external_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_outbound_workspace_idempotency_key
    UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX mena_whatsapp_outbound_conversation_idx
  ON public.mena_whatsapp_outbound_messages
    (workspace_id, instance_name, conversation_jid, created_at DESC);

ALTER TABLE public.mena_whatsapp_outbound_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_outbound_messages FROM anon, authenticated;
