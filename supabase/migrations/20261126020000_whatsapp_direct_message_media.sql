-- Attachments for one-to-one WhatsApp messages.
--
-- The existing `mena_whatsapp_message_media` table is keyed by group identity,
-- so direct messages can never appear there. This table reuses the same
-- storage/signing primitives but keys the attachment by the direct message
-- and its provider id. No binary is stored in PostgreSQL; the file lives in
-- the existing WhatsApp media storage (Supabase Storage or local disk).

CREATE TABLE public.mena_whatsapp_direct_message_media (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  direct_message_id text NOT NULL
    REFERENCES public.mena_whatsapp_direct_messages(id) ON DELETE CASCADE,
  provider_message_id text,
  remote_jid_hash text NOT NULL CHECK (remote_jid_hash ~ '^[0-9a-f]{64}$'),
  media_index integer NOT NULL DEFAULT 0 CHECK (media_index >= 0),
  media_type text NOT NULL,
  mime_type text,
  file_name text,
  size_bytes integer,
  source_url text,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sha256 text,
  storage_key text,
  storage_path text,
  storage_provider text NOT NULL DEFAULT 'local',
  thumbnail_path text,
  download_status text NOT NULL DEFAULT 'pending'
    CHECK (download_status IN ('pending', 'stored', 'failed')),
  error_code text,
  download_attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_direct_media_connection_fk
    FOREIGN KEY (workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_connections (workspace_id, instance_name)
    ON DELETE CASCADE
);

-- One row per provider message + attachment. Repeated webhook deliveries of
-- the same message must not create a second row or a second download.
CREATE UNIQUE INDEX mena_whatsapp_direct_media_provider_key
  ON public.mena_whatsapp_direct_message_media
    (workspace_id, instance_name, remote_jid_hash, provider_message_id,
     media_index, media_type)
  WHERE provider_message_id IS NOT NULL;

CREATE UNIQUE INDEX mena_whatsapp_direct_media_message_key
  ON public.mena_whatsapp_direct_message_media
    (direct_message_id, media_index, media_type);

CREATE INDEX mena_whatsapp_direct_media_conversation_idx
  ON public.mena_whatsapp_direct_message_media
    (workspace_id, instance_name, remote_jid_hash, created_at);

CREATE INDEX mena_whatsapp_direct_media_retry_idx
  ON public.mena_whatsapp_direct_message_media
    (workspace_id, download_status, next_attempt_at);

ALTER TABLE public.mena_whatsapp_direct_message_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_direct_message_media FROM anon, authenticated;
