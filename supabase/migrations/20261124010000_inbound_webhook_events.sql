-- Inbound webhook delivery log.
--
-- "No customer messages are arriving" has two causes that look identical in the
-- app: the provider never called, or it called and the call was rejected (a
-- rotated secret, an unknown instance, a missing signature). The named outcomes
-- already exist in the logs, but logs are neither queryable by a merchant nor
-- retained by the app, so this table keeps a few days of them.
--
-- workspace_id is nullable on purpose: a rejected secret is refused before the
-- instance is looked up, so the attempt cannot be attributed to a workspace.
-- Those rows are still evidence, and the merchant-facing lookup finds them by
-- instance_name / account_id from the payload.
--
-- Identifiers only. No message text is stored here: customer content has a
-- shorter retention than a diagnostics row, and this table must not outlive it.

CREATE TABLE public.mena_inbound_webhook_events (
  id text PRIMARY KEY,
  workspace_id text REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  -- Null when the attempt was rejected before the platform could be read
  -- (a Meta call whose object type never parsed), rather than guessing one.
  platform text,
  event text NOT NULL,
  delivery_confirmed boolean NOT NULL DEFAULT true,
  instance_name text,
  account_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_inbound_webhook_event_platform_check
    CHECK (platform IN ('whatsapp', 'facebook', 'instagram'))
);

-- Merchant-facing lookup: attempts for my workspace, newest first.
CREATE INDEX mena_inbound_webhook_event_workspace_idx
  ON public.mena_inbound_webhook_events (workspace_id, created_at);

-- Unattributed attempts, matched by the identifiers the payload carried.
CREATE INDEX mena_inbound_webhook_event_instance_idx
  ON public.mena_inbound_webhook_events (platform, instance_name, created_at);
CREATE INDEX mena_inbound_webhook_event_account_idx
  ON public.mena_inbound_webhook_events (platform, account_id, created_at);

-- Retention purge.
CREATE INDEX mena_inbound_webhook_event_created_idx
  ON public.mena_inbound_webhook_events (created_at);
