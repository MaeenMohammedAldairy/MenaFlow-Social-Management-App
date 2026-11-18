ALTER TABLE public.mena_whatsapp_direct_messages
  ADD COLUMN message_type text NOT NULL DEFAULT 'text'
  CHECK (message_type IN (
    'text',
    'image',
    'video',
    'audio',
    'document',
    'sticker',
    'album',
    'location',
    'contact',
    'unknown'
  ));
