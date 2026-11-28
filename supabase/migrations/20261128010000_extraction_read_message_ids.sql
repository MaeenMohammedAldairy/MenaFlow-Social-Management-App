-- R-4 (Phase 4) — record what was READ, not only what the model said it used.
--
-- >>> NOT EXECUTED. <<<
-- Prepared for review only. It has never been run against the live project
-- `qznbuvanjvkfxpehcbq` or any local database, and `supabase_migrations` has no
-- row for this version. Applying it is a separate, explicitly approved step.
--
-- Why the column exists (measured, not assumed):
--
--   `mena_product_extraction_sources` holds one row per message the MODEL put in
--   `candidate.sourceMessageIds`. The messages the worker actually handed to the
--   model are never stored: the only trace of them is `source_key`, a sha256 of
--   the same declared ids (`product-extraction.ts:528-535`).
--
--   Consequence, measured on the live project: for the eleven album suggestions
--   whose group has 7-8 member messages, exactly 1 message was recorded as a
--   source — the album *container*. The other 7 photos reached the model and
--   reached the price, but nothing in the database says so. That is RC-3: the
--   extraction succeeded and its provenance was lost.
--
--   `read_message_ids` is therefore a separate fact from `source_key`:
--     * `source_key`      = what the model claimed  (unchanged, still a hash)
--     * `read_message_ids` = what the worker passed to the model (this column)
--   They are both kept. Neither is derived from the other, and `source_key`
--   keeps its current meaning so no existing row is reinterpreted.
--
-- What this migration deliberately does NOT do:
--   * no change to `mena_product_extraction_sources` (its rows stay as they are,
--     because the producer of those rows is extraction behaviour, not schema);
--   * no backfill — an old row has no way to know what was read, so the column
--     stays NULL there and every reader must treat NULL as "unknown", never as
--     "nothing was read";
--   * no index and no constraint beyond the element check: the column is
--     diagnostic, so it must not slow down or block a write.
--
-- Apply order, when approved: run this SQL, then add the matching Drizzle column
-- to `lib/db/src/schema/products.ts` (productExtractionSuggestions) and run
-- `pnpm --filter @workspace/db run generate`, because CI's schema-drift gate
-- requires `supabase/migrations/` and the generated snapshot to move together.

-- 1. The column. Additive and nullable: every existing row becomes "unknown".
ALTER TABLE public.mena_product_extraction_suggestions
  ADD COLUMN IF NOT EXISTS read_message_ids text[];

-- 2. Guard the shape only. A NULL (unknown) is allowed; an array must not carry
--    an empty string, because an empty id would silently widen every join that
--    uses it.
DO $$
BEGIN
  ALTER TABLE public.mena_product_extraction_suggestions
    ADD CONSTRAINT mena_product_extraction_suggestions_read_message_ids_check
    CHECK (
      read_message_ids IS NULL
      OR (
        array_position(read_message_ids, '') IS NULL
        AND array_position(read_message_ids, NULL) IS NULL
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.mena_product_extraction_suggestions.read_message_ids IS
  'Message ids the extraction worker passed to the model for this suggestion. NULL means unknown (rows written before this column existed); it does not mean "nothing was read". Distinct from source_key, which hashes the ids the model claimed.';

-- Verification queries to run AFTER applying (read-only):
--   select count(*) filter (where read_message_ids is null) as unknown_rows,
--          count(*) filter (where read_message_ids is not null) as known_rows
--     from public.mena_product_extraction_suggestions;
--   select count(*) from public.mena_product_extraction_suggestions
--    where read_message_ids is not null
--      and cardinality(read_message_ids) >
--          (select count(*) from public.mena_product_extraction_sources
--            where suggestion_id = mena_product_extraction_suggestions.id);
