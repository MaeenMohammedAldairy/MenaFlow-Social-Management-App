# WhatsApp group sync

The WhatsApp sync settings let each workspace independently enable automatic
sync and select messages, images, and videos. Manual history sync imports only
the selected content types from selected groups. Text and media captions follow
the messages setting; image and video attachments follow their respective
settings. Audio and document attachments follow the messages setting.
Group send permissions do not prevent syncing messages or creating reviewable
content from a selected group.
Historical lookup checks both the primary and alternate WhatsApp group JIDs
because newer WhatsApp addressing may store a participant LID as the primary
JID while preserving the group JID as the alternate JID.

Regular sync resumes from the newest saved message timestamp and stops
requesting older pages once it reaches that cursor. Messages at the cursor
timestamp are checked too, so messages sharing a timestamp are not lost.
Already saved messages are not written again; messages with pending or failed
media can be retried when encountered. For explicit previous-history sync,
users can set a maximum number of unpersisted messages to import per selected
group (default 500; allowed range 1–10,000). The importer continues through
older pages until it reaches that number or the provider runs out of history;
fully saved messages do not consume the limit. The regular sync of new messages
is not affected by this limit.

Evolution webhooks subscribe to live message upserts, updates, and deletions.
Bulk `MESSAGES_SET` history events are intentionally not subscribed to: their
payloads can exceed the webhook request limit. Historical and catch-up imports
use the explicit sync endpoint and Evolution's paginated `chat/findMessages`
API for selected groups instead.

All content sync settings default to enabled to preserve existing behavior.
Changing a setting affects new imports and pending media retries; it does not
delete previously stored messages or media.

Apply `supabase/migrations/20261021003000_whatsapp_media_sync_settings.sql`
before deploying the WhatsApp sync content filters.

Newly created Evolution instances request `syncFullHistory` so WhatsApp can
send available initial history to Evolution. This is an instance-wide provider
setting; MenaFlow still imports only explicitly selected groups. Existing
instances keep their current Evolution setting and need to be reconnected or
re-paired for full-history sync to take effect. Evolution may not be able to
backfill messages that WhatsApp does not resend.

## Run control

A historical sync is the longest-running work in the app, so three settings
bound it. All are read per run; no restart is needed beyond redeploying the
process.

| Variable | Default | Effect |
| --- | --- | --- |
| `WHATSAPP_SYNC_GROUP_CONCURRENCY` | 3 | Selected groups synced in parallel. Clamped to 1–16, so a typo cannot open hundreds of parallel provider scans. |
| `WHATSAPP_SYNC_RUN_BUDGET_MS` | 600000 | Wall-clock budget for the fetch phase of one group. Floored at 30000. |
| `WHATSAPP_SYNC_HEARTBEAT_MS` | 60000 | How often a fetching run refreshes `updated_at`. Floored at 5000. |

Reaching the budget is not a failure. The scan stops before starting another
page, keeps every record it already collected, and the run is recorded as
`partial` with `last_error = WHATSAPP_HISTORY_RUN_BUDGET_REACHED`. The cursor
advances over what was imported, so the next sync continues where this one
stopped rather than restarting the group.

The heartbeat exists because stale-run cancellation only looks at `updated_at`.
A run that spent ten minutes fetching pages without writing anything looked
abandoned to any other process — the API cancelling stale runs while a worker
performed them — and was cancelled mid-flight. One write per interval keeps a
live run alive without writing per page.

Groups are claimed in a single batched `UPDATE … RETURNING` before any fetching
begins, so two processes never sync the same group, and the fan-out then runs
through the concurrency limit instead of `Promise.all`.

## Inbound delivery

Sync pulls history; the webhook pushes new messages. When neither produces
customer messages the two failures look the same on screen, so every inbound
decision is named, logged and recorded for seven days in
`mena_inbound_webhook_events`. The reply-settings screen reports whether
Evolution called at all, whether every call was refused and why, and whether the
calls that were accepted simply carried group traffic instead of direct
messages. See `docs/INBOUND_DELIVERY_DIAGNOSTICS.md` for the outcome vocabulary,
the retention variables, and the production queries.

One refusal deserves its own note because it empties an inbox while sync keeps
working: `WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE`. Instance names are
`menaflow-` + `sha256(workspaceId)[0:12]`, so a name no connection row holds is
the session of a workspace that no longer exists — and a leftover session can
still be the one bound to the merchant's phone, receiving every incoming message
that this server then refuses. Re-registering the webhook and pairing both sweep
those sessions now, within narrow rules (ours by name prefix, unclaimed by any
workspace, same phone number, at most five per run) and report what they decided.
See "Orphaned WhatsApp sessions" in `docs/INBOUND_DELIVERY_DIAGNOSTICS.md`.
