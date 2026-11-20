import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Small device-local reminders that connect the end of onboarding with the
 * first dashboard visit. They are deliberately not part of the server
 * onboarding status: they describe "what the user has already been told on
 * this device", not whether setup is complete.
 */
const COMPLETED_KEY = "menaflow:setup-completed";
const CHECKLIST_DISMISSED_KEY = "menaflow:setup-checklist-dismissed";

async function readFlag(key: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key)) === "1";
  } catch {
    return false;
  }
}

async function writeFlag(key: string, value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(key, "1");
    else await AsyncStorage.removeItem(key);
  } catch {
    // Storage is best effort; nothing here blocks the user.
  }
}

export async function markSetupCompleted(): Promise<void> {
  await writeFlag(COMPLETED_KEY, true);
}

/** Returns true only once, so the confirmation banner is not repeated. */
export async function consumeSetupCompleted(): Promise<boolean> {
  const completed = await readFlag(COMPLETED_KEY);
  if (completed) await writeFlag(COMPLETED_KEY, false);
  return completed;
}

export async function isSetupChecklistDismissed(): Promise<boolean> {
  return readFlag(CHECKLIST_DISMISSED_KEY);
}

export async function dismissSetupChecklist(): Promise<void> {
  await writeFlag(CHECKLIST_DISMISSED_KEY, true);
}
