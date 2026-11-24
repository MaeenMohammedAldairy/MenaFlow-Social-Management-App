import assert from "node:assert/strict";
import test from "node:test";

import {
  isMessageQueueEligible,
  queueEligibilityPolicy,
} from "./product-extraction-queue-eligibility.ts";

const visionOff = queueEligibilityPolicy({ visionExtractionEnabled: false });
const visionOn = queueEligibilityPolicy({ visionExtractionEnabled: true });

test("a message with text is always worth queueing", () => {
  assert.deepEqual(visionOff, {
    admitTextMessages: true,
    admitMediaOnlyMessages: false,
  });
  assert.equal(
    isMessageQueueEligible({ hasText: true, mediaAvailable: false }, visionOff),
    true,
  );
  assert.equal(
    isMessageQueueEligible({ hasText: true, mediaAvailable: true }, visionOn),
    true,
  );
});

test("a caption counts as text", () => {
  // The caller derives `hasText` from text_body OR caption, the same pair the
  // extractor reads; a photo with a caption is a text message as far as the
  // queue is concerned.
  assert.equal(
    isMessageQueueEligible({ hasText: true, mediaAvailable: true }, visionOff),
    true,
  );
});

test("a photo with nothing written on it is queued only when something can read it", () => {
  assert.equal(
    isMessageQueueEligible({ hasText: false, mediaAvailable: true }, visionOff),
    false,
    "with vision off the job could only end in PRODUCT_TEXT_REQUIRED",
  );
  assert.equal(
    isMessageQueueEligible({ hasText: false, mediaAvailable: true }, visionOn),
    true,
  );
  assert.deepEqual(visionOn, {
    admitTextMessages: true,
    admitMediaOnlyMessages: true,
  });
});

test("a message with neither text nor media is never queued", () => {
  assert.equal(
    isMessageQueueEligible({ hasText: false, mediaAvailable: false }, visionOn),
    false,
  );
  assert.equal(
    isMessageQueueEligible({ hasText: false, mediaAvailable: false }, visionOff),
    false,
  );
});

test("the flag is read from the environment the same way the worker reads it", () => {
  // `visionProductExtractionEnabled()` accepts true/1/yes and nothing else; the
  // policy only has to be a faithful function of that boolean.
  for (const enabled of [true, false]) {
    assert.equal(
      queueEligibilityPolicy({ visionExtractionEnabled: enabled })
        .admitMediaOnlyMessages,
      enabled,
    );
  }
});
