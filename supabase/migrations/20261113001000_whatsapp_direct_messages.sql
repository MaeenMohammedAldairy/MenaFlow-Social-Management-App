CREATE TABLE public.mena_whatsapp_direct_messages (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  remote_jid_hash text NOT NULL CHECK (remote_jid_hash ~ '^[0-9a-f]{64}$'),
  encrypted_remote_jid text NOT NULL,
  provider_message_id text,
  client_request_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'sending', 'sent', 'failed', 'unknown')),
  error_code text,
  encrypted_text_body text NOT NULL CHECK (length(encrypted_text_body) <= 6000),
  message_timestamp timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_direct_messages_connection_fk
    FOREIGN KEY (workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_connections (workspace_id, instance_name)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX mena_whatsapp_direct_messages_provider_id_key
  ON public.mena_whatsapp_direct_messages
    (workspace_id, instance_name, remote_jid_hash, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX mena_whatsapp_direct_messages_client_request_key
  ON public.mena_whatsapp_direct_messages
    (workspace_id, instance_name, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX mena_whatsapp_direct_messages_conversation_idx
  ON public.mena_whatsapp_direct_messages
    (workspace_id, instance_name, remote_jid_hash, message_timestamp DESC);

CREATE INDEX mena_whatsapp_direct_messages_expiry_idx
  ON public.mena_whatsapp_direct_messages (expires_at);

ALTER TABLE public.mena_whatsapp_direct_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_direct_messages FROM anon, authenticated;