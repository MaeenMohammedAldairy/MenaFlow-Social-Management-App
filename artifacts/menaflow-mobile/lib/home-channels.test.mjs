import assert from "node:assert/strict";
import test from "node:test";
import {
  channelSignals,
  homeChannels,
  pickPendingPost,
} from "./home-channels.ts";

const instagram = (authorizationStatus, accountName = "mona.store") => ({
  instagram: { authorizationStatus, accountName },
});

const whatsapp = (connectionState, accountName = "+966561234567") => ({
  whatsapp: { connectionState, accountName },
});

test("the three cards come back in display order with their own field families", () => {
  const channels = homeChannels({
    instagram: { authorizationStatus: "ready", accountName: "mona.store" },
    facebook: { authorizationStatus: "ready", accountName: "متجر منى" },
    whatsapp: { connectionState: "connected", accountName: "+966561234567" },
  });
  assert.deepEqual(
    channels.map((channel) => channel.platform),
    ["instagram", "facebook", "whatsapp"],
  );
  assert.deepEqual(
    channels.map((channel) => channel.name),
    ["إنستغرام", "فيسبوك", "واتساب"],
  );
  assert.ok(channels.every((channel) => channel.connected));
  // Instagram is shown as a handle, the other two as they are stored.
  assert.deepEqual(
    channels.map((channel) => channel.accountName),
    ["@mona.store", "متجر منى", "+966561234567"],
  );
});

test("a Meta card only ever reports authorisation states", () => {
  for (const authorizationStatus of ["ready", "needs_reauthorization", "expired", null]) {
    const [card] = homeChannels(instagram(authorizationStatus));
    assert.equal(card.connected, authorizationStatus === "ready");
    assert.equal(
      card.needsReauthorization,
      authorizationStatus === "needs_reauthorization",
    );
    assert.equal(card.needsReconnection, false, String(authorizationStatus));
    assert.equal(card.isConnecting, false);
    assert.equal(card.isUnavailable, false);
  }
});

test("every WhatsApp state lands in exactly one bucket", () => {
  const cases = [
    // state, connected, needsReconnection, isConnecting, isUnavailable
    ["connected", true, false, false, false],
    ["connecting", false, false, true, false],
    ["unavailable", false, false, false, true],
    ["failed", false, true, false, false],
    ["missing", false, true, false, false],
    ["disconnected", false, true, false, false],
  ];
  for (const [connectionState, connected, reconnect, connecting, unavailable] of cases) {
    const card = homeChannels(whatsapp(connectionState)).find(
      (channel) => channel.platform === "whatsapp",
    );
    assert.deepEqual(
      [card.connected, card.needsReconnection, card.isConnecting, card.isUnavailable],
      [connected, reconnect, connecting, unavailable],
      connectionState,
    );
    assert.equal(card.needsReauthorization, false, connectionState);
  }
});

test("no connections at all yields three unlinked cards rather than none", () => {
  for (const connections of [null, undefined, {}]) {
    const channels = homeChannels(connections);
    assert.equal(channels.length, 3);
    assert.ok(channels.every((channel) => !channel.connected));
    assert.ok(channels.every((channel) => channel.accountName === null));
    // A WhatsApp card with no saved pairing is not "needing reconnection": there is
    // nothing saved to reconnect, and the wording would be wrong.
    assert.equal(
      channels.find((channel) => channel.platform === "whatsapp").needsReconnection,
      false,
    );
  }
});

test("an empty account name is shown as no account, not as an empty handle", () => {
  const [card] = homeChannels({ instagram: { authorizationStatus: "ready", accountName: "" } });
  assert.equal(card.accountName, null, "an @ with nothing after it is not an identity");
});

test("hasAnyConnection is false while the connections state is unknown", () => {
  const channels = homeChannels(instagram("ready"));
  assert.equal(channelSignals(channels, false).hasAnyConnection, true);
  // "No connection" and "we could not check" lead to different heroes, so the
  // unavailable flag has to win over what the last known payload said.
  assert.equal(channelSignals(channels, true).hasAnyConnection, false);
  assert.equal(channelSignals(homeChannels({}), false).hasAnyConnection, false);
});

test("the WhatsApp signals come from the WhatsApp card only", () => {
  const connecting = channelSignals(homeChannels(whatsapp("connecting")), false);
  assert.equal(connecting.whatsappConnecting, true);
  assert.equal(connecting.whatsappUnavailable, false);
  assert.equal(connecting.whatsappNeedsReconnection, false);

  const broken = channelSignals(homeChannels(whatsapp("failed")), false);
  assert.equal(broken.whatsappNeedsReconnection, true);
  assert.equal(broken.whatsappConnecting, false);

  const gone = channelSignals(homeChannels(whatsapp("unavailable")), false);
  assert.equal(gone.whatsappUnavailable, true);
  assert.equal(gone.whatsappNeedsReconnection, false);
});

test("the first account needing re-authorisation is named for the hero", () => {
  const both = channelSignals(
    homeChannels({
      instagram: { authorizationStatus: "needs_reauthorization", accountName: "mona.store" },
      facebook: { authorizationStatus: "needs_reauthorization", accountName: "متجر منى" },
    }),
    false,
  );
  assert.deepEqual(both.accountNeedingReauthorization, {
    platform: "instagram",
    name: "إنستغرام",
  });
  assert.equal(
    channelSignals(homeChannels({}), false).accountNeedingReauthorization,
    null,
  );
});

test("the hero points at a failure before a review before a draft", () => {
  const posts = [
    { id: "1", status: "draft" },
    { id: "2", status: "review" },
    { id: "3", status: "failed" },
    { id: "4", status: "published" },
  ];
  assert.equal(pickPendingPost(posts).id, "3");
  assert.equal(pickPendingPost(posts.slice(0, 2)).id, "2");
  assert.equal(pickPendingPost(posts.slice(0, 1)).id, "1");
  assert.equal(pickPendingPost([{ id: "4", status: "published" }]), null);
  assert.equal(pickPendingPost([]), null);
});
