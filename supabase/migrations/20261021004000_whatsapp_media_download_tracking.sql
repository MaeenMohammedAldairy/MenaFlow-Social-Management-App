ALTER TABLE public.mena_whatsapp_message_media
  ADD COLUMN IF NOT EXISTS download_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS mena_whatsapp_message_media_retry_idx
  ON public.mena_whatsapp_message_media (workspace_id, download_status, next_attempt_at);
