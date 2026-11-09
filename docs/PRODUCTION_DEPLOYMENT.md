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

The API build script replaces only `artifacts/api-server/dist`. The mobile package's `build` script removes `artifacts/menaflow-mobile/static-build` and clears Metro caches; inspect or back up those outputs before running it.

Configure these API variables in the hosting provider's secret/configuration manager:

- `NODE_ENV=production`, `PORT`, `DATABASE_URL`
- `CLERK_SECRET_KEY`, and `CLERK_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`)
- `ENCRYPTION_KEY` (at least 32 characters); optionally `ENCRYPTION_KEY_PREVIOUS` during a controlled rotation only
- `MENA_CORS_ORIGINS`: comma-separated exact HTTPS origins for browser clients. Native mobile requests without an `Origin` header remain supported.
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, and `MENA_FACEBOOK_REDIRECT_URI` (public HTTPS callback) when enabling Meta
- `MENA_META_WEBHOOK_VERIFY_TOKEN` (a private random string shared only with the Meta App Dashboard) when enabling Meta messages and comments
- `MENA_FACEBOOK_WEB_ORIGINS` for explicitly allowed browser return origins where applicable
- `MENA_PUBLIC_MEDIA_BASE_URL` (public HTTPS API origin) when publishing media that Meta must fetch
- `WHATSAPP_EVOLUTION_BASE_URL`, `WHATSAPP_EVOLUTION_API_KEY`, `WHATSAPP_EVOLUTION_WEBHOOK_SECRET`, and `WHATSAPP_EVOLUTION_WEBHOOK_URL` (public HTTPS callback) when enabling Evolution
- `GEMINI_API_KEY` and/or `OPENAI_API_KEY` when enabling AI generation

Production startup rejects disabled Clerk auth, missing Clerk keys, short encryption keys, short supplied previous keys, and malformed/non-HTTPS CORS origins. Meta media and Evolution callbacks do not use app-domain, localhost, or Docker-host fallbacks in production. Keep database and provider credentials server-side; only `EXPO_PUBLIC_*` values are embedded into the app.

### Subscription plans

Apply `supabase/migrations/20261104001000_workspace_subscriptions.sql` before deploying the plan and quota screens. Existing workspaces are assigned the free plan; newly created workspaces receive a seven-day Growth trial, then fall back to Free. Monthly post limits are enforced in PostgreSQL for all post creation paths, and AI-generation limits are enforced by the API. The current USD catalog is Free (10 posts, 10 AI generations, 2 channels), Starter ($9; 100 posts, 100 AI generations, 3 channels), and Growth ($29; 500 posts, 500 AI generations, 3 channels).

Payment collection and plan changes are intentionally disabled until a payment provider is selected and configured. Do not present paid plans as purchasable until checkout, payment webhooks, cancellation, and renewal handling have been integrated and verified.

### Internal order management

Apply `supabase/migrations/20261109001000_order_management.sql` before
deploying the order API and mobile app. The initial workflow records orders
internally and tracks fulfillment status; it does not collect payments,
reserve inventory, calculate delivery fees or taxes, or notify customers.
Validate the migration and order isolation on a staging database before
production rollout.

### Meta permissions for comments and messaging

In the Meta App Dashboard, enable and complete any required review/advanced access for the permissions used by the product. The Facebook connection flow requests `pages_manage_engagement`, `pages_messaging`, and `pages_manage_metadata`; the Instagram connection flow requests `instagram_manage_comments`, `instagram_manage_messages`, and `pages_manage_metadata`. Existing publishing, insights, and page-selection scopes remain requested for both flows. In particular, Instagram Messaging through Facebook Login requires `instagram_manage_messages`; Instagram Messaging webhooks also require `instagram_basic` and `pages_manage_metadata`.

OAuth consent is not treated as proof that a permission was granted. The API records the permissions Meta reports and verifies the Page token. Existing connections without recorded verification, connections missing the selected integration's permissions, and expired tokens are marked for reauthorization in Sources. Apply the Meta OAuth permissions migration before deploying this behavior, and reauthorize existing Meta connections to establish their actual grants.

### Meta inbox webhooks and replies

The authenticated inbox is available in the app's **الوارد** tab. Before receiving events:

1. Configure `MENA_META_WEBHOOK_VERIFY_TOKEN` in the API secret manager. Use a long random value and enter the same value in the Meta App Dashboard; never commit it.
2. Configure the public HTTPS callback shown in the inbox as the Meta Webhooks callback URL. The callback uses `MENA_PUBLIC_MEDIA_BASE_URL` when set, otherwise the host from `MENA_FACEBOOK_REDIRECT_URI`. For local testing, run `pnpm dev:instagram`, keep its terminal open, and update the Meta callback whenever the temporary Cloudflare Tunnel URL changes. Subscribe the app to the **Page** fields `feed`, `messages`, and `messaging_postbacks`, and the **Instagram** fields `comments` and `messages`.
3. After a Page or Instagram account is connected, the API automatically subscribes it to the required webhook fields. A background reconciliation retries failed subscriptions for existing connections. Confirm the app has the required access/review in Meta; permission or token failures are recorded in the subscription status.
4. Send a test message and comment. Incoming events are signature-verified using `FACEBOOK_APP_SECRET`; duplicate webhook deliveries are ignored.

Apply `20261025002000_meta_inbox.sql` before deploying inbox routes. The webhook callback is unauthenticated by design for Meta delivery; its GET verification token and POST HMAC signature are validated. Inbox reads and replies remain authenticated and workspace-scoped. Replies are subject to Meta messaging windows, account eligibility, app review, and each platform's policies. A Meta permission grant alone does not prove app review or webhook delivery is active.

The inbox displays HTTPS image previews and links to video or other attachments when Meta includes media URLs in the event. If a preview cannot load, the UI offers the media link as a fallback; media is not copied to application storage, so availability remains subject to Meta's URL lifetime. The inbox also shows the timestamp of the latest stored message or comment to help verify event delivery.

### Meta automatic replies

Automatic replies are enabled by selecting one or more channel controls for Facebook Messenger, Facebook comments, Instagram Direct, or Instagram comments; selecting no channels disables automation. Channel changes are saved together from the inbox settings dialog, and saving requires at least one selected channel unless it is disabling a previously enabled automation. Disabling all channels stops new webhook jobs and cancels queued jobs; in-flight work rechecks the setting before sending. Comment replies are public. New conversations may receive a brief greeting; later customer messages are instructed to receive a direct answer without repeating the greeting. The worker loads up to 30 recent inbox events for the same conversation, giving the AI the latest 20 turns so short follow-ups (such as agreeing to receive photos) can be interpreted using the product discussed earlier. For comments, it first resolves the Meta post ID to a published post saved in the same workspace and platform. For private messages, it first searches recent saved published posts for a unique title/body match. If neither lookup finds a unique relevant post, the worker uses the connected Facebook page or Instagram account to search the 50 most recent published posts, provided the corresponding read permission (`pages_read_engagement` or `instagram_basic`) was actually granted. For comments it looks up the exact parent post ID, including posts older than the recent feed window. It extracts the post text and available photo URLs from the platform response; when a customer sends an image and no text match is found, up to three recent candidate post photos are compared visually with the customer image. The matched post content is supplied as factual context. When relevant facts are absent, ambiguous, inaccessible, or unavailable from Meta, the reply is instructed to direct the customer to the connected account's contact route rather than guess. There is no separate product catalog in the current schema, so only details present in saved or fetched published posts or legacy business facts can be used. Image attachments from Meta CDN are downloaded with size/type limits for visual analysis; when a customer asks for product photos and matching post images are available, the worker sends the images as Messenger/Instagram attachments followed by a short text reply, instead of sending the page link. Customer messages and recent same-conversation inbox turns are sent to the configured AI provider. The worker uses only workspace-scoped data and never treats customer text as system instructions.

The durable queue prevents duplicate webhook events from creating duplicate jobs. AI generation may retry up to three times on transient provider errors. A send whose result is ambiguous is marked `unknown` and is not retried automatically, preventing accidental duplicate replies. Private-message automation skips events older than the 24-hour messaging window; Meta remains authoritative and may reject sends due to app review, permissions, or other platform limits. The inbox shows queued, sending, failed, and uncertain outcomes while preserving manual replies.

Apply `20261026001000_meta_auto_replies.sql` before enabling this feature. Automatic replies remain disabled by default. The API process runs the queue worker unless `META_AUTO_REPLY_WORKER_ENABLED=false`; production should run the worker alongside the API and monitor failed/unknown jobs. No separate AI key is introduced: the existing `OPENAI_API_KEY` and/or `GEMINI_API_KEY` configuration is reused.

The API exposes unauthenticated `GET /api/healthz` for liveness and `GET /api/readyz` for PostgreSQL readiness. Configure the platform health checks accordingly. The API does not apply database schema changes on startup; review and apply any required schema migration separately against the intended database.

## Expo application

Set `EXPO_PUBLIC_DOMAIN` to the public HTTPS API origin and configure `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` before creating a production app build. A production client build now fails early if the API origin is missing or points to localhost/non-HTTPS. `EXPO_PUBLIC_AUTH_DISABLED` is a development-only setting and must not be used to disable production authentication.

The repository does not include a configured EAS project or a verified hosting target for the mobile/web app. Choose the intended Expo build/export and hosting flow, then validate the generated client against the deployed API before release.

The available Expo client is an application UI, not a public marketing site. Do not publish dashboard routes in a sitemap or claim they are indexable public content. Add SEO metadata, `robots.txt`, or a sitemap only if public marketing pages are introduced and can be verified independently.

## Key rotation and existing Meta connections

Keep the currently configured `ENCRYPTION_KEY` unchanged until the target database and stored tokens have been reviewed. If the previous encryption key is safely available, set it as `ENCRYPTION_KEY_PREVIOUS` in the deployment secret manager while the new key is `ENCRYPTION_KEY`; normal account-detail and publishing requests will re-encrypt decryptable tokens with the current key. Verify all connections are usable and rotated before removing the previous key. If the old key is unavailable or a stored value is not a supported ciphertext, the affected account needs to be reconnected. Never put either key in source control or logs.

## Deployment status

The repository changes and local checks do not prove a deployment. Confirm the API and Expo services, provider callbacks, database readiness, and real Meta/Evolution operations in a staging environment before calling a release deployed.
