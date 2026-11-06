ALTER TABLE public.mena_meta_inbox_items
  ADD COLUMN reply_status text
    CHECK (reply_status IN ('sending', 'unknown')),
  ADD COLUMN reply_attempt_started_at timestamptz;
