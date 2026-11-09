import {
  getGetSocialConnectionsQueryKey,
  getSocialConnections,
  getWhatsAppConnectionStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react";

const PAIRING_TIMEOUT_MS = 2 * 60 * 1000;
const PAIRING_POLL_INTERVAL_MS = 3_000;
const PAIRING_MAX_RETRY_DELAY_MS = 15_000;

export type WhatsAppPairingInput = {
  phoneNumber: string;
  instanceName?: string;
  pairingCode?: string;
  qrCodeBase64?: string;
  showQrCode?: boolean;
};

export function useWhatsAppPairingPoll({
  input,
  pollingRestart,
  userId,
  includeWhatsApp,
  setInput,
  setTimedOut,
  setError,
  setSetupInitialized,
}: {
  input: WhatsAppPairingInput | null;
  pollingRestart: number;
  userId: string | null;
  includeWhatsApp: boolean;
  setInput: Dispatch<SetStateAction<WhatsAppPairingInput | null>>;
  setTimedOut: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setSetupInitialized: Dispatch<SetStateAction<boolean>>;
}) {
  const queryClient = useQueryClient();
  const connectionsQueryKey = useMemo(
    () => [...getGetSocialConnectionsQueryKey(), userId ?? "local"] as const,
    [userId],
  );

  useEffect(() => {
    const instanceName = input?.instanceName;
    if (!instanceName || (!input.pairingCode && !input.qrCodeBase64)) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let disconnectedChecks = 0;
    let consecutiveErrors = 0;
    let checkConnection: () => Promise<void>;
    const startedAt = Date.now();
    const stopWaiting = (message: string) => {
      if (!active) return;
      setTimedOut(true);
      setError(message);
    };
    const scheduleNextCheck = (delay: number) => {
      const remaining = PAIRING_TIMEOUT_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        stopWaiting(
          "توقف التحقق بعد دقيقتين دون تأكيد الربط. يمكنك التحقق مجددًا أو طلب رمز جديد.",
        );
        return;
      }
      timer = setTimeout(
        () => void checkConnection(),
        Math.min(delay, remaining),
      );
    };
    const completeConnection = async () => {
      await queryClient.invalidateQueries({
        queryKey: getGetSocialConnectionsQueryKey(),
      });
      if (!active) return;
      setInput(null);
      setSetupInitialized(false);
      router.push({
        pathname: "/whatsapp-setup",
        params: includeWhatsApp ? { returnTo: "connect-accounts" } : undefined,
      });
    };
    checkConnection = async () => {
      if (!active) return;
      if (Date.now() - startedAt >= PAIRING_TIMEOUT_MS) {
        stopWaiting(
          "توقف التحقق بعد دقيقتين دون تأكيد الربط. يمكنك التحقق مجددًا أو طلب رمز جديد.",
        );
        return;
      }
      try {
        const status = await getWhatsAppConnectionStatus({ instanceName });
        if (!active) return;
        consecutiveErrors = 0;
        setTimedOut(false);
        setError("");
        if (status.state === "connected") {
          await completeConnection();
          return;
        }
        if (status.state === "unavailable") {
          stopWaiting(
            "تعذر التحقق من حالة واتساب. تحقق مجددًا أو اطلب رمز ربط جديدًا.",
          );
          return;
        }
        if (status.state === "failed") {
          stopWaiting(
            "تعذر تجهيز جلسة الربط. أعد المحاولة أو اطلب رمز ربط جديدًا.",
          );
          return;
        }
        if (status.state === "disconnected") {
          disconnectedChecks += 1;
          try {
            const connections = await queryClient.fetchQuery({
              queryKey: connectionsQueryKey,
              queryFn: getSocialConnections,
              staleTime: 0,
            });
            if (
              connections.whatsapp?.connected ||
              connections.whatsapp?.connectionState === "connected"
            ) {
              await completeConnection();
              return;
            }
          } catch (error) {
            console.warn(
              "Could not verify WhatsApp pairing through social connections:",
              error,
            );
          }
          if (!active) return;
          if (disconnectedChecks >= 4) {
            setError(
              "لم يؤكد واتساب الربط بعد. أكمل الخطوات على هاتفك أو اطلب رمزًا جديدًا.",
            );
          }
        }
      } catch (err: unknown) {
        if (!active) return;
        const message =
          err instanceof Error ? err.message : "تعذّر التحقق من حالة الربط.";
        setError(message);
        const statusCode =
          err &&
          typeof err === "object" &&
          "status" in err &&
          typeof err.status === "number"
            ? err.status
            : null;
        if (statusCode === 404) {
          stopWaiting(
            "انتهت جلسة الربط أو لم تعد موجودة. اطلب رمزًا جديدًا للمتابعة.",
          );
          return;
        }
        if (
          statusCode !== null &&
          statusCode !== 408 &&
          statusCode !== 429 &&
          statusCode < 500
        ) {
          stopWaiting(message);
          return;
        }
        consecutiveErrors += 1;
      }
      if (active) {
        const retryDelay =
          consecutiveErrors === 0
            ? PAIRING_POLL_INTERVAL_MS
            : Math.min(
                PAIRING_POLL_INTERVAL_MS * 2 ** (consecutiveErrors - 1),
                PAIRING_MAX_RETRY_DELAY_MS,
              );
        scheduleNextCheck(retryDelay);
      }
    };

    setTimedOut(false);
    timer = setTimeout(
      () => void checkConnection(),
      pollingRestart === 0 ? PAIRING_POLL_INTERVAL_MS : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    input?.instanceName,
    input?.pairingCode,
    input?.qrCodeBase64,
    includeWhatsApp,
    pollingRestart,
    queryClient,
    connectionsQueryKey,
    setError,
    setInput,
    setSetupInitialized,
    setTimedOut,
  ]);
}
