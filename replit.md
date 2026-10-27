# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- WhatsApp pairing uses Evolution API v2.3.7 and requires `WHATSAPP_EVOLUTION_BASE_URL` plus `WHATSAPP_EVOLUTION_API_KEY`. MenaFlow creates and stores a dedicated Evolution instance per authenticated owner; do not configure a shared `WHATSAPP_EVOLUTION_INSTANCE` or `WHATSAPP_CONFIG_ID`. Evolution API must persist its instance authentication data across its own restarts; MenaFlow stores the instance reference, not WhatsApp's Baileys session credentials. WhatsApp text and standalone media are deferred during their settle windows so an arriving message can complete a group before draft creation. When Evolution omits an explicit text/media parent key, `WHATSAPP_TEXT_ALBUM_ASSOCIATION_MS` (default 30000 ms; set to `0` to disable) can associate only adjacent messages from the same sender and group when there is a unique text anchor, captions do not conflict, and no unrelated message interrupts the sequence. Ambiguous messages remain separate for review rather than being combined based on timing alone.
- Instagram publishing of WhatsApp media requires a publicly reachable HTTPS API origin so Meta can fetch signed media URLs. Set `MENA_PUBLIC_MEDIA_BASE_URL` to that origin; Replit deployments fall back to `REPLIT_DEV_DOMAIN` or the first `REPLIT_DOMAINS` entry, and other deployments can fall back to a public `EXPO_PUBLIC_DOMAIN`. Localhost is not reachable by Meta. For local development, install `cloudflared` and run `pnpm dev:instagram`; it opens a temporary Cloudflare HTTPS tunnel, passes the temporary URL to the API and Expo app through process environment variables, and starts both services without writing the URL to configuration files.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
