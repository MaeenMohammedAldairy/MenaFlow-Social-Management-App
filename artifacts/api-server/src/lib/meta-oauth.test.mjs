import assert from "node:assert/strict";
import test from "node:test";
import {
  canManageMetaConnections,
  grantedMetaPermissions,
  hasGrantedMetaPageListPermission,
  metaAutoReplyPermission,
  metaConnectionConflictDetail,
  metaConnectionConflictFromError,
  metaGraphErrorDetails,
  metaOAuthScopes,
  metaAuthorizationStatus,
  isMetaAccessTokenInvalid,
  normalizeMetaAccountId,
  missingMetaIntegrationPermissions,
} from "./meta-oauth.ts";

test("only workspace owners can manage Meta connections", () => {
  assert.equal(canManageMetaConnections("owner"), true);
  assert.equal(canManageMetaConnections("member"), false);
  assert.equal(canManageMetaConnections("admin"), false);
});

test("recognizes Graph error 190 as an invalid access token", () => {
  assert.equal(isMetaAccessTokenInvalid(190), true);
  assert.equal(isMetaAccessTokenInvalid(10), false);
  assert.equal(isMetaAccessTokenInvalid(undefined), false);
});

test("normalizes valid Meta IDs and rejects empty or whitespace-only IDs", () => {
  assert.equal(normalizeMetaAccountId("  page-123 \n"), "page-123");
  assert.equal(normalizeMetaAccountId(undefined), null);
  assert.equal(normalizeMetaAccountId(null), null);
  assert.throws(() => normalizeMetaAccountId(""), /INVALID_META_ACCOUNT_ID/);
  assert.throws(
    () => normalizeMetaAccountId(" \t\n "),
    /INVALID_META_ACCOUNT_ID/,
  );
  assert.throws(() => normalizeMetaAccountId(123), /INVALID_META_ACCOUNT_ID/);
});

test("normalizes the ECMAScript trim whitespace set without altering other characters", () => {
  const trimmedWhitespace = [
    "\u0009",
    "\u000a",
    "\u000b",
    "\u000c",
    "\u000d",
    "\u0020",
    "\u00a0",
    "\u1680",
    ...Array.from({ length: 11 }, (_, index) =>
      String.fromCodePoint(0x2000 + index),
    ),
    "\u2028",
    "\u2029",
    "\u202f",
    "\u205f",
    "\u3000",
    "\ufeff",
  ];

  for (const whitespace of trimmedWhitespace) {
    assert.equal(
      normalizeMetaAccountId(`${whitespace}meta-id${whitespace}`),
      "meta-id",
      `expected U+${whitespace.codePointAt(0).toString(16).toUpperCase()} to trim`,
    );
    assert.throws(
      () => normalizeMetaAccountId(whitespace),
      /INVALID_META_ACCOUNT_ID/,
    );
  }

  for (const preservedWhitespace of ["\u0085", "\u180e"]) {
    assert.equal(
      normalizeMetaAccountId(
        `${preservedWhitespace}meta-id${preservedWhitespace}`,
      ),
      `${preservedWhitespace}meta-id${preservedWhitespace}`,
    );
  }

  assert.equal(normalizeMetaAccountId("meta id"), "meta id");
});

test("classifies only matching Meta ownership unique constraints", () => {
  assert.equal(
    metaConnectionConflictFromError({
      code: "23505",
      constraint: "mena_meta_connections_page_id_key",
    }),
    "facebook_page",
  );
  assert.equal(
    metaConnectionConflictFromError({
      cause: {
        code: "23505",
        constraint: "mena_meta_connections_instagram_user_id_key",
      },
    }),
    "instagram_account",
  );
  assert.equal(
    metaConnectionConflictFromError({
      code: "23505",
      constraint: "mena_meta_connections_workspace_key",
    }),
    null,
  );
  assert.equal(
    metaConnectionConflictFromError({
      code: "23505",
      constraint: "unrelated_unique_key",
    }),
    null,
  );
  assert.equal(
    metaConnectionConflictFromError(new Error("database down")),
    null,
  );
});

test("ownership conflict details do not expose another workspace", () => {
  assert.match(metaConnectionConflictDetail("facebook_page"), /Facebook/);
  assert.match(metaConnectionConflictDetail("instagram_account"), /Instagram/);
  assert.doesNotMatch(
    metaConnectionConflictDetail("facebook_page"),
    /workspace-[a-z0-9-]+/i,
  );
});

test("requests the existing Meta scopes and only the selected integration's permissions", () => {
  const facebookScopes = metaOAuthScopes("facebook");
  const instagramScopes = metaOAuthScopes("instagram");

  for (const scope of [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "read_insights",
    "instagram_basic",
    "instagram_manage_insights",
    "instagram_content_publish",
  ]) {
    assert.ok(facebookScopes.includes(scope));
    assert.ok(instagramScopes.includes(scope));
  }

  assert.ok(facebookScopes.includes("pages_manage_engagement"));
  assert.ok(facebookScopes.includes("pages_messaging"));
  assert.ok(facebookScopes.includes("pages_manage_metadata"));
  assert.ok(!facebookScopes.includes("instagram_manage_messages"));
  assert.ok(instagramScopes.includes("instagram_manage_comments"));
  assert.ok(instagramScopes.includes("instagram_manage_messages"));
  assert.ok(instagramScopes.includes("pages_manage_metadata"));
  assert.ok(!instagramScopes.includes("pages_messaging"));
});

test("only permissions reported as granted are considered authorized", () => {
  const granted = grantedMetaPermissions([
    { permission: "instagram_manage_messages", status: "granted" },
    { permission: "instagram_manage_comments", status: "declined" },
    { permission: "pages_messaging", status: "expired" },
    { permission: "instagram_manage_messages", status: "granted" },
  ]);

  assert.deepEqual(granted, ["instagram_manage_messages"]);
  assert.deepEqual(missingMetaIntegrationPermissions("instagram", granted), [
    "instagram_manage_comments",
    "pages_manage_metadata",
  ]);
  assert.deepEqual(missingMetaIntegrationPermissions("facebook", granted), [
    "pages_manage_engagement",
    "pages_messaging",
    "pages_manage_metadata",
  ]);
});

test("Meta accounts require verified, current integration permissions", () => {
  const now = new Date("2026-11-04T00:00:00.000Z");
  const valid = {
    authorizationVerifiedAt: new Date("2026-11-03T00:00:00.000Z"),
    accessTokenExpiresAt: new Date("2026-11-05T00:00:00.000Z"),
    grantedPermissions: [
      "pages_manage_engagement",
      "pages_messaging",
      "pages_manage_metadata",
    ],
  };
  assert.equal(metaAuthorizationStatus(valid, "facebook", now).authorizationStatus, "ready");
  assert.equal(
    metaAuthorizationStatus(
      { ...valid, authorizationVerifiedAt: null },
      "facebook",
      now,
    ).authorizationReason,
    "permissions_unverified",
  );
  assert.equal(
    metaAuthorizationStatus(
      { ...valid, accessTokenExpiresAt: new Date("2026-11-03T23:59:59.000Z") },
      "facebook",
      now,
    ).authorizationReason,
    "token_expired",
  );
  assert.equal(
    metaAuthorizationStatus(
      { ...valid, grantedPermissions: [] },
      "facebook",
      now,
    ).authorizationReason,
    "permissions_missing",
  );
});

test("Meta accounts with a webhook-invalidated token require reauthorization", () => {
  const status = metaAuthorizationStatus(
    {
      authorizationVerifiedAt: null,
      accessTokenExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
      grantedPermissions: [
        "pages_manage_engagement",
        "pages_messaging",
        "pages_manage_metadata",
      ],
      tokenInvalid: true,
    },
    "facebook",
    new Date("2026-11-08T00:00:00.000Z"),
  );

  assert.equal(status.authorizationStatus, "needs_reauthorization");
  assert.equal(status.authorizationReason, "token_invalid");
});

test("maps Meta auto-reply kinds to the platform-specific permission", () => {
  assert.equal(metaAutoReplyPermission("facebook", "message"), "pages_messaging");
  assert.equal(
    metaAutoReplyPermission("facebook", "comment"),
    "pages_manage_engagement",
  );
  assert.equal(
    metaAutoReplyPermission("instagram", "message"),
    "instagram_manage_messages",
  );
  assert.equal(
    metaAutoReplyPermission("instagram", "comment"),
    "instagram_manage_comments",
  );
});

test("recognizes a granted permission to list Facebook pages", () => {
  assert.equal(
    hasGrantedMetaPageListPermission([
      { permission: "pages_show_list", status: "granted" },
    ]),
    true,
  );
});

test("does not treat declined or missing page-list permission as granted", () => {
  assert.equal(
    hasGrantedMetaPageListPermission([
      { permission: "pages_show_list", status: "declined" },
    ]),
    false,
  );
  assert.equal(hasGrantedMetaPageListPermission([]), false);
  assert.equal(hasGrantedMetaPageListPermission(undefined), false);
});

test("extracts only non-secret Meta Graph error diagnostics", () => {
  assert.deepEqual(
    metaGraphErrorDetails({
      error: {
        message: "Sensitive provider message",
        code: 190,
        error_subcode: 458,
        type: "OAuthException",
      },
    }),
    {
      code: 190,
      subcode: 458,
      type: "OAuthException",
      message: "Sensitive provider message",
    },
  );
  assert.deepEqual(
    metaGraphErrorDetails({
      error: { message: "invalid access_token=secret" },
    }),
    {},
  );
  assert.equal(metaGraphErrorDetails({ data: [] }), undefined);
  assert.deepEqual(metaGraphErrorDetails({ error: "invalid" }), {});
  assert.equal(metaGraphErrorDetails({ error: null }), undefined);
});
