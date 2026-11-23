import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { router } from "expo-router";
import {
  registerPushToken,
  unregisterPushToken,
} from "@workspace/api-client-react";
import { routeFromAlertData } from "./alert-routes";
import { queryPrefixesForAlertData } from "./alert-invalidation";

export { ALLOWED_ALERT_ROUTES } from "./alert-routes";
export { queryPrefixesForAlertData } from "./alert-invalidation";

/**
 * Push notification registration for the merchant app.
 *
 * The token is registered against the signed-in user, not the workspace: one
 * device serves every workspace its owner belongs to, and the server resolves
 * recipients through membership at send time.
 */

/**
 * Must match the `channelId` the API server puts on Android messages.
 *
 * Android 8+ ignores a message's sound and importance unless the channel it
 * names already exists, so a mismatch here silently produces silent
 * notifications that look like a delivery bug.
 */
export const ANDROID_ALERT_CHANNEL_ID = "menaflow-alerts";

const TOKEN_STORAGE_KEY = "menaflow.push-token";

export type PushSetupOutcome =
  | { status: "registered"; token: string }
  | { status: "unchanged"; token: string }
  | { status: "unsupported"; reason: "not-a-device" | "no-project-id" }
  | { status: "denied" }
  | { status: "failed"; reason: string };

/**
 * Creates the Android alert channel.
 *
 * Idempotent, and Android only lets the name and description change after
 * creation — importance and sound are fixed the first time. Running it on every
 * start is what keeps a channel created by an older build from silently lacking
 * sound.
 */
export async function ensureAndroidAlertChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  await Notifications.setNotificationChannelAsync(ANDROID_ALERT_CHANNEL_ID, {
    name: "تنبيهات MenaFlow",
    description: "رسائل العملاء والطلبات وحالة النشر",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

/**
 * Asks for permission and registers this device with the API.
 *
 * Never throws: push is an enhancement, and a failure here must not block sign-in
 * or crash the app on a device that simply cannot receive notifications.
 */
export async function registerDeviceForPush(): Promise<PushSetupOutcome> {
  try {
    // Physical devices only. An emulator has no push token and asking for one
    // rejects, which would log a failure on every developer's machine.
    if (!Device.isDevice) return { status: "unsupported", reason: "not-a-device" };

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as
      | string
      | undefined;
    if (!projectId) return { status: "unsupported", reason: "no-project-id" };

    await ensureAndroidAlertChannel();

    const existing = await Notifications.getPermissionsAsync();
    const permission =
      existing.granted || existing.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
        ? existing
        : await Notifications.requestPermissionsAsync({
            ios: { allowAlert: true, allowBadge: true, allowSound: true },
          });

    if (!permission.granted) {
      // Denied is a legitimate, persistent state. Do not prompt again: Android
      // stops showing the dialog and iOS treats a repeat request as a no-op.
      return { status: "denied" };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    if (!token) return { status: "failed", reason: "EMPTY_PUSH_TOKEN" };

    const previous = await AsyncStorage.getItem(TOKEN_STORAGE_KEY);
    if (previous === token) return { status: "unchanged", token };

    const platform =
      Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";

    await registerPushToken({
      token,
      platform,
      deviceId: (Constants.deviceId as string | undefined) ?? null,
    });
    await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token);

    return { status: "registered", token };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : "PUSH_REGISTRATION_FAILED",
    };
  }
}

/**
 * Removes this device on sign-out.
 *
 * Best-effort and deliberately silent on failure: the server scopes removals to
 * the caller, and a device left registered after sign-out is corrected the next
 * time anybody signs in on it, because registration overwrites the same row.
 */
export async function unregisterDeviceForPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY).catch(() => null);
  await AsyncStorage.removeItem(TOKEN_STORAGE_KEY).catch(() => undefined);
  if (!token) return;

  try {
    await unregisterPushToken({ token });
  } catch (error) {
    console.error("Unable to unregister the push token:", error);
  }
}

/**
 * Shows alerts while the app is in the foreground.
 *
 * Without this handler a notification that arrives while the merchant is already
 * looking at the app is swallowed silently, which reads as a missed alert.
 */
export function installForegroundAlertBehaviour(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Opens the screen an alert points at, both when the app is running and when a
 * tap on a closed app is what launched it.
 *
 * Returns the unsubscribe function so the caller can clean up.
 */
export function installAlertNavigation(): () => void {
  const open = (data: unknown) => {
    const resolved = routeFromAlertData(data);
    if (!resolved) {
      if (data && typeof data === "object") {
        console.error("Ignoring an alert route outside the allowlist:", data);
      }
      return;
    }
    router.push(resolved.route as never);
  };

  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      open(response.notification.request.content.data);
    },
  );

  // A tap that cold-starts the app fires before the listener is attached, so the
  // last response has to be read explicitly.
  void Notifications.getLastNotificationResponseAsync()
    .then((response) => {
      if (response) open(response.notification.request.content.data);
    })
    .catch((error) => {
      console.error("Unable to read the launch notification:", error);
    });

  return () => subscription.remove();
}

/**
 * Refreshes cached data when an alert arrives, so a screen an alert points at is
 * not showing a snapshot taken before the event it announces.
 *
 * Two listeners, for the two ways an alert reaches running JavaScript:
 *
 * - received: the alert arrived while the app was in the foreground. The banner
 *   shows (`installForegroundAlertBehaviour`), but without this the list behind it
 *   keeps looking unchanged until its next timer tick — a banner reading "a
 *   customer is waiting for your reply" above an inbox that shows nothing new.
 * - response: the merchant tapped it. `installAlertNavigation` opens the screen;
 *   this makes the screen current once it is open.
 *
 * A notification delivered while the app was backgrounded and never tapped fires
 * neither listener, because the runtime is not executing. That case is covered by
 * focus tracking instead: `lib/query-focus.ts` reports the return to the
 * foreground and React Query refetches what is mounted.
 *
 * Unlike navigation this does not read the last notification response. A cold
 * start has no cached data to invalidate — every query fetches on mount anyway —
 * so reading it here would only duplicate that work.
 *
 * The callback is injected rather than importing a QueryClient, keeping this
 * module free of React Query and leaving `lib/alert-invalidation.ts` as the only
 * place the mapping has to be reasoned about.
 *
 * Returns the unsubscribe function for both listeners.
 */
export function installAlertCacheInvalidation(
  invalidate: (queryKeyPrefix: readonly string[]) => void,
): () => void {
  const refresh = (data: unknown) => {
    for (const prefix of queryPrefixesForAlertData(data)) invalidate(prefix);
  };

  const received = Notifications.addNotificationReceivedListener(
    (notification) => {
      refresh(notification.request.content.data);
    },
  );
  const responded = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      refresh(response.notification.request.content.data);
    },
  );

  return () => {
    received.remove();
    responded.remove();
  };
}
