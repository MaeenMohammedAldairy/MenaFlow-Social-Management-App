# WhatsApp group sync

The WhatsApp sync settings let each workspace independently enable automatic
sync and select messages, images, and videos. Manual history sync imports only
the selected content types from selected groups. Text and media captions follow
the messages setting; image and video attachments follow their respective
settings. Audio and document attachments follow the messages setting.
Group send permissions do not prevent syncing messages or creating reviewable
content from a selected group.
Historical lookup checks both the primary and alternate WhatsApp group JIDs
because newer WhatsApp addressing may store a participant LID as the primary
JID while preserving the group JID as the alternate JID.

All content sync settings default to enabled to preserve existing behavior.
Changing a setting affects new imports and pending media retries; it does not
delete previously stored messages or media.

Apply `supabase/migrations/20261021003000_whatsapp_media_sync_settings.sql`
before deploying the WhatsApp sync content filters.

Newly created Evolution instances request `syncFullHistory` so WhatsApp can
send available initial history to Evolution. This is an instance-wide provider
setting; MenaFlow still imports only explicitly selected groups. Existing
instances keep their current Evolution setting and need to be reconnected or
re-paired for full-history sync to take effect. Evolution may not be able to
backfill messages that WhatsApp does not resend.
