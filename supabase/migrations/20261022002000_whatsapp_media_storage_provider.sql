ALTER TABLE public.mena_whatsapp_message_media
  ADD COLUMN IF NOT EXISTS storage_provider text NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS thumbnail_path text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-media', 'whatsapp-media', false)
ON CONFLICT (id) DO UPDATE
SET public = false;

CREATE INDEX IF NOT EXISTS mena_whatsapp_message_media_workspace_sha256_idx
  ON public.mena_whatsapp_message_media (workspace_id, sha256, download_status);
