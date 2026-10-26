ALTER TABLE public.mena_whatsapp_connections
  ADD COLUMN auto_reply_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_reply_language text NOT NULL DEFAULT 'ar',
  ADD COLUMN auto_reply_tone text NOT NULL DEFAULT 'friendly_professional',
  ADD COLUMN auto_reply_instructions text,
  ADD COLUMN auto_reply_tested_hash text;

CREATE TABLE public.mena_whatsapp_auto_reply_events (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  remote_message_id text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  reply_message_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE UNIQUE INDEX mena_whatsapp_auto_reply_events_message_key
  ON public.mena_whatsapp_auto_reply_events (workspace_id, instance_name, remote_message_id);

ALTER TABLE public.mena_whatsapp_auto_reply_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_auto_reply_events FROM anon, authenticated;
