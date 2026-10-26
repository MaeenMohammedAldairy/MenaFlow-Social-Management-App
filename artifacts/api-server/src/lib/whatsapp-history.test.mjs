import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppHistoryQuery,
  extractWhatsAppHistoryRecords,
  filterWhatsAppHistoryAfter,
  parseWhatsAppHistoryTimestamp,
} from "./whatsapp-history.ts";
import { filterHistoryRecordsForGroup } from "./whatsapp-message-scope.ts";

test("filters historical records to messages newer than the saved cursor", () => {
  const since = new Date("2026-10-23T00:00:00.000Z");
  const records = [
    { messageTimestamp: Math.floor(since.getTime() / 1000) - 1 },
    { messageTimestamp: Math.floor(since.getTime() / 1000) + 1 },
    { message: { timestamp: Math.floor(since.getTime() / 1000) + 2 } },
    { messageTimestamp: String(Math.floor(since.getTime() / 1000) + 3) },
    { messageTimestamp: since.getTime() + 4_000 },
    { timestamp: String(since.getTime() + 5_000) },
    { t: new Date(since.getTime() + 6_000).toISOString() },
    { messageTimestamp: "invalid" },
  ];

  assert.deepEqual(filterWhatsAppHistoryAfter(records, since), [
    records[1],
    records[2],
    records[3],
    records[4],
    records[5],
    records[6],
  ]);
});

test("queries group history using Evolution's supported remoteJid filter", () => {
  assert.deepEqual(
    buildWhatsAppHistoryQuery("120363012345678901@g.us", 100),
    {
      where: {
        key: {
          remoteJid: "120363012345678901@g.us",
        },
      },
      offset: 100,
      page: 1,
    },
  );
  assert.deepEqual(
    buildWhatsAppHistoryQuery(
      "120363012345678901@g.us",
      100,
      "remoteJidAlt",
    ),
    {
      where: {
        key: {
          remoteJidAlt: "120363012345678901@g.us",
        },
      },
      offset: 100,
      page: 1,
    },
  );
});

test("extracts history records from Evolution response envelopes", () => {
  const messages = [{ key: { remoteJid: "120363012345678901@g.us" } }];
  assert.deepEqual(extractWhatsAppHistoryRecords({ messages }), messages);
  assert.deepEqual(
    extractWhatsAppHistoryRecords({ messages: { records: messages } }),
    messages,
  );
  assert.deepEqual(
    extractWhatsAppHistoryRecords({ data: { messages: { records: messages } } }),
    messages,
  );
  assert.deepEqual(
    extractWhatsAppHistoryRecords({ messages: { records: [] } }),
    [],
  );
  assert.equal(extractWhatsAppHistoryRecords({ error: "unsupported" }), null);
});

test("filters group history records that store the group JID as the alternate JID", () => {
  const groupJid = "120363012345678901@g.us";
  const record = {
    key: {
      remoteJid: "123456789012345@lid",
      remoteJidAlt: groupJid,
      id: "message-1",
    },
  };

  assert.deepEqual(filterHistoryRecordsForGroup([record], groupJid), [record]);
  assert.equal(record.key.remoteJid, "123456789012345@lid");
  assert.equal(record.key.remoteJidAlt, groupJid);
});

test("parses WhatsApp timestamps in seconds, milliseconds, and ISO format", () => {
  const seconds = 1_800_000_000;
  const milliseconds = 1_800_000_000_000;
  assert.equal(
    parseWhatsAppHistoryTimestamp(seconds)?.getTime(),
    milliseconds,
  );
  assert.equal(
    parseWhatsAppHistoryTimestamp(String(milliseconds))?.getTime(),
    milliseconds,
  );
  assert.equal(
    parseWhatsAppHistoryTimestamp(
      new Date(milliseconds).toISOString(),
    )?.getTime(),
    milliseconds,
  );
  assert.equal(parseWhatsAppHistoryTimestamp("invalid"), null);
});
