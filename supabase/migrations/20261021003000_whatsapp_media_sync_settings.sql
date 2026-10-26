ALTER TABLE public.mena_whatsapp_connections
  ADD COLUMN sync_messages_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN sync_images_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN sync_videos_enabled boolean NOT NULL DEFAULT true;
