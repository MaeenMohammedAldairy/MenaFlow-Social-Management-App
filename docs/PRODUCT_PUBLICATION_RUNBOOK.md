# Product publication runbook

How a customer message becomes a published product post, what every status and
reason code means, and what to do when the chain stops. Read this before
touching the database: most "it is not working" reports are a gate doing its
job, and the fix is data or configuration, not code.

Everything here is observable. Each section names the table, the API endpoint or
the log event that shows the state, so a diagnosis can be reproduced instead of
guessed.

## 1. The chain

```
WhatsApp message (sync)
  → mena_whatsapp_product_extraction_jobs        (queued by group selection)
  → product-extraction worker                    (every 3s, 3 jobs per pass)
      gates: association → media → text/vision → AI extraction
  → mena_product_extraction_suggestions          (status: review)
  → merchant review in the catalog screen
  → mena_products                                (status: draft → active + verified_at)
  → POST /api/social/products/publish
  → mena_product_publication_jobs                (one row per product × channel)
  → product-publication worker                   (every 3s, 2 jobs per pass)
  → mena_posts + Meta Graph                      (status: published)
```

Two independent queues sit in front of it and starve it when they are broken:
WhatsApp sync (no messages ⇒ nothing to extract) and the inbound webhooks for
automatic replies (section 8). Check those first when a workspace reports
"nothing happens at all".

## 2. Extraction jobs

Table `mena_whatsapp_product_extraction_jobs`, one row per message
(`id` is a hash of workspace + message, so queueing is idempotent).

| `status` | Meaning | Next step |
| --- | --- | --- |
| `pending` | Queued, `next_run_at` reached or future | Nothing; the worker picks 3 per pass |
| `processing` | Claimed with `FOR UPDATE SKIP LOCKED` | Stuck > 10 min is reset to `pending` automatically |
| `waiting_media` | A source message has media that is still downloading (a retry is scheduled) | Requeued automatically when the download finishes. Media that gave up does **not** park here — see `failed` below |
| `waiting_association` | The message may belong to a content bundle that a human has not confirmed | Confirm or reject the association in the app; both messages are requeued |
| `complete` | Finished. `last_error` explains the outcome when there is no suggestion | `PRODUCT_TEXT_REQUIRED` means "no text and no readable image" |
| `review` | Reserved for suggestions that need attention | — |
| `failed` | 5 attempts exhausted | Read `last_error`, fix the cause, then requeue (§5) |

`stage` records how far the job got: `received` → `media` → `association` →
`extraction` → `persistence`. A job that fails at `extraction` reached the AI
call; one that fails at `persistence` got a usable answer and could not write
it, which is a different problem.

Retry policy: attempts < 5, delay `min(1h, 30s × 2^(attempt-1))`. Persistence
runs under the advisory lock `product-extraction:{workspaceId}` so two workers
cannot create the same draft.

**A media failure is terminal only when nothing readable is left.** The download
worker claims only messages whose `media_download_status` is `pending`, and a
retryable error keeps it `pending` with a scheduled attempt — so `failed` means
nothing will ever look at that media again. "The photo is gone" is not the same
as "the message is unreadable", though: the live workspace holds an offer whose
text is complete («سعر الطقم 3حبات 2300 ريال فقط») sent with four photos, and it
was imported twenty-four days after it was sent — WhatsApp no longer serves
media that old, so all four downloads gave up. `decideWhatsAppMediaGate()`
(`lib/product-extraction-media-policy.ts`) therefore answers `terminal` only when
the bundle holds **neither text nor stored media**; when text or a surviving
photo remains it answers `ready` and names the dead downloads in
`failedMediaSkipped`, which the worker logs as
`PRODUCT_EXTRACTION_PROCEEDING_WITHOUT_FAILED_MEDIA`. The product then shows the
photo as a field to complete instead of never appearing at all. Before that
distinction existed, such a job was parked in `waiting_media` forever: the queue
selects `pending` only, so no pass ever reached it again — three jobs sat like
that in production for twelve hours behind a `waitingMedia` count that read as
progress. Rows already parked there are released back to `pending` by
`releaseJobsWaitingOnTerminalMedia()` (at most once every five minutes over at
most 50 jobs), and the gate re-decides per bundle on the next pass: a bundle with
nothing readable left is failed there, a bundle with an offer in text is
extracted.

Repair is a real action rather than a database edit: re-running extraction calls
`resetFailedWhatsAppMedia()` (`lib/whatsapp-media-reset.ts`) for the messages it
is about to queue, putting their `failed` media back to `pending` with
`download_attempts` reset to zero. A message whose `source_media_payload` was
dropped is skipped and logged (`WHATSAPP_MEDIA_RESET_SKIPPED_NO_PAYLOAD`) because
there is nothing left to download from. When one specific message is requested
and its media was just reset, the job is created anyway so it parks in
`waiting_media` — the download worker requeues by message id, which needs a job
row to update.

**Old messages get one download attempt, and an honest failure.** WhatsApp stops
serving a message's media a few weeks after it was sent — measured on the live
workspace, where every row whose message was six to twelve days old at import
downloaded on the first attempt and every row twenty-four to twenty-five days old
burned all five attempts on `EVOLUTION_API_REQUEST_FAILED` and failed anyway.
`mediaDownloadAttemptLimit()` (`lib/whatsapp-media-expiry-policy.ts`) therefore
gives a message older than `MEDIA_UPSTREAM_EXPIRY_AGE_MS` (21 days) a single
attempt, and `mediaDownloadFailureReason()` records
`WHATSAPP_MEDIA_EXPIRED_UPSTREAM` — outside the retryable list, so nothing
schedules another attempt on a timer — instead of the transport error. The
catalog then reads «انتهت صلاحية الوسيط لدى واتساب — الرسالة أقدم من نحو ثلاثة
أسابيع» rather than «فشل التحميل», which used to invite retries that could never
work. The mobile copy carries the same window, pinned by a drift test. The
operational consequence: import history close to send time; media past the window
is unrecoverable at any attempt count, and a merchant who needs that product must
re-send the photo.

Queueing rules (`queueUnprocessedWhatsAppProductMessages`, also behind
`POST /api/social/products/extract-whatsapp`):

- at least one selected group in `mena_whatsapp_group_selections`
  (`selected = true`), matched by group or parent group;
- `message_status = 'received'`;
- non-empty `text_body` or `caption` — **or** `media_available`, but only when
  `PRODUCT_VISION_EXTRACTION_ENABLED` is set (§6);
- no row for that message in `mena_product_extraction_sources` yet;
- at most 200 messages per call, oldest first.

The text-or-media rule is `queueEligibilityPolicy()`
(`lib/product-extraction-queue-eligibility.ts`), and it exists because the
extractor reads text and never receives image bytes unless vision extraction is
on. Admitting a caption-less photo while vision is off creates a job that can
only end in `PRODUCT_TEXT_REQUIRED`; refusing it while vision is on means the
stored image is never read by anything. `media_available` deliberately includes a
`failed` download: queueing the message is what resets its media (§2 above), so
this is the only path that can repair an image-only message whose download gave
up. A message with neither text nor media is never eligible.

A message that has media but no text is only queued when its media is complete;
otherwise the call returns `queuedMessages: 0` and the job appears later through
the media requeue path.

Note that the historical sync also creates one job per imported received message
(`persistImportedMessage`), without the eligibility filter — which is why
caption-less photos have job rows at all. Queueing is therefore not manual-only
for newly imported messages; the button and the automatic pass are how *older*
messages get (re)queued and how settled jobs get retried.

**The queue fills itself.** Selecting a group is the merchant's opt-in to having
that conversation read, so the `product-extraction-queue` worker calls the same
function every 60 s for every workspace with a selection — ten workspaces per
pass, rotating through a cursor, so a large deployment is served round-robin
rather than always starting from the same first ten. Before this worker existed
the manual endpoint was the *only* caller, which meant a message arriving after
the merchant's last tap was never extracted at all: the catalog looked idle while
the queue was simply never filled.

The automatic pass is deliberately not the manual button
(`settledJobQueuePolicy()` in `lib/whatsapp-product-autoqueue-policy.ts`):

| | manual (`POST …/extract-whatsapp`) | automatic (worker) |
| --- | --- | --- |
| Messages that already have a job row | Selected again | Skipped |
| `failed` and `PRODUCT_TEXT_REQUIRED` jobs | Reset to `pending`, `attempts = 0` | Left alone |
| Workspace paused for an exhausted AI quota | Queue anyway (the merchant asked) | Skipped for this pass |

Each difference exists because the timer has no opinion about any particular
message. Reviving a settled job every minute would retry a durable failure
forever and spend the workspace's AI quota doing it; re-selecting messages that
already have jobs would keep hitting the oldest-200 cap on the same page and
never reach newer messages; and queueing over an active quota pause would insert
jobs at `next_run_at = now`, each failing on the same quota and re-pausing the
workspace, once per message. `WHATSAPP_PRODUCT_AUTOQUEUE_WORKER_ENABLED=false`
stops the pass and returns the chain to manual-only queueing.

Every pass logs `WHATSAPP_PRODUCT_AUTOQUEUE_PASS` with `workspaces`, `queued`,
`quotaPaused`, `errored` and the `cursor`, so "is anything being extracted at
all?" is one log query rather than an inference from the catalog.

### Extraction outcomes worth recognising

| `last_error` | Cause | Action |
| --- | --- | --- |
| `PRODUCT_TEXT_REQUIRED` | No text and vision extraction produced nothing (disabled, no stored image, or unreadable) | Expected for pure emoji/sticker messages. Enable `PRODUCT_VISION_EXTRACTION_ENABLED` if photo-only offers matter (§6), then re-run extraction: with the flag on the queue admits caption-less photos, so their stored images are finally read. Counted in `pendingJobs.noText` |
| `WHATSAPP_MEDIA_DOWNLOAD_PENDING` | Media still downloading | Automatic; the download worker requeues on completion |
| `WHATSAPP_MEDIA_DOWNLOAD_FAILED` | The download gave up for good: a non-retryable error, or 5 attempts spent. Written only when the bundle holds neither text nor stored media — otherwise extraction proceeds and the product lists the missing photo among its incomplete fields | Re-run extraction (`POST /api/social/products/extract-whatsapp`); it resets the media to `pending` with a fresh set of attempts and the job is requeued when the object is stored. Media of messages imported weeks after they were sent can never succeed: WhatsApp stops serving it |
| `WHATSAPP_ASSOCIATED_MESSAGE_UNAVAILABLE` | A bundled message row disappeared | Data problem; requeue the remaining message |
| `WHATSAPP_CONTENT_ASSOCIATION_REQUIRES_REVIEW` | Possible bundle, unconfirmed | Confirm/reject in the association screen; retries hourly meanwhile |
| `MISSING_AI_PROVIDER_KEY` | Neither `OPENAI_API_KEY` nor `GEMINI_API_KEY` set | Set a key and restart; jobs stay `pending` and are retried |
| `SUBSCRIPTION_LIMIT_REACHED:aiGenerations` | The workspace spent its monthly AI quota | Not a fault: the job stays `pending`, its attempt is returned, and the whole workspace queue is postponed (`PRODUCT_EXTRACTION_QUOTA_PAUSE_MS`, default 6h). It resumes by itself, or immediately after an upgrade |
| `AI_PROVIDER_COOLING_DOWN` | Both providers recently returned 429/402/401/403 | Wait for the cooldown (default 5 min, `AI_PROVIDER_COOLDOWN_MS`; credential errors wait 6× longer) |
| `PRODUCT_EXTRACTION_INVALID_JSON` / `_INVALID_RESPONSE` / `_INVALID_CANDIDATE` | The model answered outside the contract | Transient; the job retries. If it repeats for one message, the message is unusual — check the corpus (§9) |
| `PRODUCT_EXTRACTION_CROSS_GROUP_CANDIDATE` | The model mixed messages from different groups | Rejected by design; evidence must come from one bundle |
| `PRODUCT_VISION_INVALID_RESPONSE` / `PRODUCT_VISION_MEDIA_UNAVAILABLE` | Vision path failed | See §6 |

## 3. Suggestions and drafts

Table `mena_product_extraction_suggestions`, `status`:

- `review` — waiting for a human. Shown in the catalog screen with
  `missingFields`, `missingFieldMessages` and its `sources`.
- `draft_created` — a product row exists (`product_id`).
- `possible_duplicate` — the name or SKU matched an existing product;
  `possibleDuplicateProducts` lists the matches. Creating a draft anyway
  requires an explicit `product` body (a deliberate override).
- `dismissed` — the merchant rejected it.

A suggestion becomes a draft automatically only when **all** of these hold
(`shouldAutoCreateProductDraft`): `classification = 'product'`, a non-empty
name, the extraction is complete, it does not require manual review, and no
name/SKU clash. Vision-derived candidates always require manual review, so they
never auto-create anything.

Required fields for publication (`PRODUCT_PUBLICATION_REQUIRED_FIELDS`): `name`,
`price`, `currency`, `availability`, `media`. `description` is advisory — worth
completing, never a blocker. Price and currency are accepted only as a verified
pair quoted from the source text.

**How a currency is resolved** (`lib/product-currency-resolution.ts`). The quote
the model returns must contain the currency, and it is read strictly first:

1. A bare three-letter code (`YER`, `SAR`, `USD`, …) is taken as-is.
2. A currency named with its nationality is taken as that code — «ريال يمني» →
   `YER`, «الريال السعودي» → `SAR`. The definite article is optional on both
   halves.
3. Two different codes in one quote cancel to `null`. Conflicting evidence is
   never resolved by picking one.
4. Only then does the workspace's own country
   (`mena_workspaces.country`) settle an *ambiguous* word, and only when that
   country actually uses the word: «٤٥ ريال» in `YE` → `YER`, in `SA` → `SAR`, in
   `QA` → `QAR`. «٤٥ دولار» in `YE` still yields nothing, because guessing `USD`
   from a country that does not use it is invention. A country that is `null`
   (three of the five live workspaces) or that does not use the word changes
   nothing, so the behaviour is exactly as strict as it was before.

Arabic needs its own word boundaries here: JavaScript's `\b` is ASCII, so a
plain `/ريال/` matched inside «ريالة» and «البرازيل». The patterns are built from
a lookaround over the Arabic block instead.

A currency that came from the country rather than from the message is grounded
only as far as the word «ريال» goes — which rial came from a setting — so it
forces `manualReviewRequired` exactly like a vision candidate does
(`isCurrencyDerivedFromCountry()`). It can never become an automatic draft with a
price the merchant has not seen, and the model's own claimed `currency` must
still equal the resolved code.

Endpoints:

- `GET /api/social/products/whatsapp-extractions` →
  `{ suggestions, pendingJobs, suggestionCounts, pagination }`.
  - Query: `classification=product|not_product`, `status` (repeatable or comma
    separated, `review|draft_created|possible_duplicate`), `limit` (1–50,
    clamped), `offset` (0–10 000, clamped). An unknown classification or status
    is a `400`; `dismissed` cannot be requested at all. Out-of-range paging is
    clamped rather than rejected so an older client still gets a usable page.
    Rules in `lib/product-extraction-list-policy.ts`.
  - `pendingJobs` counts `pending`, `processing`, `waitingMedia`,
    `waitingAssociation`, `failed`, `quotaPaused` (pending jobs held back by an
    exhausted AI quota) and `noText` — jobs that completed with nothing readable
    (a photo with no caption, a sticker, a voice note). `noText` matters because
    those jobs are neither failed nor waiting, so nothing else on screen mentions
    them; six such messages sat on the live workspace invisible.
  - `suggestionCounts` is counted over the whole queue ignoring the page filters,
    so the catalog badge (`pendingProductReview`) does not change while the
    merchant moves between slices, and `pagination.nextOffset` is `null` on the
    last page.
  - This is the fastest single health check.
- `POST /api/social/products/extract-whatsapp` (`{ messageId? }`) → `202 { queuedMessages }`.
- `POST /api/social/products/whatsapp-extractions/:id/create-draft`.
- `POST /api/social/products/whatsapp-extractions/:id/dismiss`.
- `POST /api/social/products/whatsapp-extractions/:id/review` with
  `{ field, correct }`, `field ∈ classification | grouping | name | description |
  sku | price | currency | availability`. This is the feedback signal that
  feeds the benchmark corpus (§9) — encourage it.

A draft becomes publishable when a human saves it as `active`; that write stamps
`verified_at`. Publishing refuses anything else.

## 4. Publication jobs

Table `mena_product_publication_jobs`, one row per product × channel × account,
unique on `(workspace_id, request_key, product_id, channel, account_id)` — so
re-submitting the same `requestKey` is a no-op rather than a duplicate post.

| `status` | Meaning | Action |
| --- | --- | --- |
| `queued` | Waiting for the worker (2 per pass, every 3s) | — |
| `processing` | Publishing now; `posts.publish_results` is updated per channel as results arrive | Stuck > 10 min becomes `action_required` / `PUBLISH_RESULT_UNCERTAIN` |
| `published` | Done; `permalink` set, `post_id` links `mena_posts` | — |
| `failed` | Retriable server/provider fault | `POST /api/social/products/publish-jobs/retry` |
| `action_required` | Only the merchant can fix it (missing field, missing media, expired token, uncertain result) | Fix the cause, then re-submit a new publish request |

`failed` and `action_required` both raise a push alert
(`notifyPublishFailure`), which needs `EXPO_PUSH_ACCESS_TOKEN`; without it the
alert is dropped and the merchant only sees the state in the app.

### Publish request preconditions (`POST /api/social/products/publish`)

- `requestKey` matches `^[A-Za-z0-9._:-]{8,128}$`;
- 1–50 unique `productIds`;
- non-empty unique `targets`, each `{ channel: facebook|instagram, accountId }`;
- exactly one `mena_meta_connections` row for the workspace, and every target's
  `accountId` must equal that connection's `page_id` / `instagram_user_id`
  (Instagram also requires `instagram_username`);
- connection health: `META_PERMISSIONS_UNVERIFIED`, `META_TOKEN_EXPIRED` or
  `META_PERMISSIONS_MISSING:<scopes>` → `409`;
- every product `active` with `verified_at` → otherwise `409 PRODUCTS_NOT_APPROVED`;
- no publication blockers → otherwise `409 PRODUCT_FIELDS_INCOMPLETE` with
  `incompleteProducts[]` naming each missing field in Arabic.

Success is `202` with `{ requestKey, jobs, summary }`; `summary` counts
`total`, `successful`, `failed`, `inProgress`, `needsAction`. Poll
`GET /api/social/products/publish-jobs?requestKey=…` for the same shape.

### `action_required` reasons

`PRODUCT_NOT_AVAILABLE`, `PRODUCT_FIELDS_INCOMPLETE`,
`PRODUCT_POST_SOURCE_UNAVAILABLE`, `PRODUCT_MEDIA_UNAVAILABLE`,
`PRODUCT_EXTERNAL_MEDIA_NOT_SUPPORTED`, `META_ACCOUNT_NOT_CONNECTED`,
`INSTAGRAM_MEDIA_REQUIRED`, `INSTAGRAM_CAROUSEL_REQUIRES_2_TO_10_ITEMS`,
`INSTAGRAM_MEDIA_TYPE_UNSUPPORTED`, `INSTAGRAM_IMAGE_JPEG_REQUIRED`,
`INSTAGRAM_VIDEO_MP4_REQUIRED`, `FACEBOOK_NO_SUPPORTED_MEDIA`,
`WHATSAPP_POST_MEDIA_UNAVAILABLE`, `PUBLISH_RESULT_UNCERTAIN`.

Anything matching that list is `action_required`; every other error is `failed`
and retriable. Arabic wording for alerts lives in
`lib/notification-content.ts` (`publishFailureLabel`) — an unknown code falls
back to generic wording rather than leaking it to a lock screen, while the raw
value stays in `last_error` and the logs.

`PUBLISH_RESULT_UNCERTAIN` deserves care: the post may exist on Meta. Check the
page/Instagram account before retrying, otherwise the merchant gets a duplicate.

## 5. Diagnosis playbook

Fastest first, all read-only.

1. **Is anything arriving?**
   `GET /api/social/products/whatsapp-extractions` → `pendingJobs`. All zeros
   with no suggestions means the queue is empty, not broken: check group
   selection and sync.
2. **What is stuck?**
   ```sql
   select status, stage, last_error, count(*), max(updated_at)
   from mena_whatsapp_product_extraction_jobs
   where workspace_id = '<ws>'
   group by 1, 2, 3 order by 4 desc;
   ```
3. **Which suggestion is blocked and why?**
   ```sql
   select s.id, s.status, s.classification, s.extracted_data->>'name' as name,
          p.status as product_status, p.verified_at, p.price, p.currency,
          p.availability, jsonb_array_length(coalesce(p.media_urls,'[]'::jsonb)) as media
   from mena_product_extraction_suggestions s
   left join mena_products p on p.id = s.product_id
   where s.workspace_id = '<ws>' order by s.created_at desc limit 20;
   ```
4. **Did publishing stop, and where?**
   ```sql
   select status, last_error, count(*), max(updated_at)
   from mena_product_publication_jobs
   where workspace_id = '<ws>' group by 1, 2 order by 3 desc;
   ```
5. **Requeue a single message** after fixing media or an association:
   `requeueWhatsAppProductMessage` runs automatically from the media-download and
   association paths. Manually, `POST /api/social/products/extract-whatsapp`
   with `{ messageId }` re-queues it (it also clears `PRODUCT_TEXT_REQUIRED`
   completions, so a message can be reconsidered once vision is enabled).
6. **Retry failed publications:** `POST /api/social/products/publish-jobs/retry`
   with `{ jobIds: [...] }` (≤ 50). Only `failed` rows are requeued; `attempts`
   resets to 0. `action_required` rows are not retried by design — fix the data
   and submit a new publish request with a new `requestKey`.
7. **Logs.** Server logs carry `workspaceId`, `messageId`, `jobId`, `productId`,
   `channel`, `reason`, `attempt`. Filter on `reason` for the codes above; the
   worker logs `Product publication job failed` and
   `WhatsApp product extraction job failed` with those fields.

## 6. Vision extraction (photo-only offers)

Off unless `PRODUCT_VISION_EXTRACTION_ENABLED` is `true`/`1`/`yes`. When a
bundle has no text at all, stored images are read and the product is extracted
from the text visible in them.

Limits: at most 3 images (`MAX_VISION_IMAGES`), 12 MB per stored source
(`MAX_VISION_SOURCE_BYTES`), resized so the longest edge is 1024 px
(`VISION_IMAGE_EDGE`), visible text truncated at 6000 characters. The model
returns `{ visibleText, products[], nonProductMessageIds[] }` with
`temperature: 0` and a 60 s timeout.

Vision candidates are always `manualReviewRequired`, so they land in `review`
and never become automatic drafts. Grounding still applies: a quoted price or
currency survives only if the quote appears in the visible text and holds
exactly one price. Do not loosen these gates to make a case pass — that is what
the corpus in §9 is for.

## 7. AI provider behaviour

Order is OpenAI then Gemini (`planAiProviders`). A provider is skipped when its
key is missing or it is cooling down after a throttling/credential error
(`_429`, `_402`, `OPENAI_HTTP_401|403|429`, `SUBSCRIPTION_LIMIT_REACHED*`).
Cooldown defaults to 5 minutes (`AI_PROVIDER_COOLDOWN_MS`); credential errors
wait six times longer (`AI_PROVIDER_CREDENTIAL_COOLDOWN_MS`). With no usable
provider the job gets `MISSING_AI_PROVIDER_KEY` or `AI_PROVIDER_COOLING_DOWN`
and is retried later — nothing is lost.

Extraction can be pinned to specific models without touching other features:
`AI_EXTRACTION_OPENAI_MODEL` and `AI_EXTRACTION_GEMINI_MODEL` override
`OPENAI_MODEL` / `GEMINI_MODEL` for this purpose only (the same pattern works
for any purpose: `AI_<PURPOSE>_<PROVIDER>_MODEL`). Pin a cheaper/faster model
here when quota errors are frequent.

## 8. When nothing arrives at all (inbound webhooks)

Extraction and automatic replies both start from an inbound event. If the
workspace shows zero messages, zero suggestions and zero replies, suspect
delivery, not the queues.

- `GET /api/social/whatsapp/auto-reply-settings` returns an `inbound` block:
  `deliveryConfirmed`, `lastDirectMessageAt`, `directMessageCount`,
  `autoReplyEvents {queued, sent, failed, other}`, `webhookSecretConfigured`,
  `webhookUrl`, and Arabic `issues[]`.
- `GET /api/social/meta-auto-replies` returns the Meta equivalent: inbox counts
  per platform, `lastInboxItemAt`, `autoReplyJobs`, the recorded `subscriptions`
  with `lastErrorCode`, and whether `MENA_META_WEBHOOK_VERIFY_TOKEN` and
  `FACEBOOK_APP_SECRET` are set.
- `POST /api/social/whatsapp/reconfigure-webhook` re-registers the Evolution
  webhook and answers with the exact URL registered. Use it after rotating
  `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` or moving the API domain; the error names
  the variable that has to change.
- `POST /api/social/meta-inbox/webhook-subscriptions` renews the Meta
  subscriptions (`503 META_WEBHOOK_NOT_CONFIGURED` without a verify token,
  `409 META_REAUTH_REQUIRED` when the token is expired or lacks permissions).

Every webhook decision is logged under a named event
(`WHATSAPP_WEBHOOK_*`, `META_WEBHOOK_*`, `WHATSAPP_AUTO_REPLY_SKIPPED_*`) with
identifiers only — never message text. Grep those names to see whether the
provider called at all and, if it did, why the event was dropped.

The mobile panels surface all of this: the collapsed channel card reads
«مفعّل بلا استقبال» when replies are on but no event has ever arrived, and the
open card lists the issues with the repair button.

## 9. Regression corpus

Merchant review feedback (`/review`) is the ground truth for extraction quality.
Export it with:

```bash
DATABASE_URL=… corepack pnpm run db:export:product-review-fixtures \
  [--dry-run] [--workspace=<id>] [--out=<path>]
```

It writes `artifacts/api-server/src/lib/product-extraction.reviewed.jsonl`,
which `product-extraction-review-corpus.test.mjs` replays against the current
extractor (the test skips itself while the file is absent). Synthetic cases live
in `product-extraction.synthetic.jsonl` and always run. Before changing a
prompt, a gate or a normaliser, add the failing case to the corpus so the
behaviour stays fixed.

## 10. Environment reference

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_PRODUCT_EXTRACTION_WORKER_ENABLED` | `false` stops the extraction worker |
| `WHATSAPP_PRODUCT_AUTOQUEUE_WORKER_ENABLED` | `false` stops the pass that fills the queue on its own (§2); queueing becomes manual-only again |
| `PRODUCT_EXTRACTION_QUOTA_PAUSE_MS` | How long the queue waits after the AI quota runs out (floored at 5 minutes) |
| `WHATSAPP_SYNC_GROUP_CONCURRENCY`, `WHATSAPP_SYNC_RUN_BUDGET_MS`, `WHATSAPP_SYNC_HEARTBEAT_MS` | Bounds for the historical sync that feeds this chain — see `docs/WHATSAPP_SYNC.md` |
| `PRODUCT_PUBLICATION_WORKER_ENABLED` | `false` stops the publication worker |
| `MENA_WORKER_NAME` | Run a single worker (`product-extraction`, `product-publication`, …) instead of `all` |
| `PRODUCT_VISION_EXTRACTION_ENABLED` | Opt into photo-only extraction |
| `OPENAI_API_KEY`, `GEMINI_API_KEY` | At least one is required |
| `OPENAI_MODEL`, `GEMINI_MODEL` | Default models |
| `AI_EXTRACTION_OPENAI_MODEL`, `AI_EXTRACTION_GEMINI_MODEL` | Per-purpose override for extraction |
| `AI_PROVIDER_COOLDOWN_MS`, `AI_PROVIDER_CREDENTIAL_COOLDOWN_MS` | Backoff after throttling / credential errors |
| `EXPO_PUSH_ACCESS_TOKEN` | Required for publish-failure alerts |
| `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` | Inbound WhatsApp webhook auth |
| `WHATSAPP_EVOLUTION_WEBHOOK_URL`, `EXPO_PUBLIC_DOMAIN` | Public webhook URL resolution |
| `MENA_META_WEBHOOK_VERIFY_TOKEN`, `FACEBOOK_APP_SECRET` | Meta webhook verification and signature check |

Migrations are applied manually (`supabase/migrations/…`); the API never
migrates at startup. See `docs/PRODUCT_CATALOG.md` for catalog semantics and
`docs/WHATSAPP_SYNC.md` for the sync path that feeds this chain.
