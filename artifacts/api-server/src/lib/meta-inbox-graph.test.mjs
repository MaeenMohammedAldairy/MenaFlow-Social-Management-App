import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMetaInboxReplyRequest,
  normalizeMetaPublishedPosts,
} from "./meta-inbox-graph.ts";

test("builds private-message requests for Facebook and Instagram", () => {
  const facebook = buildMetaInboxReplyRequest({
    platform: "facebook",
    kind: "message",
    pageId: "page-1",
    instagramUserId: null,
    recipientId: "person-1",
    externalId: "message-1",
    text: "أهلًا",
  });
  const instagram = buildMetaInboxReplyRequest({
    platform: "instagram",
    kind: "message",
    pageId: "page-1",
    instagramUserId: "instagram-1",
    recipientId: "person-2",
    externalId: "message-2",
    text: "مرحبًا",
  });

  assert.equal(facebook.edge, "page-1/messages");
  assert.equal(instagram.edge, "instagram-1/messages");
  assert.deepEqual(JSON.parse(facebook.fields.recipient), { id: "person-1" });
  assert.deepEqual(JSON.parse(instagram.fields.message), { text: "مرحبًا" });
});

test("builds public comment-reply edges for both platforms", () => {
  const facebook = buildMetaInboxReplyRequest({
    platform: "facebook",
    kind: "comment",
    pageId: "page-1",
    instagramUserId: null,
    recipientId: "post-1",
    externalId: "comment/1",
    text: "شكرًا لتعليقك",
  });
  const instagram = buildMetaInboxReplyRequest({
    platform: "instagram",
    kind: "comment",
    pageId: "page-1",
    instagramUserId: "instagram-1",
    recipientId: "media-1",
    externalId: "comment-2",
    text: "يسعدنا تواصلك",
  });

  assert.equal(facebook.edge, "comment%2F1/comments");
  assert.equal(instagram.edge, "comment-2/replies");
  assert.deepEqual(facebook.fields, { message: "شكرًا لتعليقك" });
  assert.deepEqual(instagram.fields, { message: "يسعدنا تواصلك" });
});

test("builds reusable image-attachment requests for private messages", () => {
  const request = buildMetaInboxReplyRequest({
    platform: "facebook",
    kind: "message",
    pageId: "page-1",
    instagramUserId: null,
    recipientId: "person-1",
    externalId: "message-1",
    text: "تفضل الصورة",
    imageUrl: "https://media.example/product.jpg",
  });

  assert.deepEqual(JSON.parse(request.fields.message), {
    attachment: {
      type: "image",
      payload: {
        url: "https://media.example/product.jpg",
        is_reusable: true,
      },
    },
  });
});

test("normalizes Facebook published posts and nested photo attachments", () => {
  assert.deepEqual(
    normalizeMetaPublishedPosts(
      {
        data: [
          {
            id: "fb-post-1",
            message: "المشط الحراري بسعر 20",
            attachments: {
              data: [
                {
                  type: "photo",
                  media: { image: { src: "https://scontent.fbcdn.net/photo" } },
                },
                {
                  type: "video",
                  media: {
                    image: { src: "https://scontent.fbcdn.net/preview" },
                  },
                },
                {
                  type: "album",
                  subattachments: {
                    data: [
                      {
                        type: "photo",
                        media: {
                          image: { src: "https://scontent.fbcdn.net/album" },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
      "facebook",
    ),
    [
      {
        postId: "fb-post-1",
        title: "المشط الحراري بسعر 20",
        body: "المشط الحراري بسعر 20",
        mediaUrls: [
          "https://scontent.fbcdn.net/photo",
          "https://scontent.fbcdn.net/album",
        ],
      },
    ],
  );
});

test("normalizes Instagram captions and carousel photos", () => {
  assert.deepEqual(
    normalizeMetaPublishedPosts(
      {
        data: [
          {
            id: "ig-post-1",
            caption: "السعر 30",
            media_type: "CAROUSEL_ALBUM",
            media_url: "https://scontent.cdninstagram.com/cover",
            children: {
              data: [
                {
                  media_type: "IMAGE",
                  media_url: "https://scontent.cdninstagram.com/photo",
                },
                {
                  media_type: "VIDEO",
                  media_url: "https://scontent.cdninstagram.com/video",
                },
              ],
            },
          },
        ],
      },
      "instagram",
    ),
    [
      {
        postId: "ig-post-1",
        title: "السعر 30",
        body: "السعر 30",
        mediaUrls: ["https://scontent.cdninstagram.com/photo"],
      },
    ],
  );
});

test("normalizes a direct Meta post lookup response", () => {
  assert.deepEqual(
    normalizeMetaPublishedPosts(
      { id: "ig-post-2", caption: "منتج", media_type: "IMAGE" },
      "instagram",
    ),
    [
      {
        postId: "ig-post-2",
        title: "منتج",
        body: "منتج",
        mediaUrls: [],
      },
    ],
  );
});
