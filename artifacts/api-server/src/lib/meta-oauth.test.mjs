import assert from "node:assert/strict";
import test from "node:test";
import {
  grantedMetaPermissions,
  hasGrantedMetaPageListPermission,
  metaGraphErrorDetails,
  metaOAuthScopes,
  missingMetaIntegrationPermissions,
} from "./meta-oauth.ts";

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
