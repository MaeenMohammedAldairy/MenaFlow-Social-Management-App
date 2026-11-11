import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectWhatsAppCloudAssets,
  parseWhatsAppCloudTestMessagingAccountIds,
  WhatsAppCloudMetaError,
} from "./whatsapp-cloud-meta.ts";

const accountId = "test-messaging-account";
const phoneId = "test-phone-number";
const permissions = {
  data: [
    { permission: "whatsapp_business_management", status: "granted" },
    { permission: "whatsapp_business_messaging", status: "granted" },
  ],
};

function fetchResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function graphFetcher({
  account = { id: accountId },
  numbers = {
    data: [
      {
        id: phoneId,
        display_phone_number: "+1 555 0100",
        verified_name: "Test business",
        code_verification_status: "VERIFIED",
        quality_rating: "GREEN",
        platform_type: "CLOUD_API",
      },
    ],
  },
  granted = permissions,
  failure,
} = {}) {
  return async (url, options) => {
    assert.match(String(url), /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//);
    assert.equal(options.headers.authorization, "Bearer test-token");
    assert.equal(new URL(url).searchParams.has("access_token"), false);
    if (failure) return fetchResponse(failure.payload, failure.status);
    if (String(url).endsWith("/me/permissions")) {
      return fetchResponse(granted);
    }
    if (String(url).includes("/phone_numbers?")) return fetchResponse(numbers);
    return fetchResponse(account);
  };
}

test("parses only explicit valid Test WABA messaging-account IDs", () => {
  assert.equal(parseWhatsAppCloudTestMessagingAccountIds(undefined), null);
  assert.equal(parseWhatsAppCloudTestMessagingAccountIds("  "), null);
  assert.equal(parseWhatsAppCloudTestMessagingAccountIds("test-id, bad id"), null);
  assert.deepEqual(
    parseWhatsAppCloudTestMessagingAccountIds("test-id, second.test-id"),
    new Set(["test-id", "second.test-id"]),
  );
});

test("validates the messaging account, selected phone number, and required grants", async () => {
  const result = await inspectWhatsAppCloudAssets(
    "test-token",
    accountId,
    phoneId,
    graphFetcher(),
  );
  assert.equal(result.messagingAccountId, accountId);
  assert.equal(result.phoneNumbers[0].metaPhoneNumberId, phoneId);
  assert.deepEqual(result.grantedPermissions, [
    "whatsapp_business_management",
    "whatsapp_business_messaging",
  ]);
});

test("rejects a phone number that is not attached to the supplied messaging account", async () => {
  await assert.rejects(
    inspectWhatsAppCloudAssets(
      "test-token",
      accountId,
      "another-phone",
      graphFetcher(),
    ),
    (error) =>
      error instanceof WhatsAppCloudMetaError &&
      error.code === "META_ASSET_MISMATCH",
  );
});

test("rejects messaging accounts without both required permissions", async () => {
  await assert.rejects(
    inspectWhatsAppCloudAssets(
      "test-token",
      accountId,
      phoneId,
      graphFetcher({
        granted: {
          data: [
            {
              permission: "whatsapp_business_management",
              status: "granted",
            },
          ],
        },
      }),
    ),
    (error) =>
      error instanceof WhatsAppCloudMetaError &&
      error.code === "META_PERMISSION_MISSING",
  );
});

test("normalizes invalid Graph tokens without retaining the upstream response", async () => {
  await assert.rejects(
    inspectWhatsAppCloudAssets(
      "test-token",
      accountId,
      phoneId,
      graphFetcher({
        failure: {
          status: 400,
          payload: {
            error: {
              message: "do not persist this upstream response",
              code: 190,
            },
          },
        },
      }),
    ),
    (error) =>
      error instanceof WhatsAppCloudMetaError &&
      error.httpStatus === 401 &&
      !error.message.includes("do not persist"),
  );
});

test("does not accept an unrelated Graph object as the requested messaging account", async () => {
  await assert.rejects(
    inspectWhatsAppCloudAssets(
      "test-token",
      accountId,
      phoneId,
      graphFetcher({ account: { id: "another-account" } }),
    ),
    (error) =>
      error instanceof WhatsAppCloudMetaError &&
      error.code === "META_ASSET_MISMATCH",
  );
});
