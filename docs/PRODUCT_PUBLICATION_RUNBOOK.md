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
| `waiting_media` | A source message has media that is not `stored` yet | Requeued automatically when the download finishes; otherwise see §4 |
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

Queueing rules (`queueUnprocessedWhatsAppProductMessages`, also behind
`POST /api/social/products/extract-whatsapp`):

- at least one selected group in `mena_whatsapp_group_selections`
  (`selected = true`), matched by group or parent group;
- `message_status = 'received'`;
- non-empty `text_body` or `caption`;
- no row for that message in `mena_product_extraction_sources` yet;
- at most 200 messages per call, oldest first.

A message that has media but no text is only queued when its media is complete;
otherwise the call returns `queuedMessages: 0` and the job appears later through
the media requeue path.

### Extraction outcomes worth recognising

| `last_error` | Cause | Action |
| --- | --- | --- |
| `PRODUCT_TEXT_REQUIRED` | No text and vision extraction produced nothing (disabled, no stored image, or unreadable) | Expected for pure emoji/sticker messages. Enable `PRODUCT_VISION_EXTRACTION_ENABLED` if photo-only offers matter (§6) |
| `WHATSAPP_MEDIA_DOWNLOAD_PENDING` | Media still downloading | Automatic; the download worker requeues on completion |
| `WHATSAPP_MEDIA_DOWNLOAD_FAILED` | Evolution could not serve the file | Re-run the media download; the job is requeued when the object is stored |
| `WHATSAPP_ASSOCIATED_MESSAGE_UNAVAILABLE` | A bundled message row disappeared | Data problem; requeue the remaining message |
| `WHATSAPP_CONTENT_ASSOCIATION_REQUIRES_REVIEW` | Possible bundle, unconfirmed | Confirm/reject in the association screen; retries hourly meanwhile |
| `MISSING_AI_PROVIDER_KEY` | Neither `OPENAI_API_KEY` nor `GEMINI_API_KEY` set | Set a key and restart; jobs stay `pending` and are retried |
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
pair quoted from the source text; a message saying «45 ريال» without a currency
the extractor can map yields a null price, which then shows up as a blocker.

Endpoints:

- `GET /api/social/products/whatsapp-extractions` → `{ suggestions, pendingJobs }`
  where `pendingJobs` counts `pending`, `processing`, `waitingMedia`,
  `waitingAssociation`, `failed`. This is the fastest single health check.
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
