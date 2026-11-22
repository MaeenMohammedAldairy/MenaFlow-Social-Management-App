import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "تذكرني" support for the sign-in screen.
 *
 * Clerk keeps the session alive on its own; what the checkbox actually does here
 * is remember the last used email address on this device so the next sign-in is
 * prefilled. Both the value and the flag live in one key so clearing it is a
 * single call and the address is never read when the user opted out.
 */
const STORAGE_KEY = "menaflow.auth.remembered-email";

export async function readRememberedEmail(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    const trimmed = stored?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export async function rememberEmail(email: string): Promise<void> {
  const trimmed = email.trim();
  if (!trimmed) return;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // Remembering the address is a convenience; never block a sign-in on it.
  }
}

export async function forgetRememberedEmail(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same as above: a failed cleanup must not surface to the user.
  }
}

/**
 * Persists or clears the address depending on the checkbox state. Call it right
 * before starting a sign-in attempt so an abandoned form never overwrites the
 * stored value.
 */
export async function syncRememberedEmail(
  email: string,
  remember: boolean,
): Promise<void> {
  if (remember) {
    await rememberEmail(email);
  } else {
    await forgetRememberedEmail();
  }
}
