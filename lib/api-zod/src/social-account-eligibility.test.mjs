import assert from "node:assert/strict";
import test from "node:test";
import { hasEligibleSocialConnection } from "./social-account-eligibility.ts";

test("only ready Facebook or Instagram accounts satisfy onboarding", () => {
  assert.equal(
    hasEligibleSocialConnection({
      facebook: { authorizationStatus: "ready" },
      instagram: null,
      whatsapp: null,
    }),
    true,
  );
  assert.equal(
    hasEligibleSocialConnection({
      facebook: null,
      instagram: { authorizationStatus: "ready" },
      whatsapp: null,
    }),
    true,
  );
});

test("Meta accounts requiring reauthorization do not satisfy onboarding", () => {
  assert.equal(
    hasEligibleSocialConnection({
      facebook: { authorizationStatus: "needs_reauthorization" },
      instagram: null,
      whatsapp: null,
    }),
    false,
  );
  assert.equal(
    hasEligibleSocialConnection({
      facebook: null,
      instagram: { authorizationStatus: "needs_reauthorization" },
      whatsapp: null,
    }),
    false,
  );
});

test("WhatsApp qualifies only when provider state is connected", () => {
  assert.equal(
    hasEligibleSocialConnection({
      facebook: null,
      instagram: null,
      whatsapp: { connectionState: "connected" },
    }),
    true,
  );
  assert.equal(
    hasEligibleSocialConnection({
      facebook: null,
      instagram: null,
      whatsapp: { connectionState: "connecting" },
    }),
    false,
  );
  assert.equal(
    hasEligibleSocialConnection({
      facebook: null,
      instagram: null,
      whatsapp: { connected: true },
    }),
    false,
  );
});
