import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  parseMetaWebhookEvents,
  resolveUniqueMetaConnection,
  verifyMetaWebhookSignature,
} from "./meta-webhook.ts";

test("resolves only a single Meta connection candidate", () => {
  const connection = { workspaceId: "workspace-1" };
  assert.equal(resolveUniqueMetaConnection([]), null);
  assert.equal(resolveUniqueMetaConnection([connection]), connection);
  assert.equal(
    resolveUniqueMetaConnection([connection, { workspaceId: "workspace-2" }]),
    null,
  );
});

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

test("ignores duplicate comment ids so re-delivered webhooks do not enqueue twice", () => {
  const payload = {
    entry: [
      {
        id: "page-1",
        time: 1_797_000_000,
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "comment-dup",
              post_id: "post-1",
              from: { id: "person-2", name: "Visitor" },
              message: "Same comment delivered twice",
            },
          },
        ],
      },
    ],
  };
  const first = parseMetaWebhookEvents(payload, "facebook");
  const second = parseMetaWebhookEvents(payload, "facebook");
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0]?.externalId, second[0]?.externalId);
});

test("skips removed comments and non-comment feed items", () => {
  const events = parseMetaWebhookEvents(
    {
      entry: [
        {
          id: "page-1",
          time: 1_797_000_000,
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "remove",
                comment_id: "comment-gone",
                post_id: "post-1",
              },
            },
            {
              field: "feed",
              value: {
                item: "post",
                verb: "add",
                post_id: "post-new",
              },
            },
          ],
        },
      ],
    },
    "facebook",
  );
  assert.deepEqual(events, []);
});

test("skips comments written by the page account itself", () => {
  const events = parseMetaWebhookEvents(
    {
      entry: [
        {
          id: "page-1",
          time: 1_797_000_000,
          changes: [
            {
              field: "feed",
              value: {
                item: "comment",
                verb: "add",
                comment_id: "comment-own",
                post_id: "post-1",
                from: { id: "page-1", name: "My Page" },
                message: "Self reply",
              },
            },
          ],
        },
      ],
    },
    "facebook",
  );
  assert.deepEqual(events, []);
});
