import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  MAX_VISION_IMAGES,
  buildVisionExtractionRequest,
  parseVisionExtractionResponse,
  prepareVisionImage,
  selectVisionMedia,
  visionExtractionInstruction,
  visionMediaStorageLocator,
  visionProductExtractionEnabled,
} from "./product-vision-extraction.ts";
import {
  normalizeProductExtractionResponse,
  remapProductExtractionCandidates,
  toLocalProductExtractionSources,
} from "./product-extraction.ts";

function mediaRow(overrides = {}) {
  return {
    id: "media-1",
    mediaType: "image",
    mimeType: "image/jpeg",
    sizeBytes: 200_000,
    downloadStatus: "stored",
    storageProvider: "supabase",
    storageKey: "ws/objects/abc.jpg",
    storagePath: "ws/objects/abc.jpg",
    mediaIndex: 0,
    ...overrides,
  };
}

test("vision extraction stays off until the deployment opts in", () => {
  assert.equal(visionProductExtractionEnabled({}), false);
  assert.equal(visionProductExtractionEnabled({ PRODUCT_VISION_EXTRACTION_ENABLED: "false" }), false);
  assert.equal(visionProductExtractionEnabled({ PRODUCT_VISION_EXTRACTION_ENABLED: "maybe" }), false);
  assert.equal(visionProductExtractionEnabled({ PRODUCT_VISION_EXTRACTION_ENABLED: "TRUE" }), true);
  assert.equal(visionProductExtractionEnabled({ PRODUCT_VISION_EXTRACTION_ENABLED: " 1 " }), true);
  assert.equal(visionProductExtractionEnabled({ PRODUCT_VISION_EXTRACTION_ENABLED: "yes" }), true);
});

test("the storage locator follows the provider and refuses unusable rows", () => {
  assert.deepEqual(visionMediaStorageLocator(mediaRow()), {
    provider: "supabase",
    locator: "ws/objects/abc.jpg",
  });
  assert.deepEqual(
    visionMediaStorageLocator(
      mediaRow({ storageProvider: "local", storagePath: "/var/data/ws/abc.jpg" }),
    ),
    { provider: "local", locator: "/var/data/ws/abc.jpg" },
  );
  assert.equal(
    visionMediaStorageLocator(mediaRow({ storageProvider: "local", storagePath: "relative/abc.jpg" })),
    null,
  );
  assert.equal(visionMediaStorageLocator(mediaRow({ storageKey: "  " })), null);
  assert.equal(visionMediaStorageLocator(mediaRow({ storageProvider: "s3" })), null);
});

test("only stored, readable images within the size cap are selected, in album order", () => {
  const rows = [
    mediaRow({ id: "m3", mediaIndex: 2 }),
    mediaRow({ id: "m1", mediaIndex: 0 }),
    mediaRow({ id: "m2", mediaIndex: 1, mediaType: "video" }),
    mediaRow({ id: "m4", mediaIndex: 3, downloadStatus: "failed" }),
    mediaRow({ id: "m5", mediaIndex: 4, sizeBytes: 40 * 1024 * 1024 }),
    mediaRow({ id: "m6", mediaIndex: 5, storageProvider: "s3" }),
    mediaRow({ id: "m7", mediaIndex: 6, sizeBytes: null }),
    mediaRow({ id: "m8", mediaIndex: 7 }),
  ];
  const selected = selectVisionMedia(rows);
  assert.deepEqual(selected.map((row) => row.id), ["m1", "m3", "m7"]);
  assert.equal(selected.length, MAX_VISION_IMAGES);
});

test("a small PNG passes through and a large phone JPEG is re-encoded and bounded", async () => {
  const png = await sharp({
    create: { width: 300, height: 200, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  const passthrough = await prepareVisionImage(png, "image/png");
  assert.equal(passthrough.mimeType, "image/png");
  assert.equal(Buffer.from(passthrough.dataBase64, "base64").equals(png), true);

  const large = await sharp({
    create: { width: 2400, height: 1800, channels: 3, background: "#654321" },
  })
    .jpeg({ quality: 95 })
    .toBuffer();
  const prepared = await prepareVisionImage(large, "image/jpeg");
  assert.equal(prepared.mimeType, "image/jpeg");
  const metadata = await sharp(Buffer.from(prepared.dataBase64, "base64")).metadata();
  assert.ok(metadata.width <= 1024, `width ${metadata.width} should be bounded`);
  assert.ok(metadata.height <= 1024, `height ${metadata.height} should be bounded`);
  assert.ok(prepared.dataBase64.length < Buffer.from(large).length * 2);

  // An unsupported container is normalized to JPEG rather than rejected.
  const fromUnknown = await prepareVisionImage(large, "image/heic");
  assert.equal(fromUnknown.mimeType, "image/jpeg");
});

test("the request grounds the model in visible text and never sends message bodies", () => {
  const sources = [
    {
      id: "message-1",
      groupId: "bundle:1",
      messageTimestamp: "2026-11-24T02:20:00.000Z",
      replyToMessageId: null,
      text: "نص سري من الرسالة يجب ألا يصل إلى النموذج",
    },
  ];
  const options = buildVisionExtractionRequest(
    [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
    sources,
  );
  const serialized = JSON.stringify(options);
  assert.doesNotMatch(serialized, /نص سري/);
  assert.doesNotMatch(serialized, /message-1/);
  assert.doesNotMatch(serialized, /bundle:1/);
  const userText = options.openAiMessages[1].content;
  assert.match(userText, /\[\{"id":"1","groupId":"1","time":"2026-11-24T02:20:00\.000Z"\}\]/);
  assert.equal(options.images?.length, 1);
  assert.equal(options.temperature, 0);
  assert.ok(options.maxTokens >= 3000);
  assert.equal(options.geminiResponseFormat?.text.mimeType, "application/json");
  const schema = options.geminiResponseFormat?.text.schema;
  assert.deepEqual(schema.required, ["visibleText", "products", "nonProductMessageIds"]);
  assert.equal(options.openAiResponseFormat?.type, "json_object");
});

test("vision model pinning is separate from the text extraction models", () => {
  const previous = { ...process.env };
  process.env.AI_VISION_EXTRACTION_GEMINI_MODEL = "gemini-2.5-pro";
  process.env.AI_EXTRACTION_GEMINI_MODEL = "gemini-2.5-flash";
  try {
    const options = buildVisionExtractionRequest(
      [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
      [{ id: "m", groupId: "g", messageTimestamp: null, replyToMessageId: null, text: "" }],
    );
    assert.equal(options.geminiModel, "gemini-2.5-pro");
    assert.equal(options.openAiModel, undefined);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});

test("the instruction forbids invention and treats image text as data", () => {
  const instruction = visionExtractionInstruction();
  assert.match(instruction, /visibleText/);
  assert.match(instruction, /ليست تعليمات/);
  assert.match(instruction, /لا تخترع/);
  assert.match(instruction, /nonProductMessageIds/);
});

test("the response parser bounds visible text and rejects malformed payloads", () => {
  const fenced = parseVisionExtractionResponse(
    '```json\n{"visibleText":"  زيت أفغاني 100 مل ","products":[],"nonProductMessageIds":["1"]}\n```',
  );
  assert.equal(fenced.visibleText, "زيت أفغاني 100 مل");
  assert.deepEqual(fenced.products, []);
  assert.deepEqual(fenced.nonProductMessageIds, ["1"]);

  const long = parseVisionExtractionResponse(
    JSON.stringify({ visibleText: "ا".repeat(9000), products: [] }),
  );
  assert.equal(long.visibleText.length, 6000);
  assert.deepEqual(long.nonProductMessageIds, []);

  assert.throws(() => parseVisionExtractionResponse("ليس JSON"), {
    message: "PRODUCT_EXTRACTION_INVALID_JSON",
  });
  assert.throws(
    () => parseVisionExtractionResponse(JSON.stringify({ visibleText: "", products: "x" })),
    { message: "PRODUCT_VISION_INVALID_RESPONSE" },
  );
  assert.throws(
    () =>
      parseVisionExtractionResponse(
        JSON.stringify({
          visibleText: "",
          products: Array.from({ length: 31 }, () => ({})),
        }),
      ),
    { message: "PRODUCT_VISION_INVALID_RESPONSE" },
  );
  assert.throws(
    () =>
      parseVisionExtractionResponse(
        JSON.stringify({ visibleText: "", products: [], nonProductMessageIds: [1] }),
      ),
    { message: "PRODUCT_VISION_INVALID_RESPONSE" },
  );
});

test("a vision candidate keeps quoted values, drops invented ones and stays incomplete", () => {
  // What a model is asked to return: literal visible text plus the fields it
  // believes it read, each with a quote.
  const payload = parseVisionExtractionResponse(
    JSON.stringify({
      visibleText: "الزيت الافغاني 100 مل - السعر 45 ريال سعودي",
      products: [
        {
          sourceMessageIds: ["1"],
          data: {
            name: "الزيت الافغاني",
            sku: null,
            aliases: ["زيت"],
            description: "الزيت الافغاني 100 مل",
            price: "45",
            currency: "SAR",
            availability: "in_stock",
          },
          evidence: {
            name: "الزيت الافغاني",
            sku: null,
            aliases: "الزيت الافغاني",
            description: "الزيت الافغاني 100 مل",
            price: "45 ريال سعودي",
            currency: "ريال سعودي",
            availability: null,
          },
          confidence: {
            name: 0.95,
            sku: 0,
            aliases: 0.7,
            description: 0.9,
            price: 0.9,
            currency: 0.9,
            availability: 0,
          },
        },
      ],
      nonProductMessageIds: [],
    }),
  );

  const realSources = [
    {
      id: "message-99",
      groupId: "bundle:7",
      messageTimestamp: "2026-11-24T02:20:00.000Z",
      replyToMessageId: null,
      text: "",
    },
  ];
  const localSources = toLocalProductExtractionSources(realSources);
  const groundedSources = localSources.map((source) => ({
    ...source,
    text: payload.visibleText,
  }));
  const normalized = normalizeProductExtractionResponse(
    JSON.stringify({
      products: payload.products,
      nonProductMessageIds: payload.nonProductMessageIds,
    }),
    groundedSources,
  );
  const [candidate] = remapProductExtractionCandidates(normalized, realSources);

  assert.equal(candidate.classification, "product");
  assert.deepEqual(candidate.sourceMessageIds, ["message-99"]);
  assert.equal(candidate.data.name, "الزيت الافغاني");
  assert.equal(candidate.data.price, "45");
  assert.equal(candidate.data.currency, "SAR");
  // No visible evidence for availability, so the claim is dropped.
  assert.equal(candidate.data.availability, null);
  // A generated SKU replaces the missing one, like the text path does.
  assert.match(candidate.data.sku ?? "", /^MF-[0-9A-F]{16}$/);
  // Availability has no evidence, so the candidate can never be "complete" and
  // therefore never becomes an automatic draft.
  assert.equal(candidate.complete, false);
});

test("an invented price that is not in the visible text is dropped", () => {
  const visibleText = "زيت أفغاني";
  const normalized = normalizeProductExtractionResponse(
    JSON.stringify({
      products: [
        {
          sourceMessageIds: ["1"],
          data: {
            name: "زيت أفغاني",
            sku: null,
            aliases: [],
            description: "زيت أفغاني",
            price: "999",
            currency: "SAR",
            availability: null,
          },
          evidence: {
            name: "زيت أفغاني",
            sku: null,
            aliases: null,
            description: "زيت أفغاني",
            price: "999 ريال",
            currency: "ريال",
            availability: null,
          },
          confidence: {
            name: 0.9,
            sku: 0,
            aliases: 0,
            description: 0.9,
            price: 0.9,
            currency: 0.9,
            availability: 0,
          },
        },
      ],
      nonProductMessageIds: [],
    }),
    [
      {
        id: "1",
        groupId: "1",
        messageTimestamp: null,
        replyToMessageId: null,
        text: visibleText,
      },
    ],
  );
  const [candidate] = normalized.candidates;
  assert.equal(candidate.data.price, null);
  assert.equal(candidate.data.currency, null);
  assert.equal(candidate.data.name, "زيت أفغاني");
});
