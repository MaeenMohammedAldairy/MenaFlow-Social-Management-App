-- Push notification delivery for the merchant app.
--
-- Tokens are keyed by user, not by membership: a merchant in three workspaces
-- still carries one phone, and storing the token per membership would send the
-- same alert three times. Recipients are resolved through
-- mena_workspace_members at send time.
--
-- The outbox mirrors the queue columns already proven on mena_orders for Meta
-- order confirmations (status / attempts / next_run_at / lease_expires_at),
-- including the `unknown` state: an expired `sending` lease means the Expo
-- request may have been delivered, so it must never be retried blindly.

CREATE TABLE public.mena_push_notification_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  token text NOT NULL,
  platform text NOT NULL,
  device_id text,
  enabled boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_push_notification_tokens_user_token_key UNIQUE (user_id, token),
  CONSTRAINT mena_push_notification_tokens_platform_check
    CHECK (platform IN ('ios', 'android', 'web'))
);

-- Lookups are by user (resolve recipients) and by (user, token) (re-register),
-- both served by the unique constraint above.
CREATE INDEX mena_push_notification_tokens_enabled_idx
  ON public.mena_push_notification_tokens (user_id)
  WHERE enabled;

CREATE TABLE public.mena_push_notification_outbox (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  recipient_user_id text,
  title text NOT NULL,
  body text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  sent_at timestamptz,
  recipient_count integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_push_notification_outbox_dedupe_key
    UNIQUE (workspace_id, event_type, dedupe_key),
  CONSTRAINT mena_push_notification_outbox_event_type_check
    CHECK (event_type IN (
      'customer_message',
      'publish_failure',
      'new_order',
      'quota_exhausted'
    )),
  CONSTRAINT mena_push_notification_outbox_status_check
    CHECK (status IN (
      'queued',
      'processing',
      'sending',
      'sent',
      'failed',
      'unknown'
    )),
  CONSTRAINT mena_push_notification_outbox_attempts_check CHECK (attempts >= 0),
  CONSTRAINT mena_push_notification_outbox_recipient_count_check
    CHECK (recipient_count >= 0)
);

CREATE INDEX mena_push_notification_outbox_queue_idx
  ON public.mena_push_notification_outbox (status, next_run_at)
  WHERE status IN ('queued', 'processing', 'sending');

CREATE INDEX mena_push_notification_outbox_workspace_time_idx
  ON public.mena_push_notification_outbox (workspace_id, created_at);
