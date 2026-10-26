# WhatsApp group identity diagnosis and rollout

## Existing relationships observed in the code

- `mena_whatsapp_connections` is the account boundary. It is unique per
  `workspace_id`; its current provider connection is identified by
  `instance_name`.
- `mena_whatsapp_group_selections` stores the user's selected provider
  `group_jid`, along with display and publish-permission snapshots. Its current
  uniqueness is owner plus provider JID.
- `mena_whatsapp_sync_states` stores sync progress keyed by owner, instance,
  and provider `group_jid`.
- `mena_whatsapp_messages` stores `remote_message_id` and `group_jid`; the
  current message uniqueness includes both provider IDs. Message/media album
  identity is derived using the same provider JID.
- `mena_whatsapp_message_media` stores the provider JID and internal message
  row ID. Its uniqueness also includes the provider JID.
- WhatsApp posts retain `source_group_jid` and source message IDs. Content jobs
  refer to a message row ID. These are downstream provenance fields, not the
  group-selection or sync identity.
- The Evolution webhook currently finds a selected group by exact equality
  with `remoteJid`; history sync queries Evolution using the selected JID and
  rejects records whose remote JID does not match.
- The groups route normalizes Evolution `id`, `isCommunity`, `announce`, and
  `linkedParent`. `linkedParent` is the only explicit community-to-child
  relationship in the observed provider payload. A community can have more
  than one child group; parent/child JIDs must not be treated as interchangeable.
- There is no internal group table, provider-JID alias table, or existing
  foreign-key relationship from selection, sync, message, or media rows to a
  group entity.

## Target model

Introduce a workspace- and instance-scoped internal group identity, plus a
provider-JID mapping table. A community and each announcement/regular group
remain separate identities. Evolution IDs are stored as exact provider
identifiers; an explicit `linkedParent` relationship links a child identity
to a community identity. Selecting a community means syncing all of its
explicitly linked child groups; selecting a child remains independent.

Selection, sync state, messages, and media receive an internal group ID with a
composite workspace/instance foreign key. Existing `group_jid` values remain
unchanged as provider provenance and for API compatibility. Message
deduplication moves to the internal group ID plus the provider message ID.
Newly imported messages also retain Evolution's original `remoteJid` and
`remoteJidAlt` separately; the group-scoped `group_jid` remains the exact
selected group JID. History imports do not rewrite an alternate-JID record's
original message key. Legacy messages whose provider key was not separately
stored keep the new provider-key columns null rather than inferring a value.
Posts continue retaining their original source JID.

## Migration and rollout

1. Apply the additive schema migration. It introduces the identity, JID, and
   review tables and nullable identity references; it does not rewrite existing
   rows.
2. Run `scripts/migrate-whatsapp-group-identities.mjs --report` against an
   explicitly selected non-production database. The report groups rows only by
   exact workspace, instance, owner, and stored JID. It reports orphans and
   ownership/connection mismatches without changing data.
3. Review the report, then explicitly run the same script with `--apply`.
   Proven exact matches receive identities. Unmatched rows remain unchanged and
   are recorded in the migration-review table. The operation uses one
   transaction, an advisory lock, and table locks, and is safe to retry.
4. Deploy the identity-aware server. New rows must have an identity; legacy
   rows without a proven identity stay excluded and visible for review. No
   runtime code silently falls back to assuming that a community JID is a
   child-group JID.
5. Keep the original JID columns and exact-JID API compatibility until a
   separate, evidence-based deprecation. Do not rewrite historic message JIDs,
   merge message rows, or delete ambiguous data as part of this rollout.

No live database is accessed by development or automated tests. The report
script is read-only; applying the backfill requires an explicit flag.
