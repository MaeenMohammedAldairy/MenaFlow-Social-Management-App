import assert from "node:assert/strict";
import test from "node:test";
import {
  hasGrantedMetaPageListPermission,
  metaGraphErrorDetails,
} from "./meta-oauth.ts";
import {
  buildFacebookPageByIdUrl,
  buildMetaPageListUrl,
  findFacebookPageWithUserTokens,
  grantedFacebookPageIds,
  inspectFacebookPage,
  inspectMetaPageList,
  metaPageListFailureDetail,
} from "./meta-pages.ts";

test("reads only valid page IDs explicitly granted by Meta", () => {
  assert.deepEqual(
    grantedFacebookPageIds({
      data: {
        is_valid: true,
        granular_scopes: [
          { scope: "pages_show_list", target_ids: ["123", "456", "123"] },
          { scope: "pages_manage_posts", target_ids: ["789"] },
          { scope: "pages_show_list", target_ids: ["../me", 123, ""] },
        ],
      },
    }),
    ["123", "456"],
  );
  assert.deepEqual(grantedFacebookPageIds({ data: {} }), []);
});

test("builds a page lookup URL with a verified page ID and user token", () => {
  const url = buildFacebookPageByIdUrl("v26.0", "123456", "user-token");
  assert.equal(url.pathname, "/v26.0/123456");
  assert.equal(url.searchParams.get("fields"), "id,name,access_token");
  assert.equal(url.searchParams.get("access_token"), "user-token");
  assert.throws(
    () => buildFacebookPageByIdUrl("v26.0", "../me", "user-token"),
    /INVALID_META_PAGE_ID/,
  );
});

test("accepts a page lookup only when it matches the granted page ID", () => {
  assert.deepEqual(
    inspectFacebookPage(
      { id: "123", name: "Selected Page", access_token: "page-token" },
      "123",
    ),
    { id: "123", name: "Selected Page", access_token: "page-token" },
  );
  assert.equal(
    inspectFacebookPage(
      { id: "456", name: "Other Page", access_token: "page-token" },
      "123",
    ),
    undefined,
  );
});

test("requests Facebook pages with the exchanged user token and Facebook-only fields", () => {
  const url = buildMetaPageListUrl("v26.0", "test-user-access-token");

  assert.equal(
    url.toString().startsWith("https://graph.facebook.com/v26.0/me/accounts?"),
    true,
  );
  assert.equal(url.searchParams.get("access_token"), "test-user-access-token");
  assert.equal(url.searchParams.get("fields"), "id,name,access_token");
  assert.equal(url.searchParams.has("instagram_business_account"), false);
});

test("selects an accessible Facebook page without requiring Instagram", () => {
  const result = inspectMetaPageList({
    data: [
      { id: "page-without-token", name: "Not manageable" },
      { id: "page-1", name: "My Facebook Page", access_token: "page-token" },
    ],
  });

  assert.deepEqual(result.diagnostics, { hasData: true, pageCount: 2 });
  assert.deepEqual(result.page, {
    id: "page-1",
    name: "My Facebook Page",
    access_token: "page-token",
  });
});

test("retries an empty long-lived-token result with the short-lived user token", async () => {
  const requestedTokens = [];
  const result = await findFacebookPageWithUserTokens(
    [
      { kind: "long_lived", value: "long-user-token" },
      { kind: "short_lived", value: "short-user-token" },
    ],
    async (token) => {
      requestedTokens.push(token);
      return token === "long-user-token"
        ? { httpStatus: 200, payload: { data: [] } }
        : {
            httpStatus: 200,
            payload: {
              data: [
                {
                  id: "selected-page",
                  name: "Selected Page",
                  access_token: "page-token",
                },
              ],
            },
          };
    },
  );

  assert.deepEqual(requestedTokens, ["long-user-token", "short-user-token"]);
  assert.equal(result.page?.id, "selected-page");
  assert.deepEqual(
    result.attempts.map(({ tokenKind, pageCount }) => ({ tokenKind, pageCount })),
    [
      { tokenKind: "long_lived", pageCount: 0 },
      { tokenKind: "short_lived", pageCount: 1 },
    ],
  );
});

test("reports empty page lists after trying both user access tokens", async () => {
  const result = await findFacebookPageWithUserTokens(
    [
      { kind: "long_lived", value: "long-token" },
      { kind: "short_lived", value: "short-token" },
    ],
    async () => ({ httpStatus: 200, payload: { data: [] } }),
  );

  assert.equal(result.page, undefined);
  assert.equal(result.error, undefined);
  assert.deepEqual(
    result.attempts.map(({ httpStatus, hasData, pageCount }) => ({
      httpStatus,
      hasData,
      pageCount,
    })),
    [
      { httpStatus: 200, hasData: true, pageCount: 0 },
      { httpStatus: 200, hasData: true, pageCount: 0 },
    ],
  );
});

test("retains the sanitized Graph API error when both user-token requests fail", async () => {
  const graphError = Object.assign(new Error("META_GRAPH_REQUEST_FAILED"), {
    status: 403,
    details: {
      code: 200,
      subcode: 10,
      type: "OAuthException",
      message: "Permissions error",
    },
  });
  const result = await findFacebookPageWithUserTokens(
    [
      { kind: "long_lived", value: "long-token" },
      { kind: "short_lived", value: "short-token" },
    ],
    async () => {
      throw graphError;
    },
  );

  assert.equal(result.error, graphError);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].httpStatus, 403);
  assert.equal(result.attempts[0].error.message, "Permissions error");
});

test("reports an empty page list separately from missing data", () => {
  assert.deepEqual(inspectMetaPageList({ data: [] }), {
    diagnostics: { hasData: true, pageCount: 0 },
    page: undefined,
  });
  assert.deepEqual(inspectMetaPageList({}), {
    diagnostics: { hasData: false, pageCount: 0 },
    page: undefined,
  });
});

test("recognizes when Meta did not grant the page-list permission", () => {
  assert.equal(
    hasGrantedMetaPageListPermission([
      { permission: "pages_show_list", status: "declined" },
    ]),
    false,
  );
  assert.equal(
    hasGrantedMetaPageListPermission([
      { permission: "pages_show_list", status: "granted" },
    ]),
    true,
  );
});

test("creates a useful Graph API error detail without credentials", () => {
  assert.equal(
    metaPageListFailureDetail(403, {
      code: 200,
      subcode: 10,
      message: "Permissions error: pages_show_list is required",
    }),
    "HTTP 403 — Meta 200 — subcode 10 — Permissions error: pages_show_list is required",
  );
  assert.equal(
    metaPageListFailureDetail(
      400,
      metaGraphErrorDetails({
        error: { message: "invalid access_token=secret" },
      }),
    ),
    "HTTP 400",
  );
});

test("captures an API rejection response without exposing its access token", () => {
  const payload = {
    data: [],
    error: {
      message: "Permissions error: pages_show_list is required",
      code: 200,
      error_subcode: 10,
      type: "OAuthException",
    },
  };
  const result = inspectMetaPageList(payload);
  const error = metaGraphErrorDetails(payload);

  assert.deepEqual(result.diagnostics, { hasData: true, pageCount: 0 });
  assert.equal(error?.message, "Permissions error: pages_show_list is required");
  assert.equal(
    metaPageListFailureDetail(403, error),
    "HTTP 403 — Meta 200 — subcode 10 — Permissions error: pages_show_list is required",
  );
});
