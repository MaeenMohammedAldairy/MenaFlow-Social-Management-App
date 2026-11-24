# Production deployment

MenaFlow is deployed as separate services: an Express API, PostgreSQL, and an Expo application. No hosting provider or production deployment is configured by this repository, so these steps prepare and verify a deployment but do not deploy it.

## API service

Use Node.js 24 and pnpm with the committed lockfile:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run start
```

Meta automatic replies and Meta order-confirmation messages run inside the API
process. Set `META_AUTO_REPLY_WORKER_ENABLED=false` to disable automatic
conversation replies; the order-confirmation queue remains active.
All enabled background queue workers also start inside the API process. No
separate worker service or change to the API start command is required. The
standalone command `pnpm --filter @workspace/api-server run start:worker`
remains available for isolated use; do not run it alongside the API process,
because both processes would consume the same queues. `MENA_WORKER_NAME` only
selects a worker when using that standalone command; the API starts all enabled
workers. Its supported values are
`auto-reply-recovery`, `whatsapp-auto-replies`,
`whatsapp-order-confirmations`,
`whatsapp-direct-message-retention`, `meta-webhook-subscriptions`,
`product-extraction`, `product-publication`, `media-download`,
`media-thumbnails`, or `whatsapp-marketing` to run a single worker family.
Keep one replica for `meta-webhook-subscriptions` until its reconciliation
work is protected by a cross-process claim.
`GET /api/readyz` returns a `workers` array describing every started loop
(`lastRunFinishedAt`, `lastRunDurationMs`, `consecutiveErrors`, `lastError`,
`stale`). A worker that stops running is invisible in request metrics, so point
an uptime monitor at the response and alert when a worker is `stale` or its
`consecutiveErrors` keeps climbing. The `whatsapp-auto-replies` worker also
stops answering a chat that receives more than
`WHATSAPP_AUTO_REPLY_HOURLY_LIMIT` automatic replies in an hour (default 12,
maximum 100) to keep two automated systems from answering each other forever;
the Meta worker applies the same ceiling per conversation through
`META_AUTO_REPLY_HOURLY_LIMIT`. A WhatsApp message older than
`WHATSAPP_AUTO_REPLY_MAX_AGE_MINUTES` (default 720, maximum 10080) is no longer
answered automatically, so a delayed queue cannot reply to yesterday's question.
Turning auto replies off drops the replies already queued for that workspace
instead of failing them one by one while the worker drains the queue.
A Meta automatic reply that cannot be generated is now **paused**, not failed:
`SUBSCRIPTION_LIMIT_REACHED:aiGenerations` (the workspace used its monthly AI
quota), `WORKSPACE_SUBSCRIPTION_MISSING`, `WORKSPACE_SUBSCRIPTION_PLAN_INVALID`,
`MISSING_OPENAI_KEY`, `MISSING_GEMINI_KEY`, `MISSING_AI_PROVIDER_KEY` and
`AI_MODEL_NAME_INVALID` are recorded as `skipped` with the code, so the mobile
inbox can explain the cause and offer a retry instead of claiming the send
failed. Nothing was sent to Meta in those cases, so `POST
/api/social/meta-inbox/items/:id/auto-reply` may requeue the reply; entries whose
outcome is `unknown` are deliberately refused to prevent a second delivery.
Raise the plan (or wait for the monthly reset, UTC) to clear the quota pause;
messages older than the 24-hour reply window are skipped again on retry.

The `whatsapp-auto-replies` worker claims WhatsApp reply events from a durable
queue. Leases prevent concurrent sends for the same event. Recovery requeues
expired pre-send work and marks expired in-flight sends unknown without
resending them.
The `whatsapp-order-confirmations` worker sends one transactional WhatsApp
confirmation after an authorized merchant changes a WhatsApp-origin draft to
confirmed. It never resends an ambiguous send result.
The `whatsapp-direct-message-retention` worker removes expired private WhatsApp
messages in bounded batches; keep it enabled wherever the direct inbox is used.

Evolution media downloads can run through the API's inline loop with
`WHATSAPP_MEDIA_DOWNLOAD_INLINE_WORKER_ENABLED=true`; the regular API worker
loop skips that same queue when the inline loop is enabled.

### Owner console

The internal owner dashboard is served by this same API process at `/owner`
(no extra host, no extra database migration). It is built by the API's own build
step (`artifacts/api-server/build.mjs`), so hosts that only run
`pnpm --filter @workspace/api-server build` still ship it; set
`MENA_SKIP_OWNER_CONSOLE_BUILD=1` to opt out. Enable access with
`MENA_OWNER_CONSOLE_TOKEN` and/or `MENA_OWNER_USER_IDS`. Without those variables
every `/api/owner/*` route answers 404. See `docs/OWNER_CONSOLE.md` for the security model and endpoints.

The API build script replaces only `artifacts/api-server/dist`. The mobile package's `build` script removes `artifacts/menaflow-mobile/static-build` and clears Metro caches; inspect or back up those outputs before running it.

Configure these API variables in the hosting provider's secret/configuration manager:

- `NODE_ENV=production`, `PORT`, `DATABASE_URL`
- `CLERK_SECRET_KEY`, and `CLERK_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
- `ENCRYPTION_KEY` (at least 32 characters); optionally `ENCRYPTION_KEY_PREVIOUS` during a controlled rotation only
- `MENA_CORS_ORIGINS`: comma-separated exact HTTPS origins for browser clients. Native mobile requests without an `Origin` header remain supported.
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and `MENA_FACEBOOK_REDIRECT_URI` (public HTTPS callback) when enabling Meta
- `MENA_META_WEBHOOK_VERIFY_TOKEN` (a private random string shared only with the Meta App Dashboard) when enabling Meta messages and comments
- `WHATSAPP_MEDIA_DOWNLOAD_INLINE_WORKER_ENABLED=true` to process Evolution media-download jobs inside the API Web Service
- `MENA_FACEBOOK_WEB_ORIGINS` for explicitly allowed browser return origins where applicable
- `MENA_PUBLIC_MEDIA_BASE_URL` (public HTTPS API origin) when publishing media that Meta must fetch
- `WHATSAPP_EVOLUTION_BASE_URL`, `WHATSAPP_EVOLUTION_API_KEY`, `WHATSAPP_EVOLUTION_WEBHOOK_SECRET`, and `WHATSAPP_EVOLUTION_WEBHOOK_URL` (public HTTPS callback) when enabling Evolution. The webhook secret is **required** in production and must be a dedicated random value **different from** `WHATSAPP_EVOLUTION_API_KEY`: this API stores it in the provider's webhook configuration, so reusing the admin key would widen a webhook leak into full control over every WhatsApp instance. Development may still fall back to the API key.
- `GEMINI_API_KEY` and/or `OPENAI_API_KEY` when enabling AI generation

Production startup rejects disabled Clerk auth, missing Clerk keys, short encryption keys, short supplied previous keys, malformed/non-HTTPS CORS origins, and — when `WHATSAPP_EVOLUTION_API_KEY` is set — a missing `WHATSAPP_EVOLUTION_WEBHOOK_SECRET` or one equal to the admin key. Meta media and Evolution callbacks do not use app-domain, localhost, or Docker-host fallbacks in production. Keep database and provider credentials server-side; only `EXPO_PUBLIC_*` values are embedded into the app.

### Subscription plans

Apply `supabase/migrations/20261104001000_workspace_subscriptions.sql` before deploying the plan and quota screens. Existing workspaces are assigned the free plan; newly created workspaces receive a seven-day Growth trial, then fall back to Free. Monthly post limits are enforced in PostgreSQL for all post creation paths, and AI-generation limits are enforced by the API. The current USD catalog is Free (10 posts, 10 AI generations, 2 channels), Starter ($9; 100 posts, 100 AI generations, 3 channels), and Growth ($29; 500 posts, 500 AI generations, 3 channels).

Payment collection and plan changes are intentionally disabled until a payment provider is selected and configured. Do not present paid plans as purchasable until checkout, payment webhooks, cancellation, and renewal handling have been integrated and verified.

### Workspace deletion requests

Apply `supabase/migrations/20261111001000_workspace_deletion_requests.sql`
before deploying the workspace settings update. Owners can record one
workspace deletion request; this stores an auditable pending request only. It
does not export data, notify staff, schedule deletion, or remove database or
media objects. Handle requests manually only after a complete export and
verified cleanup plan for all workspace data and storage providers.

### Internal order management

Apply `supabase/migrations/20261109001000_order_management.sql`,
`supabase/migrations/20261110001000_inventory_delivery.sql`, and
`supabase/migrations/20261112002000_meta_order_confirmation_notifications.sql`
before deploying the order API and mobile app. Meta order intake asks for the
remaining order details together, treats the preferred delivery day/time as
optional, and sends a draft summary (with one product image when available).
When a Meta-sourced order is confirmed, its customer confirmation is queued in
the existing API process; no separate worker service is introduced. The queue
tracks send outcomes, retries rate limits, and marks expired messaging windows
or ambiguous send results for manual follow-up instead of risking duplicate
messages. Validate the migrations and order isolation on a staging database
before production rollout.

### Meta permissions for comments and messaging

In the Meta App Dashboard, enable and complete any required review/advanced access for the permissions used by the product. The Facebook connection flow requests `pages_manage_engagement`, `pages_messaging`, and `pages_manage_metadata`; the Instagram connection flow requests `instagram_manage_comments`, `instagram_manage_messages`, and `pages_manage_metadata`. Existing publishing, insights, and page-selection scopes remain requested for both flows. In particular, Instagram Messaging through Facebook Login requires `instagram_manage_messages`; Instagram Messaging webhooks also require `instagram_basic` and `pages_manage_metadata`.

OAuth consent is not treated as proof that a permission was granted. The API records the permissions Meta reports and verifies the Page token. Existing connections without recorded verification, connections missing the selected integration's permissions, and expired tokens are marked for reauthorization in Sources. Apply the Meta OAuth permissions migration before deploying this behavior, and reauthorize existing Meta connections to establish their actual grants.

### Meta inbox webhooks and replies

The authenticated inbox is available in the app's **الوارد** tab. Before receiving events:

1. Configure `MENA_META_WEBHOOK_VERIFY_TOKEN` in the API secret manager. Use a long random value and enter the same value in the Meta App Dashboard; never commit it.
2. Configure the public HTTPS callback shown in the inbox as the Meta Webhooks callback URL. The callback uses `MENA_PUBLIC_MEDIA_BASE_URL` when set, otherwise the host from `MENA_FACEBOOK_REDIRECT_URI`. For local testing, run `pnpm dev:instagram`, keep its terminal open, and update the Meta callback whenever the temporary Cloudflare Tunnel URL changes. Subscribe the app to the **Page** fields `feed`, `messages`, and `messaging_postbacks`, and the **Instagram** fields `comments` and `messages`.
3. After a Page or Instagram account is connected, the API automatically subscribes it to the required webhook fields. A background reconciliation in the worker service retries failed subscriptions for existing connections. Keep one replica for this worker until reconciliation has a cross-process claim. Confirm the app has the required access/review in Meta; permission or token failures are recorded in the subscription status.
4. Send a test message and comment. Incoming events are signature-verified using `FACEBOOK_APP_SECRET`; duplicate webhook deliveries are ignored.

Apply `20261025002000_meta_inbox.sql` before deploying inbox routes. The webhook callback is unauthenticated by design for Meta delivery; its GET verification token and POST HMAC signature are validated. Inbox reads and replies remain authenticated and workspace-scoped. Replies are subject to Meta messaging windows, account eligibility, app review, and each platform's policies. A Meta permission grant alone does not prove app review or webhook delivery is active.

Apply `20261124010000_inbound_webhook_events.sql` before deploying the inbound
delivery log. Every webhook decision — accepted, refused, or ignored — is then
recorded for seven days in `mena_inbound_webhook_events` and surfaced on the
reply-settings screens, which is what separates "Meta never called" from "Meta
called and we refused it" without log access. The
`inbound-webhook-retention` worker purges hourly;
`INBOUND_WEBHOOK_EVENT_RETENTION_MS` and `INBOUND_WEBHOOK_EVENT_QUERY_LIMIT`
bound the window and the read. See `docs/INBOUND_DELIVERY_DIAGNOSTICS.md`.

The inbox displays HTTPS image previews and links to video or other attachments when Meta includes media URLs in the event. If a preview cannot load, the UI offers the media link as a fallback; media is not copied to application storage, so availability remains subject to Meta's URL lifetime. The inbox also shows the timestamp of the latest stored message or comment to help verify event delivery.

### Meta automatic replies

Automatic replies are enabled by selecting one or more channel controls for Facebook Messenger, Facebook comments, Instagram Direct, or Instagram comments; selecting no channels disables automation. Channel changes are saved together from the inbox settings dialog, and saving requires at least one selected channel unless it is disabling a previously enabled automation. Disabling all channels stops new webhook jobs and cancels queued jobs; in-flight work rechecks the setting before sending. Comment replies are public. New conversations may receive a brief greeting; later customer messages are instructed to receive a direct answer without repeating the greeting. The worker loads up to 30 recent inbox events for the same conversation, giving the AI the latest 20 turns so short follow-ups (such as agreeing to receive photos) can be interpreted using the product discussed earlier. For comments, it first resolves the Meta post ID to a published post saved in the same workspace and platform. For private messages, it first searches recent saved published posts for a unique title/body match. If neither lookup finds a unique relevant post, the worker uses the connected Facebook page or Instagram account to search the 50 most recent published posts, provided the corresponding read permission (`pages_read_engagement` or `instagram_basic`) was actually granted. For comments it looks up the exact parent post ID, including posts older than the recent feed window. It extracts the post text and available photo URLs from the platform response; when a customer sends an image and no text match is found, up to three recent candidate post photos are compared visually with the customer image. The matched post content is supplied as factual context. When relevant facts are absent, ambiguous, inaccessible, or unavailable from Meta, the reply is instructed to direct the customer to the connected account's contact route rather than guess. There is no separate product catalog in the current schema, so only details present in saved or fetched published posts or legacy business facts can be used. Image attachments from Meta CDN are downloaded with size/type limits for visual analysis; when a customer asks for product photos and matching post images are available, the worker sends the images as Messenger/Instagram attachments followed by a short text reply, instead of sending the page link. Customer messages and recent same-conversation inbox turns are sent to the configured AI provider. The worker uses only workspace-scoped data and never treats customer text as system instructions.

The durable queue prevents duplicate webhook events from creating duplicate jobs. AI generation may retry up to three times on transient provider errors. A reply blocked by a limit that lifts by itself — an exhausted AI quota, a missing provider key, an unreadable subscription row — is not failed and not skipped: the job stays `queued`, its attempt is handed back, and `next_run_at` moves out by `META_AUTO_REPLY_QUOTA_PAUSE_MINUTES` (default 30, clamped to 5–120, the same bounds the WhatsApp queue uses). The 24-hour reply window checked before generation bounds the wait, so a limit that never lifts ends with the job skipped as window-expired and the conversation handed to a human rather than a reply sent a day late. Jobs recorded as `skipped` before this behaviour existed stay terminal and remain requeueable from the inbox. A send whose result is ambiguous is marked `unknown` and is not retried automatically, preventing accidental duplicate replies. Private-message automation skips events older than the 24-hour messaging window; Meta remains authoritative and may reject sends due to app review, permissions, or other platform limits. The inbox shows queued, sending, failed, and uncertain outcomes while preserving manual replies.

The inbox settings also provide a manual action to queue replies for previously received comments. It only lists published posts linked to active, verified products on platforms where comment automation is already ready and enabled. The action uses comments already stored in the workspace inbox (it does not backfill comment history from Meta), excludes replied or already-queued comments and comments outside the current 24-hour worker window, and limits each batch to 20 comments. The user must select posts and confirm before jobs are queued.

Apply `20261026001000_meta_auto_replies.sql` before enabling this feature. Automatic replies remain disabled by default in workspace settings. The API process runs their inline queue unless `META_AUTO_REPLY_WORKER_ENABLED=false`; that flag does not disable Meta order-confirmation messages. Production should monitor failed/unknown reply and confirmation outcomes. No separate AI key is introduced: the existing `OPENAI_API_KEY` and/or `GEMINI_API_KEY` configuration is reused.

The API exposes unauthenticated `GET /api/healthz` for liveness and `GET /api/readyz` for PostgreSQL readiness. Configure the platform health checks accordingly. The API does not apply database schema changes on startup; review and apply any required schema migration separately against the intended database.

### WhatsApp direct-message inbox and retention

Apply `supabase/migrations/20261113001000_whatsapp_direct_messages.sql` before
deploying the direct-message inbox, then apply
`20261113002000_whatsapp_order_intake.sql` and
`20261113003000_whatsapp_auto_reply_queue.sql` and
`20261113004000_whatsapp_order_confirmations.sql` before enabling WhatsApp
order intake, durable auto replies, or order confirmations. Private message text and WhatsApp JIDs are
encrypted with the application `ENCRYPTION_KEY`; conversation lookup uses
workspace-scoped HMAC keys. Messages expire 90 days after receipt, and the
`whatsapp-direct-message-retention` worker purges expired rows in bounded
batches. Keep `ENCRYPTION_KEY_PREVIOUS` configured for the full retention
window when rotating keys so conversations indexed under the previous key
remain discoverable until their messages expire. The inbox and reply routes
require workspace authentication; uncertain sends are not retried until an
operator confirms the message did not arrive.

An automatic reply that could not be generated because of a limit that lifts by
itself — an exhausted AI quota, a missing provider key, an unreadable plan — is
not failed. The event stays `queued`, its attempt is handed back, and
`next_run_at` moves out by `WHATSAPP_AUTO_REPLY_QUOTA_PAUSE_MINUTES` (default 30,
clamped to 5–120), so the reply is sent once the limit clears. The loop is
bounded by the reply window the queue already enforces
(`WHATSAPP_AUTO_REPLY_MAX_AGE_MINUTES`, 12 hours): past that age the event is
dropped as `AUTO_REPLY_WINDOW_EXPIRED` and the conversation waits for a human,
so a quota that never lifts cannot leave an event queued forever or deliver a
reply half a day late.

The same delivery log records every Evolution webhook decision, including the
refusals that cannot be attributed to a workspace because the secret check
happens first. `docs/INBOUND_DELIVERY_DIAGNOSTICS.md` covers the outcome
vocabulary, the retention bounds, and the queries that decide which side of the
webhook a delivery failure is on.

## Expo application

Set `EXPO_PUBLIC_DOMAIN` to the public HTTPS API origin and configure `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` before creating a production app build. A production client build now fails early if the API origin is missing or points to localhost/non-HTTPS. `EXPO_PUBLIC_AUTH_DISABLED` is a development-only setting and must not be used to disable production authentication.

The repository does not include a configured EAS project or a verified hosting target for the mobile/web app. Choose the intended Expo build/export and hosting flow, then validate the generated client against the deployed API before release.

Signed-out visitors now land on the marketing page (`components/MarketingLandingPage.tsx`) on both web and native, and `app/+html.tsx` supplies its title, description, and social preview tags. Set `EXPO_PUBLIC_SITE_URL` to the public origin of the web build so `og:image` resolves to an absolute URL, and set `EXPO_PUBLIC_OG_IMAGE_URL` when a dedicated 1200x630 share card exists (otherwise the app icon is used). Without `EXPO_PUBLIC_SITE_URL` the preview image stays relative and some crawlers will not render it.

Only the marketing route is public. Do not publish dashboard routes in a sitemap or claim they are indexable public content. Add `robots.txt` or a sitemap only when the hosting target is known and the public routes can be verified.

## Key rotation and existing Meta connections

Keep the currently configured `ENCRYPTION_KEY` unchanged until the target database and stored tokens have been reviewed. If the previous encryption key is safely available, set it as `ENCRYPTION_KEY_PREVIOUS` in the deployment secret manager while the new key is `ENCRYPTION_KEY`; normal account-detail and publishing requests will re-encrypt decryptable tokens with the current key. Verify all connections are usable and rotated before removing the previous key. If the old key is unavailable or a stored value is not a supported ciphertext, the affected account needs to be reconnected. Never put either key in source control or logs.

## Deployment status

The repository changes and local checks do not prove a deployment. Confirm the API and Expo services, provider callbacks, database readiness, and real Meta/Evolution operations in a staging environment before calling a release deployed.
