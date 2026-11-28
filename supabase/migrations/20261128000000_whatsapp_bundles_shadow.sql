-- WhatsApp bundle layer — Phase 2 schema draft.
--
-- >>> NOT EXECUTED. <<<
-- This file has never been run against any database — not the live project
-- `qznbujvanjvkfxpehcbq`, not a local copy. It is checked in as the *proposed*
-- shape of the two tables the shadow engine would need if Phase 3 is approved.
-- Nothing here changes an existing table, so applying it later is additive.
--
-- Shape notes (each one is a consequence of a measured production case):
--
--   * A bundle is a *collectable* thing, not a label on a message. Hence the
--     status ladder below rather than "resolved at arrival": a photo whose text
--     has not arrived yet is COLLECTING, not wrong.
--   * `anchor_message_id` is the earliest member, so re-planning a grown window
--     reproduces the same `id` and the same row instead of minting a new bundle
--     every time a photo is added (the Legacy `whatsappProductExtractionGroupKey`
--     mints a fresh key per answer — that is the identity churn this replaces).
--   * `version` + `frozen_at` exist for the future PROCESSING snapshot: once a
--     bundle is being extracted it is frozen, and late arrivals create a new
--     version rather than mutating what the model already saw.
--   * `media_expected` / `media_stored` are stored, not derived, so the
--     "13 advertised, 12 present" album (ACFEFACE) and the "2 advertised, 0
--     present" album (ACE5CCDE) stay visible as a shortfall instead of being
--     silently recomputed into "complete".
--   * No FK from this schema to the extraction tables, and no trigger anywhere:
--     the Legacy pipeline keeps working untouched and nothing here can create a
--     job, a suggestion, or a model call.

begin;

-- 1. Bundles -----------------------------------------------------------------

create table if not exists public.mena_whatsapp_bundles (
  id                      text primary key,
  workspace_id            text not null,
  owner_id                text not null,
  instance_name           text not null,
  group_jid               text not null,
  group_id                text,
  -- `mena_whatsapp_messages.id` is text (a generated key), not uuid: matching
  -- the column type is what keeps this FK legal on apply.
  anchor_message_id       text not null references public.mena_whatsapp_messages (id) on delete cascade,
  kind                    text not null,
  evidence                text not null,
  evidence_detail         jsonb not null default '{}'::jsonb,
  confidence              text not null default 'medium',
  status                  text not null default 'COLLECTING',
  review_reason           text,
  media_expected          integer not null default 0,
  media_stored            integer not null default 0,
  member_set_hash         text not null,
  version                 integer not null default 1,
  frozen_at               timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint mena_whatsapp_bundles_kind_check
    check (kind in ('album', 'reply', 'explicit', 'adjacent', 'single')),

  constraint mena_whatsapp_bundles_status_check
    check (status in ('COLLECTING', 'READY', 'NEEDS_REVIEW', 'PROCESSING', 'DONE', 'DISMISSED')),

  constraint mena_whatsapp_bundles_confidence_check
    check (confidence in ('strong', 'medium', 'weak')),

  constraint mena_whatsapp_bundles_counts_check
    check (media_expected >= 0 and media_stored >= 0),

  -- The three review reasons the engine can produce today. A bundle is allowed
  -- to be NEEDS_REVIEW without one (an operator may set that by hand), but it
  -- may not invent a reason outside this list.
  constraint mena_whatsapp_bundles_review_reason_check
    check (
      review_reason is null
      or review_reason in (
        'MEDIA_PENDING', 'MEDIA_PARTIAL', 'NEEDS_TEXT', 'TEXT_SETTLING',
        'MULTIPLE_TEXT_CANDIDATES', 'TEXT_CLAIMED_BY_TWO_CLUSTERS',
        'PRODUCT_TOKEN_CONFLICT', 'AMBIGUOUS_EVIDENCE'
      )
    ),

  -- PROCESSING is the only state that must be frozen: it is the snapshot the
  -- model may be shown.
  constraint mena_whatsapp_bundles_frozen_check
    check (status <> 'PROCESSING' or frozen_at is not null)
);

create index if not exists mena_whatsapp_bundles_workspace_idx
  on public.mena_whatsapp_bundles (workspace_id, created_at desc);

create index if not exists mena_whatsapp_bundles_status_idx
  on public.mena_whatsapp_bundles (workspace_id, status)
  where status in ('COLLECTING', 'READY', 'NEEDS_REVIEW');

create index if not exists mena_whatsapp_bundles_group_idx
  on public.mena_whatsapp_bundles (owner_id, instance_name, group_jid, created_at desc);

-- 2. Bundle membership -------------------------------------------------------

create table if not exists public.mena_whatsapp_bundle_members (
  id              uuid primary key default gen_random_uuid(),
  bundle_id       text not null references public.mena_whatsapp_bundles (id) on delete cascade,
  message_id      text not null references public.mena_whatsapp_messages (id) on delete cascade,
  workspace_id    text not null,
  role            text not null,
  claim_reason    text not null,
  created_at      timestamptz not null default now(),

  constraint mena_whatsapp_bundle_members_role_check
    check (role in ('media', 'text', 'both')),

  constraint mena_whatsapp_bundle_members_claim_reason_check
    check (claim_reason in (
      'ALBUM_MEMBER', 'REPLY_MEMBER', 'EXPLICIT_REFERENCE', 'MEDIA_RUN_MEMBER',
      'CLUSTER_TEXT', 'SINGLETON'
    )),

  -- A message appears at most once inside one bundle version. It may appear in
  -- several versions of the same bundle (that is what a frozen snapshot plus a
  -- new version means), which is why the constraint is not on message_id alone.
  constraint mena_whatsapp_bundle_members_unique_key
    unique (bundle_id, message_id)
);

create index if not exists mena_whatsapp_bundle_members_message_idx
  on public.mena_whatsapp_bundle_members (message_id);

create index if not exists mena_whatsapp_bundle_members_workspace_idx
  on public.mena_whatsapp_bundle_members (workspace_id);

-- 3. What this migration deliberately does NOT do ----------------------------
--
--   * No backfill: no bundle is created for the 122 messages already stored.
--     Phase 2 is a shadow comparison; writing rows would make the comparison
--     self-fulfilling and would also be a database mutation, which is out of
--     scope for this phase.
--   * No changes to mena_product_extraction_* — no column, no constraint, no
--     index. The Legacy path must keep behaving exactly as it does today.
--   * No change to mena_whatsapp_messages or mena_whatsapp_message_media. The
--     engine reads them; it does not add columns to them.
--   * No trigger, no function, no cron entry, no worker registration. Nothing
--     in this file executes on its own.
--   * No permission changes. If RLS is enabled on these tables later, it must be
--     decided in its own migration, together with the access patterns.

commit;
