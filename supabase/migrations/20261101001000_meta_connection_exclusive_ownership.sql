DO $$
DECLARE
  page_null_count bigint;
  page_blank_count bigint;
  page_padded_count bigint;
  page_duplicate_record_count bigint;
  instagram_blank_count bigint;
  instagram_padded_count bigint;
  instagram_duplicate_record_count bigint;
BEGIN
  -- Match ECMAScript String.trim()'s whitespace code points explicitly.
  -- This assumes UTF-8 PostgreSQL encoding, as used by the Supabase project.
  SELECT
    COUNT(*) FILTER (WHERE page_id IS NULL),
    COUNT(*) FILTER (
      WHERE btrim(
        page_id,
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279)
      ) = ''
    ),
    COUNT(*) FILTER (
      WHERE page_id <> btrim(
        page_id,
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279)
      )
    )
  INTO page_null_count, page_blank_count, page_padded_count
  FROM public.mena_meta_connections;

  WITH normalized AS (
    SELECT btrim(
      page_id,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    ) AS account_id
    FROM public.mena_meta_connections
  ),
  duplicate_ids AS (
    SELECT account_id
    FROM normalized
    WHERE account_id <> ''
    GROUP BY account_id
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*)
  INTO page_duplicate_record_count
  FROM normalized
  JOIN duplicate_ids USING (account_id);

  SELECT
    COUNT(*) FILTER (
      WHERE btrim(
        instagram_user_id,
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279)
      ) = ''
    ),
    COUNT(*) FILTER (
      WHERE instagram_user_id <> btrim(
        instagram_user_id,
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279)
      )
    )
  INTO instagram_blank_count, instagram_padded_count
  FROM public.mena_meta_connections
  WHERE instagram_user_id IS NOT NULL;

  WITH normalized AS (
    SELECT btrim(
      instagram_user_id,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    ) AS account_id
    FROM public.mena_meta_connections
    WHERE instagram_user_id IS NOT NULL
  ),
  duplicate_ids AS (
    SELECT account_id
    FROM normalized
    WHERE account_id <> ''
    GROUP BY account_id
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*)
  INTO instagram_duplicate_record_count
  FROM normalized
  JOIN duplicate_ids USING (account_id);

  IF page_null_count > 0
    OR page_blank_count > 0
    OR page_padded_count > 0
    OR page_duplicate_record_count > 0
    OR instagram_blank_count > 0
    OR instagram_padded_count > 0
    OR instagram_duplicate_record_count > 0
  THEN
    RAISE EXCEPTION
      'Cannot enforce exclusive Meta account ownership. Offending records: NULL Page IDs=%, blank/whitespace-only Page IDs=%, Page IDs with surrounding whitespace=%, Page records in duplicate normalized-ID groups=%, blank/whitespace-only Instagram IDs=%, Instagram IDs with surrounding whitespace=%, Instagram records in duplicate normalized-ID groups=%. Review and resolve records manually; no rows were changed.',
      page_null_count,
      page_blank_count,
      page_padded_count,
      page_duplicate_record_count,
      instagram_blank_count,
      instagram_padded_count,
      instagram_duplicate_record_count;
  END IF;
END;
$$;

ALTER TABLE public.mena_meta_connections
  ADD CONSTRAINT "mena_meta_connections_page_id_valid_check"
  CHECK (
    "page_id" IS NOT NULL
    AND btrim(
      "page_id",
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    ) <> ''
    AND "page_id" = btrim(
      "page_id",
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    )
  );

ALTER TABLE public.mena_meta_connections
  ADD CONSTRAINT "mena_meta_connections_instagram_user_id_valid_check"
  CHECK (
    "instagram_user_id" IS NULL
    OR (
      btrim(
        "instagram_user_id",
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279)
      ) <> ''
      AND "instagram_user_id" = btrim(
        "instagram_user_id",
        chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
        chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
        chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
        chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
        chr(8239) || chr(8287) || chr(12288) || chr(65279)
      )
    )
  );

ALTER TABLE public.mena_meta_connections
  DROP CONSTRAINT "mena_meta_connections_owner_id_unique";

CREATE UNIQUE INDEX "mena_meta_connections_page_id_key"
  ON public.mena_meta_connections
  USING btree (
    btrim(
      "page_id",
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    )
  );

CREATE UNIQUE INDEX "mena_meta_connections_instagram_user_id_key"
  ON public.mena_meta_connections
  USING btree (
    btrim(
      "instagram_user_id",
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
      chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
      chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
      chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
      chr(8239) || chr(8287) || chr(12288) || chr(65279)
    )
  )
  WHERE "instagram_user_id" IS NOT NULL AND btrim(
    "instagram_user_id",
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
    chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
    chr(8239) || chr(8287) || chr(12288) || chr(65279)
  ) <> '';
