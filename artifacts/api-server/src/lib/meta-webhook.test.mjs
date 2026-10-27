import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  parseMetaWebhookEvents,
  verifyMetaWebhookSignature,
} from "./meta-webhook.ts";

test("verifies Meta webhook signatures against the exact request body", () => {
  const body = Buffer.from('{"object":"page"}');
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyMetaWebhookSignature(body, signature, "secret"), true);
  assert.equal(verifyMetaWebhookSignature(body, signature, "wrong"), false);
  assert.equal(verifyMetaWebhookSignature(body, undefined, "secret"), false);
});

test("parses Facebook messages and new comments without echo events", () => {
  const events = parseMetaWebhookEvents(
    {
      entry: [
        {
          id: "page-1",
          time: 1_797_000_000,
          messaging: [
            {
              sender: { id: "person-1" },
              timestamp: 1_797_000_001,
              message: { mid: "message-1", text: "Hello" },
            },
            {
              sender: { id: "page-1" },
              message: { mid: "echo-1", text: "Echo", is_echo: true },
            },
          ],
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "comment-1",
                post_id: "post-1",
                from: { id: "person-2", name: "Visitor" },
                message: "Nice post",
              },
            },
          ],
        },
      ],
    },
    "facebook",
  );

  assert.deepEqual(
    events.map(({ kind, externalId, conversationId, text }) => ({
      kind,
      externalId,
      conversationId,
      text,
    })),
    [
      {
        kind: "message",
        externalId: "message-1",
        conversationId: "person-1",
        text: "Hello",
      },
      {
        kind: "comment",
        externalId: "comment-1",
        conversationId: "post-1",
        text: "Nice post",
      },
    ],
  );
});

test("parses Instagram direct messages and comments", () => {
  const events = parseMetaWebhookEvents(
    {
      entry: [
        {
          id: "instagram-1",
          time: 1_797_000_000,
          messaging: [
            {
              sender: { id: "person-1" },
              message: { mid: "ig-message-1", text: "Question" },
            },
          ],
          changes: [
            {
              field: "comments",
              value: {
                id: "ig-comment-1",
                text: "Looks great",
                from: { id: "person-2", username: "visitor" },
                media: { id: "media-1" },
              },
            },
          ],
        },
      ],
    },
    "instagram",
  );

  assert.equal(events.length, 2);
  assert.equal(events[0]?.platform, "instagram");
  assert.equal(events[0]?.conversationId, "person-1");
  assert.equal(events[1]?.externalId, "ig-comment-1");
  assert.equal(events[1]?.parentId, "media-1");
  assert.equal(events[1]?.actorName, "visitor");
});

test("extracts secure attachment previews from messages", () => {
  const [event] = parseMetaWebhookEvents(
    {
      entry: [
        {
          id: "page-1",
          messaging: [
            {
              sender: { id: "person-1" },
              message: {
                mid: "media-message",
                attachments: [
                  {
                    type: "image",
                    payload: {
                      url: "https://cdn.example.com/photo.jpg",
                    },
                  },
                  {
                    type: "video",
                    payload: {
                      url: "http://cdn.example.com/video.mp4",
                      thumbnail_url: "https://cdn.example.com/preview.jpg",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    "facebook",
  );

  assert.deepEqual(event?.media, [
    {
      type: "image",
      url: "https://cdn.example.com/photo.jpg",
      thumbnailUrl: null,
    },
    {
      type: "video",
      url: null,
      thumbnailUrl: "https://cdn.example.com/preview.jpg",
    },
  ]);
});
