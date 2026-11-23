import assert from "node:assert/strict";
import test from "node:test";
import { parseDatabaseUrl } from "./connection-url.ts";

const HOST = "aws-0-ap-south-1.pooler.supabase.com";
const USER = "postgres.qznbujvanjvkfxpehcbq";
const PASSWORD = ".4c8*p.xJRd?Kpg";

test("a plain connection string parses", () => {
  const url = parseDatabaseUrl(`postgresql://${USER}:secret@${HOST}:5432/postgres`);
  assert.equal(url.hostname, HOST);
  assert.equal(url.port, "5432");
  assert.equal(url.username, USER);
});

test("a percent-encoded password parses and decodes back to itself", () => {
  // The shape that fixed the 2026-11-23 Render crash: the same password, encoded.
  const url = parseDatabaseUrl(
    `postgresql://${USER}:${encodeURIComponent(PASSWORD)}@${HOST}:5432/postgres`,
  );
  assert.equal(url.hostname, HOST);
  assert.equal(decodeURIComponent(url.password), PASSWORD);
});

test("an un-encoded '?' in the password is refused with guidance", () => {
  // Exactly the string shape that crashed startup: the '?' ends the authority,
  // so the host never parses and `new URL` throws.
  let error;
  try {
    parseDatabaseUrl(`postgresql://${USER}:${PASSWORD}@${HOST}:5432/postgres`);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, "كان يجب أن ترفض السلسلة");
  assert.match(error.message, /percent-encoded/i);
  assert.match(error.message, /DATABASE_URL/);
});

test("the refusal never echoes the credential", () => {
  // The whole reason this helper exists: Node's ERR_INVALID_URL prints `input`,
  // which put the password in the deployment log. The replacement must not.
  let error;
  try {
    parseDatabaseUrl(`postgresql://${USER}:${PASSWORD}@${HOST}:5432/postgres`);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.ok(
    !error.message.includes(PASSWORD),
    "رسالة الخطأ تسرّب كلمة المرور",
  );
});

test("an un-encoded '#' in the password is refused too", () => {
  assert.throws(
    () => parseDatabaseUrl(`postgresql://${USER}:a#b@${HOST}:5432/postgres`),
    /percent-encoded/i,
  );
});

test("an empty value is refused rather than constructing a pool-less URL", () => {
  assert.throws(() => parseDatabaseUrl(""), /DATABASE_URL/);
});
