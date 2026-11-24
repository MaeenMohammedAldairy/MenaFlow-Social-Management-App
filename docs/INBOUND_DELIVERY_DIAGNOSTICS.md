# Inbound delivery diagnostics

"No customer messages are arriving" is the most expensive sentence in this app
to diagnose, because it has three causes that look identical from the merchant's
seat and need three different fixes:

1. **The provider never called.** The webhook is not registered, points at the
   wrong domain, or the Meta app is still in Development mode.
2. **The provider called and we refused it.** A rotated secret, a missing app
   secret, an instance name that no longer matches a connection, an account id
   that is not linked.
3. **The call was accepted and produced no work.** Group events instead of
   direct messages, an event kind that carries no message, a reply skipped by
   policy.

Everything below exists to tell those apart from data the app itself holds,
rather than from log access that a merchant does not have and an operator may
not have at the moment the question is asked.

## One vocabulary for every outcome

`artifacts/api-server/src/lib/inbound-webhook-diagnostics.ts` names every
decision an inbound handler can make. Each name carries a log level, an Arabic
hint for the operator, and a `deliveryConfirmed` flag saying whether the outcome
proves the provider reached this server at all.

WhatsApp (`POST /api/social/whatsapp/webhook`):

| Event | Level | Meaning |
| --- | --- | --- |
| `WHATSAPP_WEBHOOK_PAYLOAD_NOT_OBJECT` | debug | Body was not an object; ignored. |
| `WHATSAPP_WEBHOOK_REJECTED_SECRET` | warn | `x-evolution-api-key` ≠ `WHATSAPP_EVOLUTION_WEBHOOK_SECRET`. |
| `WHATSAPP_WEBHOOK_IGNORED_EVENT` | debug | Not a message event (presence, connection update, …). |
| `WHATSAPP_WEBHOOK_MISSING_INSTANCE_OR_JID` | warn | Payload carried neither `instance` nor `remoteJid`. |
| `WHATSAPP_WEBHOOK_UNKNOWN_INSTANCE` | warn | No connection row with that instance name. |
| `WHATSAPP_WEBHOOK_AMBIGUOUS_INSTANCE` | error | More than one connection row with that instance name. |
| `WHATSAPP_WEBHOOK_PROCESSED` | info | A `MESSAGES_UPSERT` event was handled. |

Meta (`POST /api/social/meta/webhook`):

| Event | Level | Meaning |
| --- | --- | --- |
| `META_WEBHOOK_MISSING_APP_SECRET` | error | `FACEBOOK_APP_SECRET` unset, so no signature can be verified. |
| `META_WEBHOOK_REJECTED_SIGNATURE` | warn | `x-hub-signature-256` did not match the body. |
| `META_WEBHOOK_INVALID_JSON` | warn | Body was not a JSON object. |
| `META_WEBHOOK_IGNORED_OBJECT` | debug | `object` was neither `page` nor `instagram`. |
| `META_WEBHOOK_MISSING_ACCOUNT_ID` | warn | Entry carried no account id. |
| `META_WEBHOOK_UNKNOWN_ACCOUNT` | warn | No connection for that page id / Instagram user id. |
| `META_WEBHOOK_AMBIGUOUS_ACCOUNT` | error | More than one connection for that account. |
| `META_WEBHOOK_NO_EVENTS` | debug | Entry parsed but contained no usable events. |
| `META_WEBHOOK_AUTO_REPLY_DISABLED` | info | Stored, but automatic replies are off for the workspace. |
| `META_WEBHOOK_AUTO_REPLY_CHANNEL_OFF` | info | Stored, but this channel (messages/comments) is off. |
| `META_WEBHOOK_INBOX_STORED` | info | Inbox items written. |
| `META_WEBHOOK_AUTO_REPLY_QUEUED` | info | Reply jobs queued. |
| `META_WEBHOOK_PROCESSED` | info | The whole call finished. |

WhatsApp auto-reply skips (`WHATSAPP_AUTO_REPLY_SKIPPED_*`) are recorded when a
real direct message from a phone JID produced no reply: not a message upsert,
not incoming, not a phone JID, no message candidate, too old, customer opted
out, replies disabled, no text, no provider message id. These are **not**
delivery rejections — the message was stored — so
`isInboundWebhookRejection()` excludes them by name even where the level is
`warn`. Counting a policy skip as a refusal would send the merchant to fix their
webhook when the setting that mattered was the reply policy.

The vocabulary is drift-gated: `inbound-webhook-diagnostics.test.mjs` asserts
every emitted name resolves back through `inboundWebhookOutcomeForEvent()`, that
names are unique across both platforms, and that each classification
(rejection / accepted) is the intended one. A new outcome that is not classified
fails the test rather than silently showing up as an untranslatable code.

## The delivery log

`mena_inbound_webhook_events` keeps one row per recorded attempt for a few days:

| Column | Notes |
| --- | --- |
| `workspace_id` | **Nullable.** A refused secret is rejected before the instance lookup, so the attempt cannot be attributed. |
| `platform` | `whatsapp`, `facebook`, `instagram`, or **null** when a Meta call was refused before its object type was read. Guessing `facebook` for an Instagram-only merchant would be worse than admitting the unknown. |
| `event` | The outcome name above. |
| `delivery_confirmed` | Whether this outcome proves the provider reached us. |
| `instance_name`, `account_id` | The identifiers the payload carried, used to find unattributed rows. |
| `context` | Identifiers and counters only. |
| `created_at` | Retention key. |

Two rules govern it:

- **Recording never breaks delivery.** `recordInboundWebhookAttempt()` swallows
  and warn-logs its own failures (`INBOUND_WEBHOOK_EVENT_NOT_RECORDED`). A
  provider retries on a 4xx/5xx, and losing a diagnostics row is always cheaper
  than losing a customer message. Callers fire and forget.
- **No message content.** Contexts carry event names, instance names, account
  ids and hashed conversation keys. Customer text is encrypted at rest for
  WhatsApp and must not be duplicated into a diagnostics table with a longer
  lifetime than the message.

Reading is `fetchInboundWebhookAttempts()`: attempts for the workspace, plus
rows matched by the instance names or account ids the merchant does have (that
is how a refused secret becomes visible), plus — for Meta, with
`includeUnattributed` — server-wide rows carrying neither workspace nor
platform. Those describe the deployment rather than one merchant, and the same
response already reports `appSecretConfigured` and `verifyTokenConfigured`, so
no reach into another workspace's data is added.

### Retention and bounds

| Variable | Default | Effect |
| --- | --- | --- |
| `INBOUND_WEBHOOK_EVENT_RETENTION_MS` | 604800000 (7 days) | How long an attempt is kept. Floored at one hour: a shorter window cannot answer "did anything arrive today". |
| `INBOUND_WEBHOOK_EVENT_QUERY_LIMIT` | 200 | Rows read per diagnostics call. Clamped to 1–1000. |

Unparseable or non-positive values fall back to the default; values that parse
but are merely too small or too large are clamped. `inbound-webhook-retention`
purges hourly in `app-workers.ts`, wherever workers run. A failed purge logs
`INBOUND_WEBHOOK_EVENT_PURGE_FAILED` and returns `-1` rather than reporting
"nothing to do".

## What the merchant sees

`artifacts/api-server/src/lib/inbound-diagnostics.ts` turns the counters and the
recorded attempts into issues, in this order. Each code is stable, so a client
can branch on it; the message is Arabic and already contains the fix.

WhatsApp (`GET /api/social/whatsapp/auto-reply-settings` → `inbound`):

| Code | Severity | Raised when |
| --- | --- | --- |
| `WHATSAPP_WEBHOOK_SECRET_MISSING` | critical | The secret is not configured server-side. |
| `WHATSAPP_WEBHOOK_URL_REQUIRED` / `_URL_INVALID` / `_URL_MISSING` | critical | The public callback URL cannot be determined. |
| `WHATSAPP_NO_WEBHOOK_ATTEMPTS` | critical | No direct messages **and** no recorded attempt: the provider is not calling. |
| `WHATSAPP_WEBHOOK_ATTEMPTS_REJECTED` | critical | Attempts arrive but every one was refused; the message names the last recorded outcome and its hint. |
| `WHATSAPP_NO_INBOUND_EVENTS` | warning | Attempts are accepted but no direct message was stored — group events, not customer DMs. |
| `WHATSAPP_AUTO_REPLIES_POSTPONED_FOR_LIMIT` | warning | Replies are waiting on a limit that lifts by itself (AI quota, provider configuration) rather than on the worker. |

Meta (`GET /api/social/meta-auto-replies` → `inbound`):

| Code | Severity | Raised when |
| --- | --- | --- |
| `META_APP_SECRET_MISSING` | critical | `FACEBOOK_APP_SECRET` unset. |
| `META_WEBHOOK_VERIFY_TOKEN_MISSING` | critical | `MENA_META_WEBHOOK_VERIFY_TOKEN` unset. |
| `META_SUBSCRIPTION_FAILED:<code>` | warning | A recorded subscription carries a last error. |
| `META_NO_SUBSCRIPTIONS` | warning | No subscription row at all. |
| `META_NO_WEBHOOK_ATTEMPTS` | critical | No inbox items **and** no recorded attempt. |
| `META_WEBHOOK_ATTEMPTS_REJECTED` | critical | Attempts arrive but every one was refused. |
| `META_NO_INBOUND_EVENTS` | warning | Attempts are accepted but nothing was stored — usually an account-id mismatch. |
| `META_AUTO_REPLIES_POSTPONED_FOR_LIMIT` | warning | Same, for Facebook and Instagram reply jobs. |

The response also carries `webhookAttempts`, a summary of the window
(`count`, `lastAt`, `lastEvent`, `lastHint`, `acceptedCount`, `rejectedCount`,
`lastRejectedEvent`, `lastRejectedHint`), and the mobile app renders it in the
delivery card: one sentence from `webhookAttemptHeadline()` plus fact rows from
`webhookAttemptFacts()` (`artifacts/menaflow-mobile/lib/inbound-webhook-copy.ts`).
Zero attempts produces no sentence, because the issue above already names that
case with its fix and a neutral sentence would soften a critical finding.

`autoReplyEvents.postponedByLimit` (and `autoReplyJobs.postponedByLimit` on the
Meta side) counts the waiting replies whose recorded code is one of the limits
that lift by themselves. Without it, "4 replies waiting" cannot be told apart
from "4 replies the worker has not reached yet", and the merchant has no reason
to look at their plan.

## Diagnosing in production

```sql
-- Did the provider call at all, and what did we do with it?
select platform, event, count(*), max(created_at) as last_at
from mena_inbound_webhook_events
where created_at > now() - interval '2 days'
group by 1, 2
order by 4 desc;

-- Refusals that could not be attributed to a workspace (rotated secret).
select event, instance_name, account_id, count(*), max(created_at)
from mena_inbound_webhook_events
where workspace_id is null
group by 1, 2, 3
order by 5 desc;
```

Then compare with the stored work: `mena_whatsapp_direct_messages` (direction
`inbound`), `mena_whatsapp_auto_reply_events`, `mena_meta_inbox_items` and
`mena_meta_auto_reply_jobs`. The combination decides the fix:

- **No attempts, no stored rows** → provider side. Re-register the webhook
  (`POST /api/social/whatsapp/reconfigure-webhook`), check the Meta app mode and
  callback URL, then send a test message.
- **Attempts, all refused** → our side, and the recorded event names the
  variable: secret mismatch, missing app secret, unknown instance, unknown
  account.
- **Attempts accepted, nothing stored** → the events are not the ones that
  produce work: group traffic rather than direct messages, or an account id that
  is not linked to a connection.
- **Stored, no reply** → read the `WHATSAPP_AUTO_REPLY_SKIPPED_*` reason, or the
  auto-reply job status. Delivery is fine; the reply policy or the AI quota is
  the subject.
