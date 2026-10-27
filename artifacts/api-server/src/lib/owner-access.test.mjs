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
      CLERK_SECRET_KEY: "sk_test_development",
      CLERK_PUBLISHABLE_KEY: "pk_test_development",
      ENCRYPTION_KEY: "a-production-encryption-key-with-at-least-32-chars",
    },
    () =>
      assert.throws(
        () => assertProductionConfiguration(),
        /Clerk test keys must not be used in production/,
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
