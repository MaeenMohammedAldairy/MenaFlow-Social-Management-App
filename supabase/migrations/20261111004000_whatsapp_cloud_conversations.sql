CREATE TABLE public.mena_whatsapp_cloud_conversations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  connection_id text NOT NULL,
  messaging_account_id text NOT NULL,
  phone_number_id text NOT NULL,
  customer_wa_id text NOT NULL,
  customer_name text,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_direction text
    CHECK (last_message_direction IS NULL OR last_message_direction IN ('inbound', 'outbound')),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_conversations_connection_fk
    FOREIGN KEY (workspace_id, environment, connection_id)
    REFERENCES public.mena_whatsapp_cloud_connections
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_conversations_account_phone_fk
    FOREIGN KEY (
      workspace_id,
      environment,
      messaging_account_id,
      phone_number_id
    )
    REFERENCES public.mena_whatsapp_cloud_messaging_account_phone_numbers
      (workspace_id, environment, messaging_account_id, phone_number_id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_conversations_workspace_env_id_key
    UNIQUE (workspace_id, environment, id),
  CONSTRAINT mena_whatsapp_cloud_conversations_customer_key
    UNIQUE (workspace_id, environment, phone_number_id, customer_wa_id)
);

CREATE INDEX mena_whatsapp_cloud_conversations_workspace_updated_idx
  ON public.mena_whatsapp_cloud_conversations (workspace_id, updated_at);

CREATE TABLE public.mena_whatsapp_cloud_messages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('test', 'production')),
  conversation_id text NOT NULL,
  meta_message_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type text NOT NULL,
  text_body text,
  media jsonb NOT NULL DEFAULT '[]'::jsonb,
  reply_to_meta_message_id text,
  status text NOT NULL
    CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed', 'unknown')),
  status_at timestamptz,
  message_at timestamptz NOT NULL,
  status_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_cloud_messages_conversation_fk
    FOREIGN KEY (workspace_id, environment, conversation_id)
    REFERENCES public.mena_whatsapp_cloud_conversations
      (workspace_id, environment, id)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_cloud_messages_environment_meta_id_key
    UNIQUE (environment, meta_message_id)
);

CREATE INDEX mena_whatsapp_cloud_messages_conversation_time_idx
  ON public.mena_whatsapp_cloud_messages
    (workspace_id, environment, conversation_id, message_at);

ALTER TABLE public.mena_whatsapp_cloud_conversations
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_cloud_messages
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.mena_whatsapp_cloud_conversations,
  public.mena_whatsapp_cloud_messages
FROM anon, authenticated;
