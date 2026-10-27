DELETE FROM public.mena_whatsapp_message_media
WHERE group_jid ~ '^[0-9]{5,20}@s[.]whatsapp[.]net$';

DELETE FROM public.mena_whatsapp_messages
WHERE group_jid ~ '^[0-9]{5,20}@s[.]whatsapp[.]net$'
  AND source = 'webhook';

DROP TABLE IF EXISTS public.mena_whatsapp_campaign_recipients;
DROP TABLE IF EXISTS public.mena_whatsapp_campaigns;
DROP TABLE IF EXISTS public.mena_whatsapp_customer_consents;
DROP TABLE IF EXISTS public.mena_whatsapp_outbound_messages;
