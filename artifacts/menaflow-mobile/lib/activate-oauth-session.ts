export async function activateOAuthSession(
  sessionId: string | null | undefined,
  setActive:
    | ((params: { session: string }) => Promise<unknown>)
    | undefined,
  navigate: () => void,
): Promise<boolean> {
  if (!sessionId || !setActive) return false;

  await setActive({ session: sessionId });
  navigate();
  return true;
}