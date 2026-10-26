import assert from "node:assert/strict";
import test from "node:test";
import {
  EvolutionApiError,
  evolutionConnectionState,
  evolutionRequest,
  isExclusiveWhatsAppInstance,
  verifyWhatsAppWebhookSecret,
  whatsappWebhookUrl,
} from "./whatsapp-evolution.ts";

const originalFetch = globalThis.fetch;
const originalEvolutionUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL;
const originalEvolutionKey = process.env.WHATSAPP_EVOLUTION_API_KEY;

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

test("requires an explicit public HTTPS webhook URL in production", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      WHATSAPP_EVOLUTION_WEBHOOK_URL: undefined,
      REPLIT_DEV_DOMAIN: "temporary.replit.dev",
      PORT: "5000",
    },
    () =>
      assert.throws(
        () => whatsappWebhookUrl(),
        (error) => error instanceof EvolutionApiError &&
          error.message === "WHATSAPP_WEBHOOK_URL_REQUIRED",
      ),
  );
});

test("rejects local or non-HTTPS webhook URLs in production", () => {
  for (const value of ["http://hooks.example.com/callback", "https://localhost/callback"]) {
    withEnvironment(
      {
        NODE_ENV: "production",
        WHATSAPP_EVOLUTION_WEBHOOK_URL: value,
        REPLIT_DEV_DOMAIN: undefined,
      },
      () =>
        assert.throws(
          () => whatsappWebhookUrl(),
          (error) => error instanceof EvolutionApiError &&
            error.message === "WHATSAPP_WEBHOOK_URL_INVALID",
        ),
    );
  }
});

test("accepts a configured public HTTPS webhook URL in production", () => {
  withEnvironment(
    {
      NODE_ENV: "production",
      WHATSAPP_EVOLUTION_WEBHOOK_URL: "https://api.example.com/api/social/whatsapp/webhook",
      REPLIT_DEV_DOMAIN: "temporary.replit.dev",
    },
    () =>
      assert.equal(
        whatsappWebhookUrl(),
        "https://api.example.com/api/social/whatsapp/webhook",
      ),
  );
});

test("validates webhook credentials without accepting missing or mismatched values", () => {
  withEnvironment(
    {
      WHATSAPP_EVOLUTION_WEBHOOK_SECRET: "configured-webhook-secret",
      WHATSAPP_EVOLUTION_API_KEY: "fallback-api-secret",
    },
    () => {
      assert.equal(
        verifyWhatsAppWebhookSecret("configured-webhook-secret"),
        true,
      );
      assert.equal(
        verifyWhatsAppWebhookSecret(["configured-webhook-secret"]),
        true,
      );
      assert.equal(verifyWhatsAppWebhookSecret("wrong-secret"), false);
      assert.equal(verifyWhatsAppWebhookSecret(undefined), false);
    },
  );
  withEnvironment(
    {
      WHATSAPP_EVOLUTION_WEBHOOK_SECRET: undefined,
      WHATSAPP_EVOLUTION_API_KEY: undefined,
    },
    () => assert.equal(verifyWhatsAppWebhookSecret("any-value"), false),
  );
});

test("sends Evolution requests with the configured base URL and API key", async () => {
  let requestUrl;
  let requestOptions;
  try {
    process.env.WHATSAPP_EVOLUTION_BASE_URL = "https://evolution.example/api";
    process.env.WHATSAPP_EVOLUTION_API_KEY = "test-api-key";
    globalThis.fetch = async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({ created: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.deepEqual(
      await evolutionRequest("instance/create", {
        method: "POST",
        body: JSON.stringify({ instanceName: "owner-123" }),
      }),
      { created: true },
    );
    assert.equal(
      requestUrl.toString(),
      "https://evolution.example/api/instance/create",
    );
    assert.equal(requestOptions.headers.apikey, "test-api-key");
    assert.equal(requestOptions.headers["Content-Type"], "application/json");
    assert.equal(requestOptions.method, "POST");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEvolutionUrl === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_BASE_URL;
    } else {
      process.env.WHATSAPP_EVOLUTION_BASE_URL = originalEvolutionUrl;
    }
    if (originalEvolutionKey === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_API_KEY;
    } else {
      process.env.WHATSAPP_EVOLUTION_API_KEY = originalEvolutionKey;
    }
  }
});

test("maps missing Evolution configuration and failed responses to typed errors", async () => {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL;
  const configuredKey = process.env.WHATSAPP_EVOLUTION_API_KEY;
  try {
    delete process.env.WHATSAPP_EVOLUTION_BASE_URL;
    delete process.env.WHATSAPP_EVOLUTION_API_KEY;
    await assert.rejects(
      evolutionRequest("instance/create"),
      (error) => error instanceof EvolutionApiError &&
        error.statusCode === 503 &&
        error.message === "EVOLUTION_API_NOT_CONFIGURED",
    );

    process.env.WHATSAPP_EVOLUTION_BASE_URL = "https://evolution.example/";
    process.env.WHATSAPP_EVOLUTION_API_KEY = "test-api-key";
    globalThis.fetch = async () => new Response("not found", { status: 404 });
    await assert.rejects(
      evolutionRequest("instance/missing"),
      (error) => error instanceof EvolutionApiError &&
        error.statusCode === 404 &&
        error.message === "EVOLUTION_INSTANCE_NOT_FOUND",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (configuredUrl === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_BASE_URL;
    } else {
      process.env.WHATSAPP_EVOLUTION_BASE_URL = configuredUrl;
    }
    if (configuredKey === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_API_KEY;
    } else {
      process.env.WHATSAPP_EVOLUTION_API_KEY = configuredKey;
    }
  }
});

test("maps timed-out Evolution requests to a gateway timeout", async () => {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL;
  const configuredKey = process.env.WHATSAPP_EVOLUTION_API_KEY;
  try {
    process.env.WHATSAPP_EVOLUTION_BASE_URL = "https://evolution.example";
    process.env.WHATSAPP_EVOLUTION_API_KEY = "test-api-key";
    globalThis.fetch = async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    };

    await assert.rejects(
      evolutionRequest("group/fetchAllGroups/test-instance", {}, 120_000),
      (error) =>
        error instanceof EvolutionApiError &&
        error.statusCode === 504 &&
        error.message === "EVOLUTION_API_TIMEOUT",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (configuredUrl === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_BASE_URL;
    } else {
      process.env.WHATSAPP_EVOLUTION_BASE_URL = configuredUrl;
    }
    if (configuredKey === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_API_KEY;
    } else {
      process.env.WHATSAPP_EVOLUTION_API_KEY = configuredKey;
    }
  }
});

test("normalizes the Evolution connection state response", async () => {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL;
  const configuredKey = process.env.WHATSAPP_EVOLUTION_API_KEY;
  try {
    process.env.WHATSAPP_EVOLUTION_BASE_URL = "https://evolution.example";
    process.env.WHATSAPP_EVOLUTION_API_KEY = "test-api-key";
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ instance: { state: "OPEN" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    assert.equal(await evolutionConnectionState("owner/123"), "open");
  } finally {
    globalThis.fetch = originalFetch;
    if (configuredUrl === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_BASE_URL;
    } else {
      process.env.WHATSAPP_EVOLUTION_BASE_URL = configuredUrl;
    }
    if (configuredKey === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_API_KEY;
    } else {
      process.env.WHATSAPP_EVOLUTION_API_KEY = configuredKey;
    }
  }
});

test("accepts an empty successful Evolution delete response", async () => {
  const configuredUrl = process.env.WHATSAPP_EVOLUTION_BASE_URL;
  const configuredKey = process.env.WHATSAPP_EVOLUTION_API_KEY;
  try {
    process.env.WHATSAPP_EVOLUTION_BASE_URL = "https://evolution.example";
    process.env.WHATSAPP_EVOLUTION_API_KEY = "test-api-key";
    const responses = [
      new Response(null, { status: 204 }),
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ];
    globalThis.fetch = async () => responses.shift();

    assert.equal(
      await evolutionRequest("instance/delete/owned", { method: "DELETE" }),
      null,
    );
    assert.equal(
      await evolutionRequest("instance/delete/owned", { method: "DELETE" }),
      null,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (configuredUrl === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_BASE_URL;
    } else {
      process.env.WHATSAPP_EVOLUTION_BASE_URL = configuredUrl;
    }
    if (configuredKey === undefined) {
      delete process.env.WHATSAPP_EVOLUTION_API_KEY;
    } else {
      process.env.WHATSAPP_EVOLUTION_API_KEY = configuredKey;
    }
  }
});

test("allows deleting a legacy instance only when its database owner is unique", () => {
  assert.equal(isExclusiveWhatsAppInstance("owner-a", ["owner-a"]), true);
  assert.equal(isExclusiveWhatsAppInstance("owner-a", ["owner-b"]), false);
  assert.equal(isExclusiveWhatsAppInstance("owner-a", ["owner-a", "owner-b"]), false);
  assert.equal(isExclusiveWhatsAppInstance("owner-a", []), false);
});
