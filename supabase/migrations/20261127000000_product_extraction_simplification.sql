-- Message → Product simplification: one deterministic group, one extraction call,
-- reasons instead of silence, and structured facts.
--
-- Safe to apply to an existing database: every statement is additive, guarded,
-- or drops only what this change replaces. Read the comment above each block for
-- the measurement that made it necessary.
--
-- Applied to the live project `qznbujvanjvkfxpehcbq` on 2026-11-27 and recorded in
-- `supabase_migrations.schema_migrations` under this filename's version, so
-- `supabase db push` reports nothing pending. The verification queries in block 7
-- were run against it; what they showed is written up in
-- docs/SUPABASE_DATABASE_SETUP.md §5, «Record: applying
-- 20261127000000_product_extraction_simplification».

-- 1. A legacy narrow status CHECK made every correction path impossible.
--    The table carries both `mena_product_extraction_status_check` (wide) and an
--    older `mena_product_extraction_suggestions_status_check` (only four states),
--    so writing 'superseded' failed and each of the six re-extractions in the
--    live workspace died on it: 0 change proposals, 0 version chains, 0 rows in
--    any new state. Drop the narrow one and pin the wide one to the enum.
ALTER TABLE public.mena_product_extraction_suggestions
  DROP CONSTRAINT IF EXISTS mena_product_extraction_suggestions_status_check;

ALTER TABLE public.mena_product_extraction_suggestions
  DROP CONSTRAINT IF EXISTS mena_product_extraction_status_check;

DO $$
BEGIN
  ALTER TABLE public.mena_product_extraction_suggestions
    ADD CONSTRAINT mena_product_extraction_status_check
    CHECK (status IN (
      'review', 'draft_created', 'possible_duplicate', 'dismissed',
      'superseded', 'update_proposed', 'accepted_update', 'rejected_update'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. One product group, one suggestion per version.
--    `source_key` is a hash of the message ids, so any regrouping of the same
--    offer created a brand-new suggestion and the unique index on it blocked a
--    second version of the group. `group_key` is the identity of the *group*
--    (album id, accepted bundle id, or the single message), which stays stable
--    while the group grows.
ALTER TABLE public.mena_product_extraction_suggestions
  ADD COLUMN IF NOT EXISTS group_key text;

-- Backfill: a copy of `source_key`. This is a placeholder, not the identity the
-- server now computes (that one hashes the accepted bundle or the album with its
-- origin, which SQL cannot reproduce) — its job is to let the column be NOT NULL.
-- A legacy row is still found by the worker through its sources: the group looks
-- up any suggestion that covered one of its messages, so an old card is
-- superseded by the new version instead of standing beside it as a duplicate.
UPDATE public.mena_product_extraction_suggestions
   SET group_key = source_key
 WHERE group_key IS NULL;

ALTER TABLE public.mena_product_extraction_suggestions
  ALTER COLUMN group_key SET NOT NULL;

-- The live database carries `(workspace_id, source_key)` as a UNIQUE
-- CONSTRAINT, not as a plain index (measured: contype 'u'), so `DROP INDEX`
-- would have failed here with "index is used by constraint". Dropping the
-- constraint removes its index with it, and the non-unique index below keeps the
-- lookup the matcher still needs.
ALTER TABLE public.mena_product_extraction_suggestions
  DROP CONSTRAINT IF EXISTS mena_product_extraction_workspace_source_key;

CREATE INDEX IF NOT EXISTS mena_product_extraction_workspace_source_key_idx
  ON public.mena_product_extraction_suggestions (workspace_id, source_key);

-- The item's place within the group's answer is part of the identity, because a
-- group may legitimately be several products (the three-photo Drain Powder album)
-- while a replay of the same run must still be recognised as one row.
ALTER TABLE public.mena_product_extraction_suggestions
  ADD COLUMN IF NOT EXISTS item_index integer NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS mena_product_extraction_group_version_key
  ON public.mena_product_extraction_suggestions
  (workspace_id, group_key, version, item_index);

CREATE INDEX IF NOT EXISTS mena_product_extraction_group_idx
  ON public.mena_product_extraction_suggestions (workspace_id, group_key);

-- The older chain index is unique on (workspace, predecessor, version), which is
-- one row per predecessor — but a group is allowed to answer with several
-- products at one version, and a second item pointing at the same predecessor
-- would then be refused rather than stored. The item's place joins the key so
-- the index says what it means: one predecessor per item per version.
DROP INDEX IF EXISTS public.mena_product_extraction_version_key;

CREATE UNIQUE INDEX IF NOT EXISTS mena_product_extraction_version_key
  ON public.mena_product_extraction_suggestions
  (workspace_id, previous_suggestion_id, version, item_index);

-- 3. Structured facts and price provenance on the catalog row.
--    «مزود ب12 رأس» and «ضد الماء 30 متر» were only ever description text, so no
--    diff, no publication field and no search could see them. `raw_price_text`
--    and `price_status` keep the merchant's own words beside the number, which
--    is what lets a reviewer tell 25000 from 25 without re-reading the chat.
ALTER TABLE public.mena_products
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS specifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accessories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS raw_price_text text,
  ADD COLUMN IF NOT EXISTS price_status text;

DO $$
BEGIN
  ALTER TABLE public.mena_products
    ADD CONSTRAINT mena_products_price_status_check
    CHECK (price_status IS NULL OR price_status IN (
      'confirmed', 'unquoted', 'ambiguous', 'missing'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. Why a job ended. `last_error` can only carry a failure, so a job that
--    dropped a message (bundle already covered) looked exactly like a job that
--    stored everything. The code makes the reason mandatory at every terminal
--    transition; the event table now records it too.
ALTER TABLE public.mena_whatsapp_product_extraction_jobs
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS prompt_version text,
  ADD COLUMN IF NOT EXISTS raw_extraction_response jsonb;

CREATE INDEX IF NOT EXISTS mena_whatsapp_product_extraction_job_reason_idx
  ON public.mena_whatsapp_product_extraction_jobs (workspace_id, reason_code);

DO $$
BEGIN
  ALTER TABLE public.mena_whatsapp_product_extraction_jobs
    ADD CONSTRAINT mena_whatsapp_product_extraction_job_reason_check
    CHECK (reason_code IS NULL OR reason_code IN (
      'RECORDED',
      'SKIPPED_MESSAGE_UNRECEIVABLE',
      'SKIPPED_ALREADY_COVERED',
      'FAILED_ASSOCIATED_MESSAGE_UNAVAILABLE',
      'WAITING_MEDIA',
      'FAILED_MEDIA_UNRECOVERABLE',
      'RECORDED_MEDIA_PARTIAL',
      'WAITING_ASSOCIATION',
      'REEXTRACTED_GROUP_GROWN',
      'NEEDS_TEXT',
      'FAILED_MODEL_RESPONSE',
      'PAUSED_AI_QUOTA',
      'FAILED_PERSISTENCE'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. What the media ended up doing, and which prompt wrote the row.
ALTER TABLE public.mena_product_extraction_suggestions
  ADD COLUMN IF NOT EXISTS media_state text NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS prompt_version text;

DO $$
BEGIN
  ALTER TABLE public.mena_product_extraction_suggestions
    ADD CONSTRAINT mena_product_extraction_suggestion_media_state_check
    CHECK (media_state IN ('not_applicable', 'included', 'partial', 'pending', 'lost'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS mena_product_extraction_suggestion_media_state_idx
  ON public.mena_product_extraction_suggestions (workspace_id, media_state);

-- 6. Nothing, on purpose. A functional index on
--    `lower(regexp_replace(extracted_data ->> 'name', ...))` was written for the
--    dedup lookup and then dropped again before it left the migration history:
--    no statement in the server filters or joins on that expression (the matcher
--    compares candidate names in memory, `matchProductCandidate`), so the index
--    would only have cost a write per suggestion. Re-add it together with the
--    query that uses it, not before.

-- 7. What to look at after applying, in the first hour:
--
--   -- every settled job names a reason; a NULL here means a write path that
--   -- bypassed `updateJob`
--   select status, reason_code, count(*) from mena_whatsapp_product_extraction_jobs
--    where updated_at > now() - interval '1 hour'
--    group by 1, 2 order by 3 desc;
--
--   -- the chain works: a group with more than one version, and one open row each
--   select group_key, count(*) as versions,
--          count(*) filter (where status not in ('superseded','dismissed')) as open
--     from mena_product_extraction_suggestions
--    group by 1 having count(*) > 1 order by 2 desc limit 20;
--
--   -- prices survived: `0` here is the bug the audit measured (0 of 12 product
--   -- suggestions carried a price while 8 messages mentioned one)
--   select count(*) filter (where extracted_data ->> 'price' is not null) as with_price,
--          count(*) as product_suggestions
--     from mena_product_extraction_suggestions
--    where classification = 'product';
