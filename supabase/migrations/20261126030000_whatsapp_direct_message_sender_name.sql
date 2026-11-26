-- The DM inbox already keys one row per provider message. Evolution sends the
-- customer's display name as `pushName` (or `senderName`), and the group
-- messages table already calls that value `sender_name`. Reuse the same column
-- name here so the list and the chat header can show a contact name while the
-- phone-based conversation identity remains completely unchanged.

ALTER TABLE public.mena_whatsapp_direct_messages
  ADD COLUMN sender_name text;

-- Explicit no-op grant: the table stays RLS-protected and revoked from public
-- roles; application code reaches it through the existing service role path.
REVOKE ALL ON TABLE public.mena_whatsapp_direct_messages FROM anon, authenticated;
