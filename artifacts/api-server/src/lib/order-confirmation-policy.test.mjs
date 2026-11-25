import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  confirmationAttemptsExhausted,
  META_CONFIRMATION_LEASE_MS,
  ORDER_CONFIRMATION_MAX_ATTEMPTS,
  WHATSAPP_CONFIRMATION_LEASE_MS,
} from "./order-confirmation-policy.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ordersSchema = readFileSync(
  join(root, "lib", "db", "src", "schema", "orders.ts"),
  "utf8",
);

test("the retry ceiling is the one the database check enforces on the counter", () => {
  // A ceiling above the check would make the claim's increment fail on
  // `whatsapp_confirmation_attempts BETWEEN 0 AND 3` instead of marking the row
  // exhausted — a stuck order rather than a finished one.
  const match = /whatsappConfirmationAttempts\}\s*BETWEEN 0 AND (\d+)/.exec(
    ordersSchema,
  );
  assert.ok(match, "the attempts check is missing from the orders schema");
  assert.equal(ORDER_CONFIRMATION_MAX_ATTEMPTS, Number(match[1]));
});

test("a row is exhausted on its last attempt, not before", () => {
  assert.equal(confirmationAttemptsExhausted(0), false);
  assert.equal(confirmationAttemptsExhausted(ORDER_CONFIRMATION_MAX_ATTEMPTS - 1), false);
  assert.equal(confirmationAttemptsExhausted(ORDER_CONFIRMATION_MAX_ATTEMPTS), true);
  assert.equal(confirmationAttemptsExhausted(ORDER_CONFIRMATION_MAX_ATTEMPTS + 1), true);
});

test("each channel's lease is pinned: a stale row is reaped after a minute on WhatsApp, ninety seconds on Meta", () => {
  // Changing either value changes how long a dead worker's order waits before
  // another worker picks it up; the numbers are asserted so that is a decision,
  // not an accident.
  assert.equal(WHATSAPP_CONFIRMATION_LEASE_MS, 60_000);
  assert.equal(META_CONFIRMATION_LEASE_MS, 90_000);
});
