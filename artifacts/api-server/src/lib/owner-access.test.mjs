import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionConfiguration,
  isLocalAuthDisabled,
  requestOwnerId,
} from "./owner-access.ts";

function withEnvironment(values, operation) {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("local auth bypass requires an explicit development-only flag", () => {
  withEnvironment(
    { NODE_ENV: "production", MENA_AUTH_DISABLED: "true" },
    () => assert.equal(isLocalAuthDisabled(), false),
  );
  withEnvironment(
    { NODE_ENV: "development", MENA_AUTH_DISABLED: undefined },
    () => assert.equal(isLocalAuthDisabled(), false),
  );
  withEnvironment(
    { NODE_ENV: "development", MENA_AUTH_DISABLED: "true" },
    () => assert.equal(isLocalAuthDisabled(), true),
  );
});

test("local auth does not fall back to a shared default identity", () => {
  withEnvironment(
    {
      NODE_ENV: "development",
      MENA_AUTH_DISABLED: "true",
      MENA_OWNER_EMAIL: undefined,
    },
    () => assert.equal(requestOwnerId({}), null),
  );
});

test("local auth uses only its explicitly configured development identity", () => {
  withEnvironment(
    {
      NODE_ENV: "development",
      MENA_AUTH_DISABLED: "true",
      MENA_OWNER_EMAIL: "Owner@Example.com",
    },
    () => assert.equal(requestOwnerId({}), "dev:owner@example.com"),
  );
});

test("production auth configuration rejects the local bypass", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      MENA_AUTH_DISABLED: "true",
      CLERK_SECRET_KEY: "secret",
      CLERK_PUBLISHABLE_KEY: "publishable",
      ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /MENA_AUTH_DISABLED must not be enabled in production/,
      ),
  );
});

test("production auth configuration requires both Clerk keys", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      MENA_AUTH_DISABLED: undefined,
      CLERK_SECRET_KEY: undefined,
      CLERK_PUBLISHABLE_KEY: "publishable",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: undefined,
      ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY must be configured/,
      ),
  );
});

test("production auth configuration accepts configured Clerk keys", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      MENA_AUTH_DISABLED: undefined,
      CLERK_SECRET_KEY: "secret",
      CLERK_PUBLISHABLE_KEY: undefined,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "publishable",
      ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
    },
    () => assert.doesNotThrow(() => assertProductionConfiguration()),
  );
});

test("production auth configuration rejects Clerk development keys", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      MENA_AUTH_DISABLED: undefined,
      MENA_ALLOW_CLERK_TEST_KEYS_IN_PRODUCTION: undefined,
      CLERK_SECRET_KEY: "sk_test_development",
      CLERK_PUBLISHABLE_KEY: "pk_test_development",
      ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /Clerk test keys require MENA_ALLOW_CLERK_TEST_KEYS_IN_PRODUCTION=true/,
      ),
  );
});

test("production configuration requires a sufficiently long encryption key", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      MENA_AUTH_DISABLED: undefined,
      CLERK_SECRET_KEY: "secret",
      CLERK_PUBLISHABLE_KEY: "publishable",
      ENCRYPTION_KEY: "too-short",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /ENCRYPTION_KEY must be configured with at least 32 characters/,
      ),
  );
});

test("production configuration requires a sufficiently long previous key when supplied", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      MENA_AUTH_DISABLED: undefined,
      CLERK_SECRET_KEY: "secret",
      CLERK_PUBLISHABLE_KEY: "publishable",
      ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
      ENCRYPTION_KEY_PREVIOUS: "short",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /ENCRYPTION_KEY_PREVIOUS must contain at least 32 characters/,
      ),
  );
});

test("production CORS origins must be exact HTTPS origins", () => {
  const common = {
    NODE_ENV: "production",
    MENA_AUTH_DISABLED: undefined,
    CLERK_SECRET_KEY: "secret",
    CLERK_PUBLISHABLE_KEY: "publishable",
    ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
  };
  withEnvironment(
    { ...common, MENA_CORS_ORIGINS: "https://app.example.com" },
    () => assert.doesNotThrow(() => assertProductionConfiguration()),
  );
  withEnvironment(
    { ...common, MENA_CORS_ORIGINS: "http://app.example.com" },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /MENA_CORS_ORIGINS must contain comma-separated HTTPS origins/,
      ),
  );
  withEnvironment(
    { ...common, MENA_CORS_ORIGINS: "https://app.example.com/path" },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /MENA_CORS_ORIGINS must contain comma-separated HTTPS origins/,
      ),
  );
});

test("production Evolution configuration refuses to reuse the admin key as the webhook secret", () => {
  const common = {
    NODE_ENV: "production",
    MENA_AUTH_DISABLED: undefined,
    CLERK_SECRET_KEY: "secret",
    CLERK_PUBLISHABLE_KEY: "publishable",
    ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
    // Clear anything the surrounding environment may already set, so these
    // assertions do not depend on the machine running them.
    WHATSAPP_EVOLUTION_API_KEY: undefined,
    WHATSAPP_EVOLUTION_WEBHOOK_SECRET: undefined,
  };

  // Evolution not enabled: no new requirement.
  withEnvironment(common, () =>
    assert.doesNotThrow(() => assertProductionConfiguration()),
  );

  // Enabled with a dedicated secret: accepted.
  withEnvironment(
    {
      ...common,
      WHATSAPP_EVOLUTION_API_KEY: "evolution-admin-key",
      WHATSAPP_EVOLUTION_WEBHOOK_SECRET: "dedicated-webhook-secret",
    },
    () => assert.doesNotThrow(() => assertProductionConfiguration()),
  );

  // Enabled without a dedicated secret: the admin-key fallback is refused.
  withEnvironment(
    { ...common, WHATSAPP_EVOLUTION_API_KEY: "evolution-admin-key" },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /WHATSAPP_EVOLUTION_WEBHOOK_SECRET must be configured in production/,
      ),
  );

  // Set to the admin key itself: refused, because that is the same exposure.
  withEnvironment(
    {
      ...common,
      WHATSAPP_EVOLUTION_API_KEY: "evolution-admin-key",
      WHATSAPP_EVOLUTION_WEBHOOK_SECRET: "evolution-admin-key",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /WHATSAPP_EVOLUTION_WEBHOOK_SECRET must differ from WHATSAPP_EVOLUTION_API_KEY/,
      ),
  );

  // Blank values count as missing.
  withEnvironment(
    {
      ...common,
      WHATSAPP_EVOLUTION_API_KEY: "evolution-admin-key",
      WHATSAPP_EVOLUTION_WEBHOOK_SECRET: "   ",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /WHATSAPP_EVOLUTION_WEBHOOK_SECRET must be configured in production/,
      ),
  );
});
