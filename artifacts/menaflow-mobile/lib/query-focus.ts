/**
 * Wires React Query's focus manager to the host's application state.
 *
 * React Query asks `focusManager.isFocused()` in two places that matter here. An
 * interval tick only performs its fetch when
 * `refetchIntervalInBackground || focusManager.isFocused()` (query-core,
 * `queryObserver.js`), and a refetch-on-focus happens only when the manager
 * reports a *change* in focus, which is what drives `query.onFocus()` and
 * therefore every `refetchOnWindowFocus` observer.
 *
 * When nothing sets the value explicitly, `isFocused()` falls back to
 * `globalThis.document?.visibilityState !== "hidden"`. React Native has no
 * `document`, so that expression is `undefined !== "hidden"` — permanently true.
 * The consequences, both real in this app before this module existed:
 *
 * - every `refetchInterval` kept firing with the app backgrounded, because the
 *   guard that is supposed to pause it always passed;
 * - `refetchOnWindowFocus: true`, set at thirteen places across eight files,
 *   never did anything, because the manager never observed a focus change to
 *   report.
 *
 * The manager's own default setup listens for `visibilitychange`, which is a DOM
 * event and never fires here. So the listener has to be replaced with one backed
 * by the host's app state.
 *
 * Pure on purpose — no `react-native` import — so the status mapping and the
 * install/cleanup contract are testable in plain Node. Importing React Native
 * into a module that a test reaches is what broke `sign-out.test.mjs` once
 * already: the Expo and RN natives cannot load under the test runner.
 */

/**
 * React Native's `AppStateStatus`. Kept as `string` rather than a union because
 * the host can report values this module has no opinion about (`extension` on
 * iOS, `unknown`), and narrowing the type here would only push casts to the call
 * site without adding safety — the mapping below treats everything that is not
 * `active` as blurred.
 */
export type HostAppStateStatus = string;

/**
 * Whether a host app-state status counts as focused.
 *
 * Only `active` does. `inactive` is deliberately blurred: on iOS it is the
 * transient state for the app switcher, an incoming call or a system alert, and
 * none of those is a merchant reading the screen. Treating it as focused would
 * keep timers running through them.
 */
export function isFocusedAppState(status: unknown): boolean {
  return status === "active";
}

export type QueryFocusDeps = {
  /**
   * React Query's `focusManager.setEventListener`. It stores the cleanup the
   * setup returns and calls it when the manager's last listener unsubscribes, so
   * ownership of teardown belongs to the manager, not to the caller.
   */
  setEventListener: (
    setup: (setFocused: (focused: boolean) => void) => (() => void) | undefined,
  ) => void;
  /**
   * Subscribes to host app-state changes and returns the unsubscribe function,
   * mirroring `AppState.addEventListener("change", listener).remove`.
   */
  subscribeToHost: (
    listener: (status: HostAppStateStatus) => void,
  ) => () => void;
  /**
   * The host's current status, read once when the listener is installed.
   *
   * Allowed to be null or undefined because React Native's `AppState.currentState`
   * is typed that way — it can be unset before the host has reported a state. Both
   * read as blurred through `isFocusedAppState`, which is the correct seed: an app
   * that has not yet said it is active must not be assumed to be in the
   * foreground.
   */
  getCurrentStatus: () => HostAppStateStatus | null | undefined;
};

/**
 * Installs the app-state-backed focus listener.
 *
 * Seeds the manager with the current status before subscribing rather than
 * waiting for the first change: without that, an install performed while the app
 * is already blurred leaves the manager reporting focused until something
 * changes, which is the exact bug being fixed.
 *
 * Returns nothing on purpose. `setEventListener` hands the cleanup to the focus
 * manager, so there is no subscription for the caller to hold — calling this
 * twice replaces the previous listener instead of stacking a second one.
 */
export function installQueryFocusTracking(deps: QueryFocusDeps): void {
  deps.setEventListener((setFocused) => {
    setFocused(isFocusedAppState(deps.getCurrentStatus()));
    return deps.subscribeToHost((status) => {
      setFocused(isFocusedAppState(status));
    });
  });
}
