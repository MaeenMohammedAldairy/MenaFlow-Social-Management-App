# Project structure

## Workspace map

The repository is a pnpm workspace. Its current package boundaries are:

| Path                          | Package                       | Responsibility                                                                   |
| ----------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `artifacts/api-server`        | `@workspace/api-server`       | Express API, authentication middleware, integration routes, and backend services |
| `artifacts/menaflow-mobile`   | `@workspace/menaflow-mobile`  | Expo Router client for iOS, Android, and web                                     |
| `artifacts/mockup-sandbox`    | `@workspace/mockup-sandbox`   | Standalone Vite UI/mockup sandbox; not the mobile application                    |
| `lib/api-spec`                | `@workspace/api-spec`         | OpenAPI source and Orval code-generation command                                 |
| `lib/api-zod`                 | `@workspace/api-zod`          | Generated request/response schemas and types shared with the API                 |
| `lib/api-client-react`        | `@workspace/api-client-react` | Generated API client, React Query hooks, and shared fetch/auth configuration     |
| `lib/db`                      | `@workspace/db`               | Drizzle schema, PostgreSQL pool, and database exports                            |
| `scripts`                     | `@workspace/scripts`          | Small standalone TypeScript utilities                                            |
| `scripts/` at repository root | —                             | Operational JavaScript scripts for migrations, reports, and local development    |

## Entry points and dependencies

- The API starts at `artifacts/api-server/src/index.ts`, creates the Express application in `src/app.ts`, and mounts the health and feature routers from `src/routes/index.ts`.
- API feature routes live in `src/routes/`. `social.ts` handles social connection status, WhatsApp pairing, group selections, and disconnect; `whatsapp-messages.ts` handles WhatsApp group-message and media endpoints; `whatsapp-sync.ts` owns synchronization status/settings and webhook HTTP handlers. `whatsapp-groups.ts` owns the connected-group listing endpoint and connection validation used by group routes; `whatsapp-auto-replies.ts` handles WhatsApp auto-reply settings and testing; `whatsapp-route-errors.ts` centralizes Evolution error responses and `whatsapp-route-utils.ts` contains shared request-value parsing. `meta.ts` owns Meta OAuth/connect/disconnect handlers; `posts.ts` handles post-management endpoints; `ai.ts` and `access.ts` cover AI and access-related endpoints.
- Backend integration and domain logic belongs in `artifacts/api-server/src/lib/`. Current focused modules include Meta OAuth/media/publishing helpers and WhatsApp pairing, group normalization, message scoping, album association, media download, synchronization and webhook processing in `whatsapp-sync.ts`, the marketing queue/orchestrator in `whatsapp-marketing.ts`, isolated AI provider handling in `whatsapp-marketing-ai.ts`, and post persistence/deduplication in `whatsapp-marketing-drafts.ts`.
- The mobile entry is `artifacts/menaflow-mobile/app/_layout.tsx`; filesystem routes are in `app/`, shared UI in `components/`, and app-level state in `context/`. The Sources route keeps the Meta/WhatsApp connection and synchronization flows in `app/(tabs)/sources.tsx`, while `components/sources/SourcesConnectionsPanel.tsx` and `components/sources/WhatsAppSyncStatusPanel.tsx` own the platform-connection and sync-status views. The Content route keeps screen state and actions in `app/(tabs)/content.tsx`, delegates grouped post rendering to `components/content/ContentPostList.tsx` and edit/publish dialogs to `components/content/ContentPostDialogs.tsx`, and uses `lib/content-utils.ts` for post and media display helpers.
- Pure view-data transformations specific to a mobile feature can live beside the app in `artifacts/menaflow-mobile/lib/`; for example, `source-message-groups.ts` groups WhatsApp messages and media for the Sources screen. Content feature helpers belong in `lib/content-utils.ts`. Focused feature UI such as the WhatsApp group-message card belongs under `components/sources/`, while post list, dialog, and shared content styles live under `components/content/`. Keep feature-specific logic there rather than importing server modules into the client.
- `lib/api-spec` is the source contract. Generated schemas in `lib/api-zod` and the client in `lib/api-client-react` are consumed by the server and mobile app respectively. Regenerate those outputs through the API-spec package rather than editing generated files by hand.
- `lib/db` owns database schemas and connection setup. Server routes/services depend on this package; client packages should not.

The intended dependency direction is:

```text
mobile app ──> api-client-react ──> api-zod
API server ──> api-zod
API server ──> db
api-spec ──> generated api-client-react and api-zod
```

Keep generated API contracts and database access at their existing package boundaries. Add shared code only when it has multiple real consumers and does not pull server-only secrets or dependencies into the mobile bundle.

## Environment configuration

- The root `.env` is the local configuration source. `.env.example` documents supported variables using placeholders; never copy secrets into it.
- Keep server credentials (database URL, provider secrets, encryption keys, Evolution credentials) server-side. Only Expo variables intentionally prefixed with `EXPO_PUBLIC_` belong in the client build.
- The DB package resolves the root `.env` from supported workspace-relative locations when `DATABASE_URL` is not already set. Operational scripts also load the root environment before connecting.
- Deployment/build systems may inject environment variables directly. Expo public variables are embedded at build time and therefore need to be set in the environment used for that build.
- Meta token encryption uses `ENCRYPTION_KEY`. During a controlled key rotation, `ENCRYPTION_KEY_PREVIOUS` may be supplied through the deployment secret manager; tokens are re-encrypted with the current key when used by account-detail or publishing requests. Remove the previous key after verifying every affected connection has rotated. Never restore the removed source-code key as a fallback. `META_GRAPH_VERSION` is the preferred Meta Graph API version setting; `VITE_META_GRAPH_VERSION` and `FACEBOOK_GRAPH_VERSION` remain supported as legacy aliases.
- **Meta crypto verification (2026-10-16):** a fresh read-only check loaded `DATABASE_URL` from the repository-root `.env` (no inherited database setting in the verification process) while `NODE_ENV` was `development`. The configured endpoint hostname classified as loopback/private, but PostgreSQL reported a non-private server address; the database name did not identify itself as development/test. This is consistent with a local/private proxy or forwarding path to a remote database, but does not prove that explanation or identify the target as development, staging, or production. Therefore the earlier report's description of the checked records as definitively “local” was unsupported, and the separate claim that the exact prior check definitively targeted a remote database cannot be reconstructed: its temporary script and connection diagnostics were not retained. The target environment remains unverified.
- **Meta crypto verification (2026-10-19):** read-only checks again found three connection rows: two ciphertexts parse as the supported `IV:tag:ciphertext` format and decrypt with the currently configured key; one does not parse as that format. The prior-key environment variable was not configured, and no stored token was printed or changed. The nonconforming value cannot be classified as an old-key ciphertext; if it does not match a documented encoding or a securely available previous key, that connection will need to be reconnected. The database target remains unverified as development, staging, or production; do not run a bulk migration or delete data based on this snapshot.

## Tests and build commands

- `pnpm test` runs the explicitly listed Node test modules under `artifacts/api-server/src/lib/` and focused pure-logic tests under the mobile package.
- `pnpm run typecheck` checks workspace libraries, API server, mobile app, mockup sandbox, and root scripts.
- `pnpm build` runs typechecking followed by available package builds. The mobile package build script deletes and recreates `static-build/` and clears Metro caches; for a non-destructive bundle check, use Expo export with `--output-dir` pointing to a new temporary directory.
- The `rollup>@rollup/rollup-win32-x64-msvc` override in `pnpm-workspace.yaml` and `pnpm-lock.yaml` explicitly excludes the Windows native package. The mockup Vite build therefore fails on Windows with `Cannot find module @rollup/rollup-win32-x64-msvc`; enabling Windows builds requires a coordinated workspace/lockfile policy change and a dependency installation.

## Repository-specific notes

- `artifacts/` is the configured location for deployable applications, not disposable generated output.
- `lib/` contains active workspace packages and generated API contract outputs.
- `.agents/` contains owner-scope guidance for coding agents; retain it as project instructions, not runtime application code.
- The API's configured app-domain fallbacks for Meta callbacks, signed media, and Evolution webhooks are development-only. Those production integrations require explicitly configured public HTTPS origins.
