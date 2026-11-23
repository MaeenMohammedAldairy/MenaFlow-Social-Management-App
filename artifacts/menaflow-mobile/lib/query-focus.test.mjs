import assert from "node:assert/strict";
import test from "node:test";
import { installQueryFocusTracking, isFocusedAppState } from "./query-focus.ts";

/** A stand-in for React Query's focus manager and React Native's AppState. */
function harness(initialStatus = "active") {
  const statuses = [initialStatus];
  const focused = [];
  const hostListeners = [];
  let removedHostListeners = 0;
  let installedSetups = [];

  return {
    statuses,
    focused,
    installedSetups,
    deps: {
      setEventListener: (setup) => {
        installedSetups.push(setup);
      },
      subscribeToHost: (listener) => {
        hostListeners.push(listener);
        return () => {
          removedHostListeners += 1;
          const at = hostListeners.indexOf(listener);
          if (at >= 0) hostListeners.splice(at, 1);
        };
      },
      getCurrentStatus: () => statuses[statuses.length - 1],
    },
    /** Runs the setup the way the focus manager does, capturing its cleanup. */
    runSetup() {
      const setup = installedSetups[installedSetups.length - 1];
      assert.ok(setup, "لم يُثبَّت أي مستمع");
      return setup((value) => focused.push(value));
    },
    /** Simulates the host reporting a new app state. */
    emit(status) {
      statuses.push(status);
      for (const listener of [...hostListeners]) listener(status);
    },
    hostListenerCount: () => hostListeners.length,
    removedHostListeners: () => removedHostListeners,
  };
}

test("only an active app counts as focused", () => {
  assert.equal(isFocusedAppState("active"), true);
});

test("every other host status counts as blurred", () => {
  // `inactive` matters most: on iOS it is the app switcher, an incoming call or a
  // system alert, and timers must not keep running through it.
  for (const status of [
    "background",
    "inactive",
    "unknown",
    "extension",
    "",
    undefined,
    null,
    0,
    true,
    {},
  ]) {
    assert.equal(
      isFocusedAppState(status),
      false,
      `كان يجب اعتبار هذه الحالة خارج التركيز: ${String(status)}`,
    );
  }
});

test("installing replaces the manager's listener instead of stacking one", () => {
  const h = harness();
  installQueryFocusTracking(h.deps);
  installQueryFocusTracking(h.deps);
  assert.equal(h.installedSetups.length, 2);
});

test("the setup seeds focus from the current host status", () => {
  // Without this, an install performed while the app is already blurred leaves the
  // manager reporting focused until the first change — the bug being fixed.
  const blurred = harness("background");
  installQueryFocusTracking(blurred.deps);
  blurred.runSetup();
  assert.deepEqual(blurred.focused, [false]);

  const active = harness("active");
  installQueryFocusTracking(active.deps);
  active.runSetup();
  assert.deepEqual(active.focused, [true]);
});

test("host status changes are forwarded as focus changes", () => {
  const h = harness("active");
  installQueryFocusTracking(h.deps);
  h.runSetup();

  h.emit("background");
  h.emit("inactive");
  h.emit("active");

  assert.deepEqual(h.focused, [true, false, false, true]);
});

test("the setup returns the host unsubscribe, and it detaches", () => {
  const h = harness("active");
  installQueryFocusTracking(h.deps);
  const cleanup = h.runSetup();

  assert.equal(typeof cleanup, "function");
  assert.equal(h.hostListenerCount(), 1);

  cleanup();
  assert.equal(h.hostListenerCount(), 0);
  assert.equal(h.removedHostListeners(), 1);

  // A status change after cleanup must not reach the focus manager: a leaked
  // listener would keep flipping focus for an app that uninstalled tracking.
  h.statuses.push("background");
  const before = h.focused.length;
  h.emit("active");
  assert.equal(h.focused.length, before + 0, "مستمع متسرب بعد التنظيف");
});

test("a second install's setup is independent of the first", () => {
  const h = harness("active");
  installQueryFocusTracking(h.deps);
  const firstCleanup = h.runSetup();
  installQueryFocusTracking(h.deps);
  const secondCleanup = h.runSetup();

  assert.equal(h.hostListenerCount(), 2);
  firstCleanup();
  assert.equal(h.hostListenerCount(), 1);

  h.emit("background");
  // Only the surviving listener reports, so exactly one false is recorded after
  // the two seeds.
  assert.deepEqual(h.focused.slice(-1), [false]);
  secondCleanup();
  assert.equal(h.hostListenerCount(), 0);
});
