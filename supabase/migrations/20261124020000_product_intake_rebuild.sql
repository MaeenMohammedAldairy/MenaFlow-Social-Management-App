-- Message → Product rebuild: trust, matching, versioning, change log and idempotency.
-- Safe to apply to an existing database: every statement is additive or guarded.

-- 1. Message sender direction, used to tell merchant catalog facts from customer chatter.
ALTER TABLE public.mena_whatsapp_messages
  ADD COLUMN IF NOT EXISTS from_me boolean NOT NULL DEFAULT false;

-- 2. Product provenance.
ALTER TABLE public.mena_products
  ADD COLUMN IF NOT EXISTS normalized_name text,
  ADD COLUMN IF NOT EXISTS source_trust text NOT NULL DEFAULT 'merchant',
  ADD COLUMN IF NOT EXISTS last_extraction_suggestion_id text,
  ADD COLUMN IF NOT EXISTS updated_by text,
  ADD COLUMN IF NOT EXISTS updated_reason text;

DO $$
BEGIN
  ALTER TABLE public.mena_products
    ADD CONSTRAINT mena_products_source_trust_check
    CHECK (source_trust IN ('merchant', 'customer', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS mena_products_workspace_normalized_name_idx
  ON public.mena_products (workspace_id, normalized_name);

UPDATE public.mena_products
   SET normalized_name = lower(regexp_replace(
     translate(name, 'أإآ', 'aaa'), '[^[:alnum:]]+', ' ', 'g'))
 WHERE normalized_name IS NULL;

-- 3. Versioned suggestions with trust and match transparency.
ALTER TABLE public.mena_product_extraction_suggestions
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS previous_suggestion_id text,
  ADD COLUMN IF NOT EXISTS sender_role text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS match_strategy text,
  ADD COLUMN IF NOT EXISTS matched_product_id text,
  ADD COLUMN IF NOT EXISTS match_score numeric(5,4),
  ADD COLUMN IF NOT EXISTS extraction_input_hash text,
  ADD COLUMN IF NOT EXISTS ruleset_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS model_version text,
  ADD COLUMN IF NOT EXISTS override_reason text;

ALTER TABLE public.mena_product_extraction_suggestions
  DROP CONSTRAINT IF EXISTS mena_product_extraction_status_check;
ALTER TABLE public.mena_product_extraction_suggestions
  ADD CONSTRAINT mena_product_extraction_status_check
  CHECK (status IN (
    'review', 'draft_created', 'possible_duplicate', 'dismissed',
    'superseded', 'update_proposed', 'accepted_update', 'rejected_update'
  ));

ALTER TABLE public.mena_product_extraction_suggestions
  DROP CONSTRAINT IF EXISTS mena_product_extraction_sender_role_check;
ALTER TABLE public.mena_product_extraction_suggestions
  ADD CONSTRAINT mena_product_extraction_sender_role_check
  CHECK (sender_role IN ('merchant', 'customer', 'unknown'));

CREATE UNIQUE INDEX IF NOT EXISTS mena_product_extraction_version_key
  ON public.mena_product_extraction_suggestions
  (workspace_id, previous_suggestion_id, version);

UPDATE public.mena_product_extraction_suggestions
   SET sender_role = CASE
     WHEN product_id IS NOT NULL THEN 'merchant'
     ELSE 'unknown'
   END
 WHERE sender_role = 'unknown';

-- One message can now feed several product suggestions; source rows are
-- distinguished by the item they belong to instead of by message alone.
ALTER TABLE public.mena_product_extraction_sources
  ADD COLUMN IF NOT EXISTS item_index integer NOT NULL DEFAULT 0;
ALTER TABLE public.mena_product_extraction_sources
  DROP CONSTRAINT IF EXISTS mena_product_extraction_source_workspace_message_key;
CREATE UNIQUE INDEX IF NOT EXISTS mena_product_extraction_source_workspace_message_key
  ON public.mena_product_extraction_sources
  (workspace_id, message_id, suggestion_id, item_index);

-- 4. Jobs carry versioning, dedupe and dead-letter information.
ALTER TABLE public.mena_whatsapp_product_extraction_jobs
  ADD COLUMN IF NOT EXISTS ruleset_version text NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS mena_whatsapp_product_extraction_job_dedupe_key
  ON public.mena_whatsapp_product_extraction_jobs (workspace_id, dedupe_key);

-- 5. Append-only change log.
CREATE TABLE IF NOT EXISTS public.mena_product_changes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  field text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'extraction', 'order', 'publication')),
  source_id text,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_changes_workspace_id_key UNIQUE (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS mena_product_changes_product_created_idx
  ON public.mena_product_changes (workspace_id, product_id, created_at);

-- 6. Update proposals, never applied without merchant approval.
CREATE TABLE IF NOT EXISTS public.mena_product_change_proposals (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  suggestion_id text NOT NULL,
  diff jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected', 'expired')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_change_proposals_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT mena_product_change_proposals_suggestion_idx UNIQUE (workspace_id, suggestion_id)
);

-- 7. Match transparency.
CREATE TABLE IF NOT EXISTS public.mena_product_match_candidates (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  suggestion_id text NOT NULL,
  product_id text NOT NULL,
  strategy text NOT NULL,
  score numeric(5,4) NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_match_candidates_workspace_id_key UNIQUE (workspace_id, id)
);
CREATE INDEX IF NOT EXISTS mena_product_match_candidates_suggestion_idx
  ON public.mena_product_match_candidates (workspace_id, suggestion_id);

-- 8. Lifecycle events and provider idempotency.
CREATE TABLE IF NOT EXISTS public.mena_product_extraction_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  job_id text,
  suggestion_id text,
  event text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mena_product_extraction_events_workspace_created_idx
  ON public.mena_product_extraction_events (workspace_id, event, created_at);

CREATE TABLE IF NOT EXISTS public.mena_webhook_idempotency (
  id text PRIMARY KEY,
  provider text NOT NULL,
  event_key text NOT NULL,
  workspace_id text REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_webhook_idempotency_provider_event_key UNIQUE (provider, event_key)
);
CREATE INDEX IF NOT EXISTS mena_webhook_idempotency_created_idx
  ON public.mena_webhook_idempotency (created_at);

-- 9. Composite foreign keys keep the new tables inside their workspace.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mena_product_changes_product_fk') THEN
    ALTER TABLE public.mena_product_changes
      ADD CONSTRAINT mena_product_changes_product_fk
      FOREIGN KEY (workspace_id, product_id)
      REFERENCES public.mena_products (workspace_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mena_product_change_proposals_product_fk') THEN
    ALTER TABLE public.mena_product_change_proposals
      ADD CONSTRAINT mena_product_change_proposals_product_fk
      FOREIGN KEY (workspace_id, product_id)
      REFERENCES public.mena_products (workspace_id, id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mena_product_match_candidates_suggestion_fk') THEN
    ALTER TABLE public.mena_product_match_candidates
      ADD CONSTRAINT mena_product_match_candidates_suggestion_fk
      FOREIGN KEY (workspace_id, suggestion_id)
      REFERENCES public.mena_product_extraction_suggestions (workspace_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- 10. No direct client access: the service-role API is the only writer.
ALTER TABLE public.mena_product_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_product_change_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_product_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_product_extraction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_webhook_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_product_changes FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_product_change_proposals FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_product_match_candidates FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_product_extraction_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_webhook_idempotency FROM anon, authenticated;
