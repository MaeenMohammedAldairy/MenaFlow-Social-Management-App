// The .mjs extension is deliberate: the root package.json has no "type" field,
// and adding "type": "module" there would break the existing preinstall script,
// which runs `node -e` with CommonJS `require`.

import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * This config enables only the guards that encode lessons this repository
 * already paid for. It deliberately does NOT extend eslint:recommended or
 * tseslint.configs.recommended: doing so added ~275 findings unrelated to any
 * known defect here (unused variables, prefer-const, empty catch blocks in the
 * intentional `try { process.loadEnvFile(f) } catch {}` idiom), which would
 * bury the rules below and turn `pnpm lint` into a chore instead of a gate.
 * Enable general style enforcement later, as its own change, if wanted.
 *
 * Lint scope is the server runtime and the shared libraries, where a mistake
 * reaches production data or a customer. Not linted, and why:
 * - `artifacts/menaflow-mobile` and `artifacts/owner-console` are browser and
 *   React Native code. `console` is their normal diagnostic channel (pino does
 *   not run there), and linting them properly needs react and react-hooks
 *   rules — a separate, larger change.
 * - `artifacts/mockup-sandbox` is a design sandbox, not shipped code.
 * - `lib/api-zod/src/generated` and `lib/api-client-react/src/generated` are
 *   produced by Orval from `lib/api-spec/openapi.yaml`; hand-editing them is
 *   already forbidden, so linting them would only report generated style.
 * - `scripts/` and `artifacts/api-server/scripts/` are operational CLI tools
 *   where printing to stdout is the point.
 * - `artifacts/api-server/build.mjs` runs before the server exists, so it
 *   cannot log through the server's pino instance.
 * - `*.test.mjs` files are plain JavaScript run by `node --test`, outside the
 *   pino pipeline.
 */

/**
 * The only modules allowed to import the AI provider's call function.
 *
 * `ai-provider.ts` defines `callAiProvider`. `metered-ai-provider.ts` is the
 * single sanctioned caller: it wraps the provider so the workspace's monthly AI
 * quota is charged. Every other module must call `callMeteredAiProvider`, or
 * quota is consumed without being metered.
 *
 * This was a real defect — finding S-05 in
 * docs/audit/plans-subscriptions-review-2026-11-22.md: WhatsApp marketing
 * generation called the provider directly, giving the most expensive AI
 * operation an effectively unlimited quota. It is fixed (every caller now goes
 * through the metered wrapper), and this rule keeps it fixed, because nothing
 * else in the build or test suite would notice a regression.
 *
 * Type-only imports stay allowed: modules legitimately need `AiProviderOptions`
 * and `AiProviderResult` to type their own parameters, and importing a type
 * cannot bypass the meter.
 */
const AI_PROVIDER_ALLOWED = [
  "artifacts/api-server/src/lib/ai-provider.ts",
  "artifacts/api-server/src/lib/metered-ai-provider.ts",
];

const restrictedAiProviderMessage =
  "Import callMeteredAiProvider from metered-ai-provider.ts instead, so workspace AI quota is charged. Type-only imports are fine.";

// Both spellings, with and without the .ts extension. This repository mixes
// them freely (303 relative imports are extensionless, 91 are not), so banning
// only one would leave the rule trivially bypassable by an import that still
// resolves to the same module.
const noDirectAiProvider = {
  paths: [
    "./ai-provider.ts",
    "./ai-provider",
    "../lib/ai-provider.ts",
    "../lib/ai-provider",
  ].map((name) => ({
    name,
    message: restrictedAiProviderMessage,
    allowTypeImports: true,
  })),
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/static-build/**",
      "**/.expo/**",
      "lib/api-zod/src/generated/**",
      "lib/api-client-react/src/generated/**",
      "artifacts/menaflow-mobile/**",
      "artifacts/owner-console/**",
      "artifacts/mockup-sandbox/**",
      "scripts/**",
      "artifacts/api-server/scripts/**",
      "artifacts/api-server/build.mjs",
    ],
  },

  // Supplies the TypeScript parser for .ts files. `configs.base` is a single
  // config object, not an array, so it must not be spread. No stylistic or
  // type-aware rules are enabled, so this stays fast and reports only what is
  // configured below.
  tseslint.configs.base,

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // The API server configures pino with pino-http (src/app.ts), so runtime
      // diagnostics belong on the logger. console output is unstructured — no
      // level, timestamp, request id, or workspace id — which makes production
      // logs unsearchable and unalertable. Before this rule, 29 server files
      // logged through console and only 15 imported the pino logger, so the
      // unstructured path was the majority.
      "no-console": "error",
      "no-restricted-imports": ["error", noDirectAiProvider],
    },
  },

  {
    // The provider and its metering wrapper must reference each other.
    files: AI_PROVIDER_ALLOWED,
    rules: {
      "no-restricted-imports": "off",
    },
  },

  {
    // Tests and one-off scripts run under `node --test` or as CLI tools, outside
    // the server's pino pipeline. They still need Node globals declared so
    // process, Buffer, and fetch are not reported as undefined.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
