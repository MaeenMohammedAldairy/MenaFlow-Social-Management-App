import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchMetaPostImage,
  fetchMetaPostImageFromGraph,
  isMetaMediaUrl,
  metaPostImageUrl,
} from "./meta-post-media.ts";

test("accepts HTTPS media URLs hosted by Meta CDN domains", () => {
  assert.equal(isMetaMediaUrl("https://scontent.xx.fbcdn.net/image.jpg"), true);
  assert.equal(
    isMetaMediaUrl("https://scontent.cdninstagram.com/image.jpg"),
    true,
  );
  assert.equal(isMetaMediaUrl("https://video.fbsbx.com/image.jpg"), true);
});

test("rejects untrusted, insecure, and credentialed media URLs", () => {
  assert.equal(isMetaMediaUrl("http://scontent.xx.fbcdn.net/image.jpg"), false);
  assert.equal(
    isMetaMediaUrl("https://fbcdn.net.attacker.example/image.jpg"),
    false,
  );
  assert.equal(
    isMetaMediaUrl("https://user:pass@scontent.xx.fbcdn.net/image.jpg"),
    false,
  );
  assert.equal(
    isMetaMediaUrl("https://scontent.xx.fbcdn.net:8443/image.jpg"),
    false,
  );
});

test("downloads bounded images without following untrusted redirects", async () => {
  const originalFetch = globalThis.fetch;
  let fetchOptions;
  globalThis.fetch = async (_url, options) => {
    fetchOptions = options;
    return new Response(Buffer.from("image-data"), {
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    const result = await fetchMetaPostImage(
      "https://scontent.xx.fbcdn.net/image.jpg",
    );
    assert.equal(result.mimeType, "image/jpeg");
    assert.equal(result.buffer.toString(), "image-data");
    assert.equal(fetchOptions.redirect, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("follows redirects only within trusted Meta media domains", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://scontent.cdninstagram.com/current.jpg",
        },
      });
    }
    return new Response(Buffer.from("redirected-image"), {
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    const result = await fetchMetaPostImage(
      "https://scontent.xx.fbcdn.net/redirect.jpg",
    );
    assert.equal(result.buffer.toString(), "redirected-image");
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects redirects outside the Meta media allowlist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/image.jpg" },
    });
  try {
    await assert.rejects(
      fetchMetaPostImage("https://scontent.xx.fbcdn.net/redirect.jpg"),
      /META_MEDIA_REDIRECT_INVALID/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsuccessful and unsupported Meta media responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 403 });
    await assert.rejects(
      fetchMetaPostImage("https://scontent.xx.fbcdn.net/image.jpg"),
      /META_MEDIA_HTTP_403/,
    );

    globalThis.fetch = async () =>
      new Response("not an image", {
        headers: { "content-type": "text/html" },
      });
    await assert.rejects(
      fetchMetaPostImage("https://scontent.xx.fbcdn.net/image.jpg"),
      /META_MEDIA_TYPE_UNSUPPORTED/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("extracts current image URLs from Facebook and Instagram post responses", () => {
  assert.equal(
    metaPostImageUrl("facebook", {
      full_picture: "https://scontent.xx.fbcdn.net/current.jpg",
    }),
    "https://scontent.xx.fbcdn.net/current.jpg",
  );
  assert.equal(
    metaPostImageUrl("instagram", {
      media_type: "VIDEO",
      thumbnail_url: "https://scontent.cdninstagram.com/current.jpg",
    }),
    "https://scontent.cdninstagram.com/current.jpg",
  );
  assert.equal(
    metaPostImageUrl("facebook", {
      full_picture: "https://attacker.example/image.jpg",
    }),
    null,
  );
});

test("refreshes expired CDN links through the connected Meta Graph token", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (calls.length === 1) {
      return Response.json({
        full_picture: "https://scontent.xx.fbcdn.net/current.jpg",
      });
    }
    return new Response(Buffer.from("fresh-image"), {
      headers: { "content-type": "image/jpeg" },
    });
  };
  try {
    const result = await fetchMetaPostImageFromGraph(
      "private-test-token",
      "facebook",
      "page-id_post-id",
    );
    assert.equal(result.buffer.toString(), "fresh-image");
    assert.match(calls[0].url, /^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//);
    assert.equal(
      calls[0].options.headers.Authorization,
      "Bearer private-test-token",
    );
    assert.equal(calls[1].options.redirect, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
