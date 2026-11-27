import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { mock } from "node:test";

import {
  MAX_VISION_IMAGES,
  prepareVisionImage,
  selectVisionMedia,
  visionMediaStorageLocator,
  visionProductExtractionEnabled,
} from "./product-vision-extraction.ts";

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

// The vision path used to be a second request whose answer was merged over the
// first one's. These tests now hold the shape that replaced it: one request for
// a group, carrying its text and its images together, grounded in the visible
// text the model reports — and no database identifier in it.
const sent = [];
const realMetered = await import("./metered-ai-provider.ts");
mock.module("./metered-ai-provider.ts", {
  namedExports: {
    callMeteredAiProvider: async (_workspaceId, options) => {
      sent.push(options);
      return { model: "vision-test-model", content: visionAnswer };
    },
    // `textAiProviderOptions` is the request shape, not a transport detail —
    // faking it here is what let a `{system, user}` object pass every assertion
    // while both providers rejected it (`GEMINI_CONTENTS_REQUIRED`,
    // `OPENAI_MESSAGES_REQUIRED`) and twelve extraction jobs died in the live
    // workspace. The real one stays, and the tests below read the built bodies.
    textAiProviderOptions: realMetered.textAiProviderOptions,
  },
});
const { buildGeminiRequestBody, buildOpenAiRequestBody } = await import(
  "./ai-provider.ts"
);
const { PRODUCT_EXTRACTION_PROMPT_VERSION } = await import(
  "./product-extraction-prompt-version.ts",
);
const { extractWhatsAppProductCandidates } = await import("./product-extraction.ts");

const groupSource = (overrides = {}) => ({
  id: "0f0f0f0f-0000-4000-8000-000000000001",
  groupId: "bundle:0f0f",
  messageTimestamp: "2026-11-24T02:20:00.000Z",
  replyToMessageId: null,
  text: "نص الرسالة لا يصل إلى النموذج في طلب الصور",
  ...overrides,
});

let visionAnswer = "";
visionAnswer = JSON.stringify({
  visibleText: "زيت أفغاني 100 مل السعر 45 ريال",
  products: [
    {
      sourceMessageIds: ["1"],
      data: {
        name: "زيت أفغاني",
        sku: null,
        aliases: [],
        description: "زيت أفغاني 100 مل",
        price: "45",
        currency: "SAR",
        availability: null,
        features: [{ value: "100 مل", evidence: "100 مل" }],
        specifications: [],
        accessories: [],
      },
      evidence: {
        name: "زيت أفغاني",
        price: "السعر 45 ريال",
        currency: "ريال",
      },
      confidence: {
        name: 0.9, price: 0.9, currency: 0.9, sku: 0, aliases: 0,
        description: 0.9, availability: 0,
      },
    },
  ],
  nonProductMessageIds: [],
});

test("the group's photos ride in the same request as its text", async () => {
  sent.length = 0;
  const result = await extractWhatsAppProductCandidates("workspace-a", [groupSource()], {
    images: [
      { mimeType: "image/jpeg", dataBase64: "QUJD" },
      { mimeType: "image/jpeg", dataBase64: "REVG" },
    ],
    imageSourceIds: ["0f0f0f0f-0000-4000-8000-000000000001"],
  });
  const [options] = sent;
  assert.equal(sent.length, 1, "one reading of the group means one request");
  assert.equal(options.images.length, 2);
  // The two shapes each provider has to be handed, checked through the builders
  // that produce the wire bodies — a key neither provider reads is not a request.
  const geminiBody = buildGeminiRequestBody(options);
  const openAiBody = buildOpenAiRequestBody(options);
  const geminiParts = geminiBody.contents.at(-1).parts;
  const geminiText = geminiParts.map((part) => part.text ?? "").join("");
  assert.match(geminiText, /"id":"1"/, "gemini got the source json");
  assert.equal(
    geminiParts.filter((part) => part.inlineData).length,
    2,
    "both photos ride in the same gemini turn",
  );
  assert.match(geminiBody.systemInstruction.parts[0].text, /visibleText/);
  const openAiUser = openAiBody.messages.at(-1).content;
  const openAiText = openAiUser
    .map((part) => (typeof part === "string" ? part : part.text ?? ""))
    .join("");
  assert.match(openAiText, /"id":"1"/, "openai got the source json");
  assert.equal(
    openAiUser.filter((part) => part?.type === "image_url").length,
    2,
    "both photos ride in the same openai turn",
  );
  assert.equal(openAiBody.messages[0].role, "system");
  assert.equal(options.temperature, 0);
  // Facts and a transcription in the same answer need more room than the old
  // 3000-token ceiling, which truncated a 13-photo album mid-product.
  assert.ok(options.maxTokens >= 6000, `maxTokens ${options.maxTokens}`);
  // Every assertion above reads the bodies the providers are actually sent.
  // An earlier version read `options.system` / `options.user`, keys of
  // `AiProviderOptions` only in the mock that returned the caller's own object;
  // that pairing is what let a request shape neither provider accepts pass CI
  // while every live job died with GEMINI_CONTENTS_REQUIRED.
  const instructions = [
    geminiBody.systemInstruction.parts[0].text,
    openAiBody.messages[0].content,
  ];
  for (const instruction of instructions) {
    assert.match(instruction, /visibleText/);
    assert.match(instruction, /بيانات للتحليل/);
  }
  // The group's own words are in the user turn of BOTH shapes — the images are a
  // modifier on an ordinary request, never a request of their own.
  assert.match(geminiText, /نص الرسالة لا يصل إلى النموذج/);
  assert.match(openAiText, /نص الرسالة لا يصل إلى النموذج/);
  assert.ok(
    options.geminiContents && options.openAiMessages && options.geminiSystemInstruction,
    "a vision request carries the same keys a text request does",
  );
  const serialized = JSON.stringify([geminiBody, openAiBody]);
  // The message's words are the other half of the reading and ARE sent; what
  // must never leave the server is the identifier behind them.
  assert.doesNotMatch(serialized, /0f0f0f0f/, "database ids are not sent");
  assert.doesNotMatch(serialized, /"groupId":"bundle/, "group keys are not sent");
  assert.equal(result.model, "vision-test-model");
  assert.equal(result.promptVersion, PRODUCT_EXTRACTION_PROMPT_VERSION);
  assert.equal(JSON.parse(result.rawResponse).visibleText.includes("زيت أفغاني"), true);
});

test("a fact read off a photo survives; one invented past it does not", async () => {
  sent.length = 0;
  const { candidates } = await extractWhatsAppProductCandidates("workspace-a", [
    groupSource({ text: "" }),
  ], {
    images: [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
    imageSourceIds: ["0f0f0f0f-0000-4000-8000-000000000001"],
  });
  // The message said nothing: everything the candidate carries came from the
  // photo, and each value was checked against the text the model read in it.
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].data.price, "45");
  assert.equal(candidates[0].data.priceStatus, "confirmed");
  assert.equal(candidates[0].facts.features[0].value, "100 مل");
  // A value the photo does not contain is dropped by the same rule that drops an
  // invented price — the transcription is the corpus, not the model's memory.
  visionAnswer = JSON.stringify({
    visibleText: "زيت أفغاني 100 مل السعر 45 ريال",
    products: [
      {
        sourceMessageIds: ["1"],
        data: {
          name: "زيت أفغاني عضوي فاخر",
          sku: "VF-9999",
          aliases: [],
          description: "يعالج آلام المفاصل خلال يومين",
          price: "45",
          currency: "SAR",
          availability: "in_stock",
          features: [],
          specifications: [],
          accessories: [],
        },
        evidence: {
          name: "زيت أفغاني عضوي فاخر",
          price: "السعر 45 ريال",
          currency: "ريال",
        },
        confidence: {
          name: 0.99, price: 0.9, currency: 0.9, sku: 0.9, aliases: 0,
          description: 0.95, availability: 0.9,
        },
      },
    ],
    nonProductMessageIds: [],
  });
  const invented = await extractWhatsAppProductCandidates("workspace-a", [
    groupSource({ text: "" }),
  ], {
    images: [{ mimeType: "image/jpeg", dataBase64: "QUJD" }],
    imageSourceIds: ["0f0f0f0f-0000-4000-8000-000000000001"],
  });
  const [item] = invented.candidates;
  // Dropped, not repaired: a name the photo does not carry is not the model's to
  // shorten until it fits. The grounded price next to it is kept, so the row is a
  // review with numbers in it rather than an empty card.
  assert.equal(item.data.name, null);
  assert.equal(item.data.sku, null);
  assert.equal(item.data.description, null);
  assert.equal(item.data.availability, null);
  assert.equal(item.data.price, "45");
  assert.equal(item.complete, false, "an image reading is never auto-published");
});

test("a request without images asks for no transcription", async () => {
  sent.length = 0;
  await extractWhatsAppProductCandidates("workspace-a", [groupSource()], {});
  const [options] = sent;
  assert.equal(options.images, undefined);
  // Read the instruction the providers actually receive, not a key of the local
  // object: without images there is nothing to transcribe, and the request must
  // not ask for a `visibleText` field the answer would then have to invent.
  const instructions = [
    buildGeminiRequestBody(options).systemInstruction.parts[0].text,
    buildOpenAiRequestBody(options).messages[0].content,
  ];
  for (const instruction of instructions) {
    assert.doesNotMatch(instruction, /visibleText/);
  }
  assert.ok(options.maxTokens < 6000, "a text-only answer needs less room");
});
