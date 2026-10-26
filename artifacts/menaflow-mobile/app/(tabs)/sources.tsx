import {
  deleteWhatsAppConnection,
  decideWhatsAppContentAssociation,
  deleteMetaConnectionForPlatform,
  markSocialAccountsSetupComplete,
  fetchApiResponse,
  getWhatsAppConnectionStatus,
  getWhatsAppGroupMessages,
  getWhatsAppGroupSelections,
  getWhatsAppGroups,
  getWhatsAppSyncStatus,
  getGetSocialConnectionsQueryKey,
  getOnboardingStatus,
  getOnboardingStatusQueryKey,
  getSocialConnections,
  type OnboardingStatus,
  type WhatsAppGroupMessagesResponse,
  type WhatsAppSyncStatusResponse,
  postMetaConnect,
  postWhatsAppPairingCode,
  saveWhatsAppGroupSelections,
  triggerWhatsAppSyncNow,
  updateWhatsAppSyncSettings,
  type WhatsAppGroup,
} from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  BrandHeader,
  Page,
  PageTitle,
  Panel,
  StatusPill,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { useStudio } from "@/context/StudioContext";
import { router, useLocalSearchParams } from "expo-router";
import { metaOAuthErrorMessage } from "@/constants/meta-oauth";
import { groupWhatsAppMessages } from "@/lib/source-message-groups";
import {
  CountryPickerModal,
  DisconnectConfirmModal,
  MediaPreviewModal,
  SourcesConnectionsPanel,
  WhatsAppGroupMessagesModal,
  WhatsAppGroupPickerModal,
  WhatsAppPairingModal,
  WhatsAppSetupModal,
  WhatsAppSyncStatusPanel,
  type SourceKey,
  type WhatsAppSyncSettingKey,
} from "@/components/sources";
import { isLocalAuthDisabled } from "@/constants/auth";

WebBrowser.maybeCompleteAuthSession();

const deviceCountry = (() => {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const region = locale
    .split("-")
    .slice(1)
    .find((part) => /^[a-z]{2}$/i.test(part));
  return getCountries().find((country) => country === region?.toUpperCase());
})();

function parseWhatsAppPhoneNumber(
  value: string,
  defaultCountry: CountryCode = deviceCountry ?? "SA",
) {
  const normalizedDigits = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  const normalizedNumber = normalizedDigits.trim().replace(/^00/, "+");

  const parsedNumber = parsePhoneNumberFromString(
    normalizedNumber,
    defaultCountry,
  );
  if (parsedNumber?.isValid() || normalizedNumber.startsWith("+")) {
    return parsedNumber;
  }

  const digitsOnly = normalizedNumber.replace(/\D/g, "");
  const parsedInternationalNumber = parsePhoneNumberFromString(
    `+${digitsOnly}`,
  );
  return parsedInternationalNumber?.isValid()
    ? parsedInternationalNumber
    : parsedNumber;
}

// OAuth return URL — web uses current origin, mobile uses custom scheme
const metaReturnUrl =
  Platform.OS === "web" && typeof window !== "undefined"
    ? `${window.location.origin}/oauth/meta`
    : "menaflow-mobile://oauth/meta";

function isSourceKey(value: string): value is SourceKey {
  return value === "facebook" || value === "instagram" || value === "whatsapp";
}

type WhatsAppSyncSettings = Record<WhatsAppSyncSettingKey, boolean>;
type LocalWhatsAppSyncState = {
  autoSyncEnabled: boolean;
  syncMessagesEnabled: boolean;
  syncImagesEnabled: boolean;
  syncVideosEnabled: boolean;
  groups: Array<{
    groupJid: string;
    groupName: string;
    status: string;
    savedMessageCount: number;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
    lastSyncedAt?: string | null;
    lastError?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
  }>;
};

type DisconnectDialogState = {
  platform: "facebook" | "instagram" | "whatsapp";
  accountName: string;
  status: "confirm" | "pending" | "success" | "error";
  message?: string;
};

export default function SourcesScreen() {
  if (isLocalAuthDisabled) return <SourcesContent userId={null} />;
  return <AuthenticatedSourcesScreen />;
}

function AuthenticatedSourcesScreen() {
  const { userId } = useAuth();
  return <SourcesContent userId={userId ?? null} />;
}

function SourcesContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const compactLayout = width < 560;
  const queryClient = useQueryClient();
  const connectionsQueryKey = [
    ...getGetSocialConnectionsQueryKey(),
    userId ?? "local",
  ] as const;
  const whatsappGroupSelectionsQueryKey = [
    "whatsappGroupSelections",
    userId ?? "local",
  ] as const;
  const whatsappGroupsQueryKey = ["whatsappGroups", userId ?? "local"] as const;
  const whatsappSyncStatusQueryKey = [
    "whatsappSyncStatus",
    userId ?? "local",
  ] as const;
  const { refreshPosts } = useStudio();
  const { connect: requestedConnect, reconnect: requestedReconnect } =
    useLocalSearchParams<{ connect?: string; reconnect?: string }>();
  const [busySources, setBusySources] = useState<Record<SourceKey, boolean>>({
    facebook: false,
    instagram: false,
    whatsapp: false,
  });
  const setSourceBusy = (source: SourceKey, isBusy: boolean) => {
    setBusySources((current) => ({ ...current, [source]: isBusy }));
  };
  const [autoSyncSaving, setAutoSyncSaving] = useState<
    Record<WhatsAppSyncSettingKey, boolean>
  >({
    autoSyncEnabled: false,
    syncMessagesEnabled: false,
    syncImagesEnabled: false,
    syncVideosEnabled: false,
  });
  const [syncingWhatsApp, setSyncingWhatsApp] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const syncRequestInFlightRef = useRef(false);
  const [clientTrackedSyncs, setClientTrackedSyncs] = useState<
    Record<string, number>
  >({});
  const [syncPreviousMessages, setSyncPreviousMessages] = useState(false);
  const [disconnectingSource, setDisconnectingSource] =
    useState<SourceKey | null>(null);
  const disconnectInFlightRef = useRef(false);
  const autoConnectHandledRef = useRef<string | null>(null);
  const [disconnectDialog, setDisconnectDialog] =
    useState<DisconnectDialogState | null>(null);
  const [convertingWhatsAppGroup, setConvertingWhatsAppGroup] = useState(false);
  const [whatsappInput, setWhatsappInput] = useState<{
    phoneNumber: string;
    instanceName?: string;
    pairingCode?: string;
    qrCodeBase64?: string;
    showQrCode?: boolean;
  } | null>(null);
  const whatsappConnectInFlight = useRef(false);
  const [whatsappPhoneCountry, setWhatsappPhoneCountry] = useState<CountryCode>(
    deviceCountry ?? "SA",
  );
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [whatsappError, setWhatsappError] = useState("");
  const [whatsappSetupOpen, setWhatsappSetupOpen] = useState(false);
  const [whatsappSetupInitialized, setWhatsappSetupInitialized] =
    useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const [groupSearchSelection, setGroupSearchSelection] = useState<string[]>(
    [],
  );
  const [selectedWhatsAppGroups, setSelectedWhatsAppGroups] = useState<
    WhatsAppGroup[]
  >([]);
  const [whatsappSetupError, setWhatsappSetupError] = useState("");
  const [groupMessagesOpen, setGroupMessagesOpen] = useState(false);
  const [activeGroupJid, setActiveGroupJid] = useState<string | null>(null);
  const [activeGroupName, setActiveGroupName] = useState("");
  const [groupMessagesPage, setGroupMessagesPage] = useState(1);
  const [groupMessagesData, setGroupMessagesData] =
    useState<WhatsAppGroupMessagesResponse | null>(null);
  const [groupMessagesLoading, setGroupMessagesLoading] = useState(false);
  const [groupMessagesError, setGroupMessagesError] = useState("");
  const [associationDecisionPending, setAssociationDecisionPending] =
    useState<string | null>(null);
  const [associationError, setAssociationError] = useState("");
  const groupMessagesRequestRef = useRef<{
    key: string;
    controller: AbortController;
  } | null>(null);
  const [previewMediaUrl, setPreviewMediaUrl] = useState<string | null>(null);
  const countryNames = useMemo(
    () =>
      typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["ar"], { type: "region" })
        : null,
    [],
  );
  const phoneCountries = useMemo(
    () =>
      getCountries()
        .map((country) => ({
          country,
          name: countryNames?.of(country) ?? country,
          callingCode: getCountryCallingCode(country),
        }))
        .sort((left, right) => left.name.localeCompare(right.name, "ar")),
    [countryNames],
  );
  const visiblePhoneCountries = useMemo(() => {
    const search = countrySearch.trim().toLocaleLowerCase("ar");
    if (!search) return phoneCountries;
    return phoneCountries.filter(
      ({ country, name, callingCode }) =>
        name.toLocaleLowerCase("ar").includes(search) ||
        country.toLowerCase().includes(search) ||
        `+${callingCode}`.includes(search),
    );
  }, [countrySearch, phoneCountries]);

  const connectionsQuery = useQuery({
    queryKey: connectionsQueryKey,
    queryFn: getSocialConnections,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.whatsapp?.connectionState === "connecting"
        ? 3000
        : false,
  });
  const connections = connectionsQuery.data;
  const hasConnectedSocialAccount = Boolean(
    connections?.facebook ||
    connections?.instagram ||
    connections?.whatsapp?.connectionState === "connected",
  );
  const onboardingQuery = useQuery({
    queryKey: getOnboardingStatusQueryKey(userId),
    queryFn: () => getOnboardingStatus(),
    enabled: Boolean(userId),
    retry: false,
  });
  const socialSetupPending =
    onboardingQuery.data?.completed === true &&
    !onboardingQuery.data.socialAccountsCompleted;
  const completeSocialSetup = useMutation({
    mutationFn: markSocialAccountsSetupComplete,
    onSuccess: (status) => {
      queryClient.setQueriesData<OnboardingStatus>(
        { queryKey: getOnboardingStatusQueryKey(null).slice(0, 1) },
        status,
      );
      router.replace("/(tabs)");
    },
  });
  const groupSelectionsQuery = useQuery({
    queryKey: whatsappGroupSelectionsQueryKey,
    queryFn: getWhatsAppGroupSelections,
    enabled: whatsappSetupOpen && Boolean(connections?.whatsapp),
    retry: false,
  });
  const groupsQuery = useQuery({
    queryKey: whatsappGroupsQueryKey,
    queryFn: getWhatsAppGroups,
    enabled: groupPickerOpen && Boolean(connections?.whatsapp),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const displayedMessageGroups = useMemo(
    () => groupWhatsAppMessages(groupMessagesData?.messages ?? []),
    [groupMessagesData?.messages],
  );

  useEffect(
    () => () => {
      groupMessagesRequestRef.current?.controller.abort();
    },
    [],
  );

  useEffect(() => {
    if (
      !whatsappSetupOpen ||
      !groupSelectionsQuery.data ||
      groupSelectionsQuery.isFetching ||
      whatsappSetupInitialized
    )
      return;
    setSelectedWhatsAppGroups(groupSelectionsQuery.data.groups);
    setWhatsappSetupInitialized(true);
  }, [
    groupSelectionsQuery.data,
    groupSelectionsQuery.isFetching,
    whatsappSetupInitialized,
    whatsappSetupOpen,
  ]);

  useEffect(() => {
    const instanceName = whatsappInput?.instanceName;
    if (!instanceName || !whatsappInput.pairingCode) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let disconnectedChecks = 0;
    const completeConnection = async () => {
      await queryClient.invalidateQueries({
        queryKey: getGetSocialConnectionsQueryKey(),
      });
      if (!active) return;
      setWhatsappInput(null);
      setWhatsappSetupInitialized(false);
      router.push("../whatsapp-setup");
    };
    const checkConnection = async () => {
      try {
        const status = await getWhatsAppConnectionStatus({ instanceName });
        if (!active) return;
        if (status.state === "connected") {
          setWhatsappError("");
          await completeConnection();
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
          setWhatsappError(
            disconnectedChecks >= 4
              ? "لم يكتمل الربط بعد. إذا كان واتساب متصلًا، انتظر قليلًا؛ وإلا امسح رمز QR أو اطلب رمزًا جديدًا."
              : "",
          );
        } else {
          disconnectedChecks = 0;
          setWhatsappError("");
        }
      } catch (err: unknown) {
        if (!active) return;
        const message =
          err instanceof Error ? err.message : "تعذّر التحقق من حالة الربط.";
        setWhatsappError(message);
        if (
          err &&
          typeof err === "object" &&
          "status" in err &&
          err.status === 404
        )
          return;
      }
      if (active) timer = setTimeout(checkConnection, 3000);
    };

    timer = setTimeout(checkConnection, 3000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [queryClient, whatsappInput?.instanceName, whatsappInput?.pairingCode]);

  // ─── Meta OAuth flow (user-initiated, no fallback to test accounts) ──────────
  const connectMeta = async (platform: "facebook" | "instagram") => {
    if (busySources[platform]) return;
    setSourceBusy(platform, true);
    try {
      const setup = await postMetaConnect({ integration: platform });
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(setup.authorizationUrl);
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(
        setup.authorizationUrl,
        metaReturnUrl,
      );
      if (result.type === "success") {
        await queryClient.invalidateQueries({
          queryKey: getGetSocialConnectionsQueryKey(),
        });
        const status = new URL(result.url).searchParams.get("status");
        if (status === "facebook_connected") {
          const detail = new URL(result.url).searchParams.get("detail");
          Alert.alert(
            "تم ربط فيسبوك ✓",
            detail ||
              "تم تحديث اتصال صفحة Facebook وحساب Instagram المهني المرتبط بها إن وُجد.",
          );
        } else if (status === "error") {
          const resultUrl = new URL(result.url);
          const reason = resultUrl.searchParams.get("reason") || "خطأ غير محدد";
          const detail = resultUrl.searchParams.get("detail") || undefined;
          Alert.alert("فشل الربط", metaOAuthErrorMessage(reason, detail));
        } else {
          Alert.alert(
            "تعذر تأكيد الربط",
            "لم يصل تأكيد من الخادم. تحقق من حالة الحساب ثم أعد المحاولة.",
          );
        }
      } else if (result.type === "cancel" || result.type === "dismiss") {
        Alert.alert(
          "تم إلغاء الربط",
          "لم يتم ربط الحساب. يمكنك المحاولة مرة أخرى أو متابعة الإعداد لاحقًا.",
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "خطأ غير محدد";
      Alert.alert(
        "تعذّر فتح صفحة الربط",
        `تحقق من تشغيل الخادم على المنفذ 5000.\n\nالخطأ: ${message}`,
      );
    } finally {
      setSourceBusy(platform, false);
    }
  };

  const disconnectMeta = (
    platform: "facebook" | "instagram",
    accountName: string,
  ) => {
    setDisconnectDialog({ platform, accountName, status: "confirm" });
  };

  const disconnectMetaNow = async (
    platform: "facebook" | "instagram",
  ): Promise<void> => {
    const result = await deleteMetaConnectionForPlatform(platform);
    if (result.disconnected !== true) {
      throw new Error("META_DISCONNECT_FAILED");
    }
    queryClient.setQueryData(
      connectionsQueryKey,
      (current: typeof connections) =>
        current
          ? {
              ...current,
              facebook: platform === "facebook" ? null : current.facebook,
              instagram: null,
            }
          : current,
    );
    await queryClient.invalidateQueries({
      queryKey: getGetSocialConnectionsQueryKey(),
    });
    setDisconnectDialog((current) =>
      current
        ? {
            ...current,
            status: "success",
            message:
              platform === "facebook"
                ? "تم فصل فيسبوك من مساحة العمل. لم تُلغَ صلاحية التطبيق لدى Meta؛ أزل MenaFlow من إعدادات التطبيقات في حساب Meta إذا رغبت."
                : "تم فصل إنستغرام من مساحة العمل. لم تُلغَ صلاحية التطبيق لدى Meta؛ أزل MenaFlow من إعدادات التطبيقات في حساب Meta إذا رغبت.",
          }
        : current,
    );
  };

  // ─── WhatsApp connect (user enters their own instance/phone) ──────────────────
  const connectWhatsApp = () => {
    setWhatsappError("");
    const savedPhone = connections?.whatsapp?.phoneNumber
      ? parseWhatsAppPhoneNumber(
          connections.whatsapp.phoneNumber,
          whatsappPhoneCountry,
        )
      : undefined;
    if (savedPhone?.country) setWhatsappPhoneCountry(savedPhone.country);
    setWhatsappInput({
      instanceName: connections?.whatsapp?.instanceName,
      phoneNumber: connections?.whatsapp?.phoneNumber ?? "",
    });
  };

  const submitWhatsAppConnection = async (refreshCode = false) => {
    if (
      !whatsappInput ||
      busySources.whatsapp ||
      whatsappConnectInFlight.current
    )
      return;

    const parsedPhoneNumber = parseWhatsAppPhoneNumber(
      whatsappInput.phoneNumber,
      whatsappPhoneCountry,
    );
    if (!parsedPhoneNumber?.isValid()) {
      setWhatsappError(
        deviceCountry
          ? "تحقق من رقم الهاتف وحاول مرة أخرى. يمكنك إدخاله بصيغته المحلية من دون مفتاح الدولة."
          : "تعذر تحديد بلد الرقم تلقائيًا. تحقق من إعدادات البلد في جهازك ثم حاول مرة أخرى.",
      );
      return;
    }
    const savedPhoneNumber = connections?.whatsapp?.phoneNumber
      ? parseWhatsAppPhoneNumber(
          connections.whatsapp.phoneNumber,
          whatsappPhoneCountry,
        )
      : undefined;
    if (
      isConnected("whatsapp") &&
      savedPhoneNumber?.number === parsedPhoneNumber.number
    ) {
      setWhatsappError("هذا الرقم مربوط بالفعل بحساب واتساب في مساحة العمل.");
      return;
    }

    whatsappConnectInFlight.current = true;
    setSourceBusy("whatsapp", true);
    setWhatsappError("");
    try {
      const pairing = await postWhatsAppPairingCode({
        phoneNumber: parsedPhoneNumber.number,
        refreshCode,
      });
      setWhatsappInput({
        phoneNumber: pairing.phoneNumber,
        instanceName: pairing.instanceName,
        pairingCode: pairing.pairingCode,
        qrCodeBase64: pairing.qrCodeBase64,
      });
    } catch (err: unknown) {
      const status =
        err && typeof err === "object" && "status" in err
          ? err.status
          : undefined;
      const errorData =
        err && typeof err === "object" && "data" in err ? err.data : null;
      const apiMessage =
        errorData &&
        typeof errorData === "object" &&
        "error" in errorData &&
        typeof errorData.error === "string"
          ? errorData.error
          : null;

      if (status === 409 && apiMessage) {
        setWhatsappError(apiMessage);
      } else if (status === 400) {
        setWhatsappError(
          "رقم الهاتف غير صالح. راجع البلد ومفتاح الاتصال ثم حاول مجددًا.",
        );
      } else if (status === 401) {
        setWhatsappError(
          "انتهت جلسة تسجيل الدخول. سجّل الدخول مجددًا ثم أعد المحاولة.",
        );
      } else if (status === 422 && apiMessage) {
        setWhatsappError(apiMessage);
      } else if (status === 502) {
        setWhatsappError(
          "خدمة واتساب لا تستجيب للخادم الآن. حاول مرة أخرى لاحقًا أو تواصل مع الدعم.",
        );
      } else if (status === 503) {
        setWhatsappError(
          "خدمة ربط واتساب غير مهيأة على الخادم. تواصل مع الدعم لإكمال إعدادها.",
        );
      } else if (status === 504) {
        setWhatsappError(
          "تأخر رد خدمة واتساب. انتظر قليلًا ثم حاول الحصول على رمز جديد.",
        );
      } else {
        setWhatsappError(
          apiMessage ??
            "تعذّر تجهيز رمز الربط. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.",
        );
      }
    } finally {
      whatsappConnectInFlight.current = false;
      setSourceBusy("whatsapp", false);
    }
  };

  const disconnectWhatsApp = () => {
    setDisconnectDialog({
      platform: "whatsapp",
      accountName: connections?.whatsapp?.accountName ?? "واتساب",
      status: "confirm",
    });
  };

  const confirmDisconnect = async () => {
    const dialog = disconnectDialog;
    if (
      !dialog ||
      dialog.status === "pending" ||
      disconnectInFlightRef.current ||
      busySources[dialog.platform]
    )
      return;
    disconnectInFlightRef.current = true;
    setSourceBusy(dialog.platform, true);
    setDisconnectingSource(dialog.platform);
    setDisconnectDialog({ ...dialog, status: "pending" });
    try {
      if (dialog.platform !== "whatsapp") {
        await disconnectMetaNow(dialog.platform);
        return;
      }

      const result = await deleteWhatsAppConnection();
      if (result.disconnected !== true) {
        throw new Error("WHATSAPP_DISCONNECT_FAILED");
      }
      queryClient.setQueryData(
        connectionsQueryKey,
        (current: typeof connections) =>
          current ? { ...current, whatsapp: null } : current,
      );
      queryClient.removeQueries({ queryKey: whatsappGroupSelectionsQueryKey });
      queryClient.removeQueries({ queryKey: whatsappGroupsQueryKey });
      queryClient.removeQueries({ queryKey: whatsappSyncStatusQueryKey });
      setSelectedWhatsAppGroups([]);
      setGroupSearchSelection([]);
      setGroupMessagesData(null);
      groupMessagesRequestRef.current?.controller.abort();
      groupMessagesRequestRef.current = null;
      setGroupMessagesLoading(false);
      setActiveGroupJid(null);
      setActiveGroupName("");
      setGroupMessagesOpen(false);
      setGroupPickerOpen(false);
      setWhatsappSetupOpen(false);
      setWhatsappSetupInitialized(false);
      await queryClient.invalidateQueries({
        queryKey: getGetSocialConnectionsQueryKey(),
      });
      setDisconnectDialog((current) =>
        current
          ? {
              ...current,
              status: "success",
              message:
                result.evolutionInstanceDeleted === false
                  ? "كان مثيل Evolution غير موجود بالفعل، وأُزيل ربط واتساب المحفوظ لهذا الحساب."
                  : "تم فصل حساب واتساب وإنهاء جلسته لدى Evolution. لم تُحذف الرسائل أو البيانات المحفوظة.",
            }
          : current,
      );
    } catch {
      setDisconnectDialog((current) =>
        current
          ? {
              ...current,
              status: "error",
              message:
                dialog.platform === "whatsapp"
                  ? "لم يؤكد Evolution إنهاء الجلسة، لذلك بقي الاتصال محفوظًا. تحقق من الخدمة وحاول مرة أخرى."
                  : "لم يؤكد الخادم فصل الحساب، لذلك بقي محفوظًا. تحقق من الاتصال وحاول مرة أخرى.",
            }
          : current,
      );
    } finally {
      setDisconnectingSource(null);
      disconnectInFlightRef.current = false;
      setSourceBusy(dialog.platform, false);
    }
  };

  const openWhatsAppSetup = () => {
    setWhatsappSetupError("");
    setWhatsappSetupInitialized(false);
    router.push("../whatsapp-setup");
  };

  const openGroupPicker = () => {
    setGroupSearch("");
    setGroupSearchSelection(
      selectedWhatsAppGroups.map((group) => group.groupJid),
    );
    setGroupPickerOpen(true);
  };

  const toggleGroupSelection = (groupJid: string) => {
    setGroupSearchSelection((current) =>
      current.includes(groupJid)
        ? current.filter((selectedJid) => selectedJid !== groupJid)
        : [...current, groupJid],
    );
  };

  const confirmGroupSelection = () => {
    const availableGroups = groupsQuery.data?.groups ?? [];
    const selected = new Set(groupSearchSelection);
    setSelectedWhatsAppGroups(
      availableGroups.filter((group) => selected.has(group.groupJid)),
    );
    setGroupPickerOpen(false);
  };

  const saveWhatsAppSetup = async () => {
    setSourceBusy("whatsapp", true);
    setWhatsappSetupError("");
    try {
      const response = await saveWhatsAppGroupSelections({
        groupJids: selectedWhatsAppGroups.map((group) => group.groupJid),
      });
      setSelectedWhatsAppGroups(response.groups);
      setWhatsappSetupInitialized(true);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: whatsappGroupSelectionsQueryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: whatsappSyncStatusQueryKey,
        }),
      ]);
      Alert.alert(
        "تم حفظ الإعدادات",
        "حُفظت مجموعات واتساب. لم تبدأ مزامنة الرسائل السابقة؛ فعّل خيار مزامنتها ثم اضغط «مزامنة الآن حسب الخيارات» عند الحاجة.",
      );
    } catch (error: unknown) {
      setWhatsappSetupError(
        error instanceof Error
          ? error.message
          : "تعذّر حفظ إعدادات مجموعات واتساب.",
      );
    } finally {
      setSourceBusy("whatsapp", false);
    }
  };

  const syncStatusQuery = useQuery({
    queryKey: whatsappSyncStatusQueryKey,
    queryFn: getWhatsAppSyncStatus,
    enabled: Boolean(connections?.whatsapp),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      Object.keys(clientTrackedSyncs).length > 0 ||
      query.state.data?.groups.some((group) => group.status === "running")
        ? 15_000
        : 60_000,
  });
  useEffect(() => {
    const groups = syncStatusQuery.data?.groups;
    if (!groups) return;
    setClientTrackedSyncs((current) => {
      let changed = false;
      const next = { ...current };
      for (const [groupJid, submittedAt] of Object.entries(current)) {
        const group = groups.find((entry) => entry.groupJid === groupJid);
        if (
          group &&
          group.status !== "running" &&
          group.completedAt &&
          Date.parse(group.completedAt) >= submittedAt
        ) {
          delete next[groupJid];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [syncStatusQuery.data]);
  const syncRunningOnServer = Boolean(
    Object.keys(clientTrackedSyncs).length > 0 ||
    syncStatusQuery.data?.groups.some((group) => group.status === "running"),
  );
  const syncInProgress = syncingWhatsApp || syncRunningOnServer;
  const visibleSyncGroups = (syncStatusQuery.data?.groups ?? []).filter(
    (group) =>
      group.savedMessageCount > 0 ||
      group.importedCount > 0 ||
      group.status !== "idle",
  );

  const runWhatsAppSync = async () => {
    if (syncRequestInFlightRef.current || syncRunningOnServer) return;
    const syncSettings = queryClient.getQueryData<WhatsAppSyncStatusResponse>(
      whatsappSyncStatusQueryKey,
    );
    if (
      syncSettings &&
      !syncSettings.syncMessagesEnabled &&
      !syncSettings.syncImagesEnabled &&
      !syncSettings.syncVideosEnabled
    ) {
      setSyncNotice(
        "لتبدأ المزامنة، فعّل خيارًا واحدًا على الأقل: مزامنة الرسائل أو الصور أو الفيديوهات.",
      );
      return;
    }
    setSyncNotice(null);
    syncRequestInFlightRef.current = true;
    const submittedAt = Date.now();
    try {
      setSyncingWhatsApp(true);
      const result = await triggerWhatsAppSyncNow(syncPreviousMessages);
      if (result.status === "no_sync_options") {
        setSyncNotice(
          "لتبدأ المزامنة، فعّل خيارًا واحدًا على الأقل: مزامنة الرسائل أو الصور أو الفيديوهات.",
        );
      } else if (result.status === "no_selected_groups") {
        Alert.alert(
          "لا توجد مجموعات محددة",
          "أضف مجموعة واتساب واحدة على الأقل من قسم إعداد الحساب قبل مزامنة الرسائل السابقة.",
        );
      } else if (result.status === "no_linked_announcement_groups") {
        Alert.alert(
          "لا توجد مجموعات قابلة للمزامنة",
          "لم يُعثر على مجموعات إعلانات مرتبطة ضمن المجموعات المحددة.",
        );
      } else {
        setClientTrackedSyncs((current) => ({
          ...current,
          ...Object.fromEntries(
            result.groups.map(({ groupJid }) => [groupJid, submittedAt]),
          ),
        }));
        const groupsByJid = new Map(
          (
            queryClient.getQueryData<WhatsAppSyncStatusResponse>(
              whatsappSyncStatusQueryKey,
            )?.groups ?? []
          ).map((group) => [group.groupJid, group]),
        );
        for (const group of result.groups) {
          const current = groupsByJid.get(group.groupJid);
          groupsByJid.set(group.groupJid, {
            groupJid: group.groupJid,
            groupName: group.groupName,
            status: "running",
            savedMessageCount: current?.savedMessageCount ?? 0,
            importedCount: current?.importedCount ?? 0,
            skippedCount: current?.skippedCount ?? 0,
            failedCount: current?.failedCount ?? 0,
            lastSyncedAt: current?.lastSyncedAt ?? null,
            lastError: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
          });
        }
        queryClient.setQueryData<WhatsAppSyncStatusResponse>(
          whatsappSyncStatusQueryKey,
          (current) => ({
            autoSyncEnabled: current?.autoSyncEnabled ?? true,
            syncMessagesEnabled: current?.syncMessagesEnabled ?? true,
            syncImagesEnabled: current?.syncImagesEnabled ?? true,
            syncVideosEnabled: current?.syncVideosEnabled ?? true,
            groups: [...groupsByJid.values()],
          }),
        );
        void queryClient.invalidateQueries({
          queryKey: whatsappSyncStatusQueryKey,
        });
        if (result.status === "already_running") {
          Alert.alert(
            "المزامنة قيد التنفيذ",
            "هناك عملية استيراد سابقة لم تنتهِ بعد. انتظر حتى تكتمل قبل بدء مزامنة أخرى.",
          );
        } else {
          Alert.alert(
            "بدأت المزامنة",
            syncPreviousMessages
              ? `بدأ استيراد الرسائل السابقة والجديدة حسب الخيارات المحددة من ${result.groups.length} مجموعة. تابع حالة كل مجموعة في هذا القسم.`
              : `بدأ استيراد الرسائل الجديدة فقط حسب الخيارات المحددة من ${result.groups.length} مجموعة. تابع حالة كل مجموعة في هذا القسم.`,
          );
        }
      }
    } catch (error: unknown) {
      Alert.alert(
        "تعذرت المزامنة",
        error instanceof Error
          ? error.message
          : "تعذّر بدء مزامنة واتساب الحقيقية.",
      );
    } finally {
      syncRequestInFlightRef.current = false;
      setSyncingWhatsApp(false);
    }
  };

  const updateSyncSetting = async (
    setting: WhatsAppSyncSettingKey,
    enabled: boolean,
  ) => {
    setSyncNotice(null);
    const previous = queryClient.getQueryData<WhatsAppSyncStatusResponse>(
      whatsappSyncStatusQueryKey,
    );
    const current = previous ?? {
      autoSyncEnabled: true,
      syncMessagesEnabled: true,
      syncImagesEnabled: true,
      syncVideosEnabled: true,
      groups: [],
    };
    const settings: WhatsAppSyncSettings = {
      autoSyncEnabled: Boolean(current.autoSyncEnabled ?? true),
      syncMessagesEnabled: Boolean(current.syncMessagesEnabled ?? true),
      syncImagesEnabled: Boolean(current.syncImagesEnabled ?? true),
      syncVideosEnabled: Boolean(current.syncVideosEnabled ?? true),
    };
    settings[setting] = enabled;
    setAutoSyncSaving((current) => ({ ...current, [setting]: true }));
    queryClient.setQueryData<WhatsAppSyncStatusResponse>(
      whatsappSyncStatusQueryKey,
      { ...current, ...settings },
    );
    try {
      const result = await updateWhatsAppSyncSettings({ [setting]: enabled });
      queryClient.setQueryData<WhatsAppSyncStatusResponse>(
        whatsappSyncStatusQueryKey,
        (latest) =>
          latest
            ? { ...latest, [setting]: result[setting] }
            : previous
              ? { ...previous, [setting]: result[setting] }
              : latest,
      );
    } catch (error: unknown) {
      if (previous) {
        queryClient.setQueryData<WhatsAppSyncStatusResponse>(
          whatsappSyncStatusQueryKey,
          (latest) =>
            latest ? { ...latest, [setting]: previous[setting] } : latest,
        );
      }
      Alert.alert(
        "تعذر تحديث إعداد المزامنة",
        error instanceof Error ? error.message : "تعذّر حفظ إعدادات المزامنة.",
      );
    } finally {
      setAutoSyncSaving((current) => ({ ...current, [setting]: false }));
    }
  };

  const loadGroupMessages = async (groupJid: string, page = 1) => {
    const requestKey = `${groupJid}:${page}`;
    if (groupMessagesRequestRef.current?.key === requestKey) return;

    groupMessagesRequestRef.current?.controller.abort();
    const controller = new AbortController();
    groupMessagesRequestRef.current = { key: requestKey, controller };
    setGroupMessagesLoading(true);
    setGroupMessagesError("");
    try {
      const response = await getWhatsAppGroupMessages(
        groupJid,
        {
          page,
          limit: 20,
          sort: "desc",
        },
        {
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setGroupMessagesData(response);
      setGroupMessagesPage(page);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setGroupMessagesError(
        error instanceof Error ? error.message : "تعذّر جلب رسائل المجموعة.",
      );
    } finally {
      if (groupMessagesRequestRef.current?.controller === controller) {
        groupMessagesRequestRef.current = null;
        setGroupMessagesLoading(false);
      }
    }
  };

  const closeGroupMessages = () => {
    groupMessagesRequestRef.current?.controller.abort();
    groupMessagesRequestRef.current = null;
    setGroupMessagesLoading(false);
    setGroupMessagesOpen(false);
  };

  const convertWhatsAppGroupToPost = async (messageId: string) => {
    setConvertingWhatsAppGroup(true);
    try {
      const response = await fetchApiResponse("/api/posts/from-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const result = (await response.json()) as { error?: unknown };
      if (!response.ok) {
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : "تعذّر تحويل مجموعة الوسائط إلى منشور.",
        );
      }
      await refreshPosts();
      if (activeGroupJid)
        await loadGroupMessages(activeGroupJid, groupMessagesPage);
      Alert.alert(
        "تم التحويل",
        "أُنشئ محتوى واحد للمجموعة، ويمكنك مراجعته في صفحة المحتوى.",
      );
    } catch (error: unknown) {
      Alert.alert(
        "تعذّر التحويل",
        error instanceof Error
          ? error.message
          : "تعذّر تحويل مجموعة الوسائط إلى منشور.",
      );
    } finally {
      setConvertingWhatsAppGroup(false);
    }
  };

  const decideWhatsAppAssociation = async (
    sourceMessageId: string,
    candidateMessageId: string,
    decision: "accepted" | "rejected",
  ) => {
    const actionKey = `${sourceMessageId}:${candidateMessageId}`;
    setAssociationDecisionPending(actionKey);
    setAssociationError("");
    try {
      await decideWhatsAppContentAssociation({
        firstMessageId: sourceMessageId,
        secondMessageId: candidateMessageId,
        decision,
      });
      if (activeGroupJid) {
        await loadGroupMessages(activeGroupJid, groupMessagesPage);
      }
    } catch (error) {
      setAssociationError(
        error instanceof Error
          ? error.message
          : "تعذّر حفظ قرار ارتباط الرسائل.",
      );
    } finally {
      setAssociationDecisionPending(null);
    }
  };

  const openGroupMessages = async (groupJid: string, groupName: string) => {
    setActiveGroupJid(groupJid);
    setActiveGroupName(groupName);
    setGroupMessagesPage(1);
    setGroupMessagesOpen(true);
    await loadGroupMessages(groupJid, 1);
  };

  // ─── Status helpers ──────────────────────────────────────────────────────────
  const isConnected = (key: SourceKey): boolean => {
    if (key === "facebook") return Boolean(connections?.facebook);
    if (key === "instagram") return Boolean(connections?.instagram);
    if (key === "whatsapp") {
      if (!connections?.whatsapp) return false;
      if (connections.whatsapp.connectionState !== undefined) {
        return connections.whatsapp.connectionState === "connected";
      }
      return connections.whatsapp.connected ?? true;
    }
    return false;
  };

  const sourceStatus = (key: SourceKey): string => {
    if (connectionsQuery.isLoading) return "جارٍ التحقق…";
    if (key === "facebook") {
      if (!connections?.facebook) return "غير مربوط";
      if (
        connections.facebook.authorizationStatus === "needs_reauthorization"
      ) {
        return connections.facebook.authorizationReason === "token_expired"
          ? "انتهت صلاحية الرمز · أعد التفويض"
          : "صلاحيات Meta تحتاج إلى تحقق · أعد التفويض";
      }
      return `متصل: ${connections.facebook.accountName}`;
    }
    if (key === "instagram") {
      if (connections?.instagram) {
        if (
          connections.instagram.authorizationStatus === "needs_reauthorization"
        ) {
          return connections.instagram.authorizationReason === "token_expired"
            ? "انتهت صلاحية الرمز · أعد التفويض"
            : "صلاحيات Meta تحتاج إلى تحقق · أعد التفويض";
        }
        return `متصل: @${connections.instagram.accountName}`;
      }
      return "غير مربوط";
    }
    if (key === "whatsapp") {
      if (!connections?.whatsapp) return "غير مربوط";
      if (isConnected("whatsapp"))
        return `متصل: ${connections.whatsapp.accountName}`;
      if (connections.whatsapp.connectionState === "connecting") {
        return "جارٍ استعادة اتصال واتساب…";
      }
      if (connections.whatsapp.connectionState === "unavailable") {
        return "الحساب محفوظ · تعذّر التحقق من الاتصال الآن";
      }
      return connections.whatsapp.connectionState === "missing"
        ? "الحساب محفوظ · نسخة الخادم غير موجودة"
        : "الحساب محفوظ · يحتاج إلى إعادة الاتصال";
    }
    return "غير مربوط";
  };

  const handlePress = (key: SourceKey) => {
    if (key === "instagram") {
      if (connections?.instagram) {
        if (
          connections.instagram.authorizationStatus === "needs_reauthorization"
        ) {
          void connectMeta("instagram");
        } else {
          disconnectMeta("instagram", connections.instagram.accountName);
        }
      } else void connectMeta("instagram");
      return;
    }
    if (key === "facebook") {
      if (connections?.facebook) {
        if (
          connections.facebook.authorizationStatus === "needs_reauthorization"
        ) {
          void connectMeta("facebook");
        } else {
          disconnectMeta("facebook", connections.facebook.accountName);
        }
      } else void connectMeta("facebook");
      return;
    }
    if (key === "whatsapp") {
      if (connections?.whatsapp && isConnected("whatsapp")) openWhatsAppSetup();
      else connectWhatsApp();
      return;
    }
  };

  const handleSourceCardPress = (key: SourceKey) => {
    if (isConnected(key)) {
      router.push({
        pathname: "/account/[platform]",
        params: { platform: key },
      });
      return;
    }
    handlePress(key);
  };

  const buttonLabel = (key: SourceKey): string => {
    if (busySources[key]) return "جارٍ الربط…";
    if (key === "whatsapp" && isConnected(key)) return "إكمال الإعداد";
    if (
      key === "whatsapp" &&
      connections?.whatsapp?.connectionState === "connecting"
    ) {
      return "جارٍ استعادة الاتصال…";
    }
    if (key === "whatsapp" && connections?.whatsapp) return "إعادة الربط";
    if (
      (key === "facebook" &&
        connections?.facebook?.authorizationStatus ===
          "needs_reauthorization") ||
      (key === "instagram" &&
        connections?.instagram?.authorizationStatus === "needs_reauthorization")
    ) {
      return "إعادة التفويض";
    }
    if (isConnected(key)) return "إلغاء الربط";
    if (key === "instagram" && !isConnected(key)) return "ربط الحساب";
    return "ربط الحساب";
  };

  useEffect(() => {
    if (
      typeof requestedConnect !== "string" ||
      !isSourceKey(requestedConnect) ||
      connectionsQuery.isLoading ||
      busySources[requestedConnect] ||
      autoConnectHandledRef.current ===
        `${requestedConnect}:${requestedReconnect ?? ""}`
    ) {
      return;
    }
    autoConnectHandledRef.current = `${requestedConnect}:${requestedReconnect ?? ""}`;
    const platform = requestedConnect;
    if (requestedReconnect === "true") {
      if (platform === "whatsapp") connectWhatsApp();
      else void connectMeta(platform);
      return;
    }
    if (isConnected(platform)) {
      router.replace({
        pathname: "/account/[platform]",
        params: { platform },
      });
    } else {
      handlePress(platform);
    }
  }, [
    requestedConnect,
    requestedReconnect,
    connectionsQuery.isLoading,
    busySources,
    connections,
  ]);

  return (
    <Page
      bottomPadding={
        socialSetupPending && !hasConnectedSocialAccount ? 24 : undefined
      }
    >
      <BrandHeader showBell />
      <PageTitle
        title={
          socialSetupPending
            ? "اربط حساباتك الاجتماعية مع MenaFlow"
            : "مصادر المحتوى"
        }
        subtitle={
          socialSetupPending
            ? "يساعدك الربط على إدارة المحتوى والرسائل من مكان واحد. اختر المنصات التي تستخدمها."
            : "اربط حساباتك الخاصة لتجهيز المحتوى ومتابعة الحسابات والنشر."
        }
      />

      {socialSetupPending && (
        <Panel
          style={[
            styles.setupRequirement,
            {
              backgroundColor: hasConnectedSocialAccount
                ? colors.accent
                : colors.card,
              borderColor: hasConnectedSocialAccount
                ? colors.primary
                : colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.requirementIcon,
              { backgroundColor: colors.background },
            ]}
          >
            {connectionsQuery.isPending ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Icon
                name={hasConnectedSocialAccount ? "check-circle" : "link-2"}
                size={22}
                color={colors.primary}
              />
            )}
          </View>
          <View style={styles.requirementCopy}>
            <View style={styles.requirementTitleRow}>
              <Text
                style={[styles.requirementTitle, { color: colors.foreground }]}
              >
                {hasConnectedSocialAccount
                  ? "تم استيفاء شرط المتابعة"
                  : "خطوة مطلوبة لإكمال الإعداد"}
              </Text>
              <StatusPill
                label={
                  connectionsQuery.isPending
                    ? "جارٍ التحقق"
                    : hasConnectedSocialAccount
                      ? "تم الربط"
                      : "مطلوب حساب واحد"
                }
                tone={hasConnectedSocialAccount ? "green" : "muted"}
              />
            </View>
            <Text
              style={[styles.requirementBody, { color: colors.foreground }]}
            >
              اربط حسابًا اجتماعيًا واحدًا على الأقل بنجاح للمتابعة إلى لوحة
              التحكم.
            </Text>
            <Text
              style={[
                styles.requirementHint,
                { color: colors.mutedForeground },
              ]}
            >
              {connectionsQuery.isError
                ? "تعذر التحقق من حالة الربط. حدّث الحالة بعد المحاولة."
                : hasConnectedSocialAccount
                  ? "يمكنك الآن المتابعة إلى لوحة التحكم."
                  : "اختر أي منصة متاحة أدناه؛ لا يلزم ربط جميع المنصات."}
            </Text>
          </View>
        </Panel>
      )}

      {onboardingQuery.isError && (
        <Panel style={styles.onboardingActions}>
          <Text style={[styles.error, { color: colors.destructive }]}>
            تعذر التحقق من حالة الإعداد. أعد المحاولة قبل المتابعة.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: onboardingQuery.isFetching }}
            disabled={onboardingQuery.isFetching}
            onPress={() => void onboardingQuery.refetch()}
            style={[
              styles.onboardingContinue,
              {
                backgroundColor: colors.primary,
                opacity: onboardingQuery.isFetching ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.onboardingContinueText,
                { color: colors.primaryForeground },
              ]}
            >
              {onboardingQuery.isFetching ? "جارٍ التحقق…" : "إعادة المحاولة"}
            </Text>
          </Pressable>
        </Panel>
      )}

      <SourcesConnectionsPanel
        compactLayout={compactLayout}
        connections={connections}
        busySources={busySources}
        disconnectingSource={disconnectingSource}
        connectionError={
          connectionsQuery.isError
            ? connectionsQuery.error instanceof Error
              ? connectionsQuery.error.message
              : "تعذر تحميل حالة الحسابات. تحقق من تشغيل الخادم وحاول التحديث."
            : null
        }
        isConnected={isConnected}
        sourceStatus={sourceStatus}
        buttonLabel={buttonLabel}
        onSourceCardPress={handleSourceCardPress}
        onSourceAction={handlePress}
        onOpenWhatsAppSetup={openWhatsAppSetup}
        onConnectWhatsApp={connectWhatsApp}
        onDisconnectWhatsApp={disconnectWhatsApp}
        onRefresh={() => void connectionsQuery.refetch()}
      />

      {socialSetupPending && (
        <View style={styles.onboardingActions}>
          {completeSocialSetup.isError && (
            <Text
              style={[
                styles.error,
                { color: colors.destructive, textAlign: "center" },
              ]}
            >
              تعذر حفظ حالة الإعداد. تحقق من اتصال الإنترنت ثم أعد المحاولة.
            </Text>
          )}
          {hasConnectedSocialAccount && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: completeSocialSetup.isPending }}
              disabled={completeSocialSetup.isPending}
              onPress={() => completeSocialSetup.mutate()}
              style={[
                styles.onboardingContinue,
                {
                  backgroundColor: colors.primary,
                  opacity: completeSocialSetup.isPending ? 0.7 : 1,
                },
              ]}
            >
              {completeSocialSetup.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    styles.onboardingContinueText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  المتابعة إلى لوحة التحكم
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {connections?.whatsapp && isConnected("whatsapp") ? (
        <WhatsAppSyncStatusPanel
          status={syncStatusQuery.data}
          groups={visibleSyncGroups}
          loading={syncStatusQuery.isLoading}
          hasError={syncStatusQuery.isError}
          autoSyncSaving={autoSyncSaving}
          syncing={syncInProgress}
          syncNotice={syncNotice}
          syncPreviousMessages={syncPreviousMessages}
          onSyncPreviousMessagesChange={setSyncPreviousMessages}
          onUpdateSetting={(setting, enabled) =>
            void updateSyncSetting(setting, enabled)
          }
          onOpenGroupMessages={(groupJid, groupName) =>
            void openGroupMessages(groupJid, groupName)
          }
          onRunSync={() => void runWhatsAppSync()}
        />
      ) : null}

      <WhatsAppPairingModal
        input={whatsappInput}
        phoneCountry={whatsappPhoneCountry}
        isExistingConnection={Boolean(connections?.whatsapp)}
        busy={Boolean(busySources.whatsapp)}
        error={whatsappError}
        formattedInternationalPhone={
          whatsappInput?.phoneNumber
            ? parseWhatsAppPhoneNumber(
                whatsappInput.phoneNumber,
                whatsappPhoneCountry,
              )?.formatInternational()
            : undefined
        }
        parsedCallingCode={(() => {
          const parsed = parseWhatsAppPhoneNumber(
            whatsappInput?.phoneNumber ?? "",
            whatsappPhoneCountry,
          );
          return parsed?.isValid()
            ? `+${parsed.countryCallingCode}`
            : undefined;
        })()}
        onChangeInput={setWhatsappInput}
        onOpenCountryPicker={() => setCountryPickerOpen(true)}
        onSubmit={(requestNewCode) => {
          setWhatsappError("");
          void submitWhatsAppConnection(requestNewCode);
        }}
        onClose={() => setWhatsappInput(null)}
      />

      <CountryPickerModal
        visible={countryPickerOpen}
        selectedCountry={whatsappPhoneCountry}
        onSelectCountry={(country) => setWhatsappPhoneCountry(country)}
        onClose={() => setCountryPickerOpen(false)}
      />
      <WhatsAppSetupModal
        visible={whatsappSetupOpen}
        loading={groupSelectionsQuery.isLoading}
        loadError={
          groupSelectionsQuery.isError
            ? groupSelectionsQuery.error instanceof Error
              ? groupSelectionsQuery.error.message
              : "تعذّر تحميل المجموعات المحفوظة."
            : undefined
        }
        groups={selectedWhatsAppGroups}
        initialized={whatsappSetupInitialized}
        busy={Boolean(busySources.whatsapp)}
        setupError={whatsappSetupError}
        onRetryLoading={() => {
          setWhatsappSetupInitialized(false);
          void groupSelectionsQuery.refetch();
        }}
        onRemoveGroup={(jid) =>
          setSelectedWhatsAppGroups((current) =>
            current.filter((item) => item.groupJid !== jid),
          )
        }
        onOpenGroupPicker={openGroupPicker}
        onSave={saveWhatsAppSetup}
        onClose={() => setWhatsappSetupOpen(false)}
      />
      <WhatsAppGroupPickerModal
        visible={groupPickerOpen}
        groupsData={groupsQuery.data}
        isLoading={groupsQuery.isLoading}
        isFetching={groupsQuery.isFetching}
        isError={groupsQuery.isError}
        errorMessage={
          groupsQuery.error instanceof Error
            ? groupsQuery.error.message
            : undefined
        }
        selection={groupSearchSelection}
        onToggleGroup={toggleGroupSelection}
        onSetSelection={setGroupSearchSelection}
        onRefetch={() => void groupsQuery.refetch()}
        onConfirm={confirmGroupSelection}
        onClose={() => setGroupPickerOpen(false)}
      />

      <WhatsAppGroupMessagesModal
        visible={groupMessagesOpen}
        activeGroupJid={activeGroupJid}
        activeGroupName={activeGroupName}
        loading={groupMessagesLoading}
        error={groupMessagesError}
        messagesData={groupMessagesData}
        displayedMessageGroups={displayedMessageGroups}
        page={groupMessagesPage}
        converting={convertingWhatsAppGroup}
        associationDecisionPending={associationDecisionPending}
        associationError={associationError}
        onClose={closeGroupMessages}
        onPreview={setPreviewMediaUrl}
        onConvert={(messageId) => void convertWhatsAppGroupToPost(messageId)}
        onAssociationDecision={(sourceMessageId, candidateMessageId, decision) =>
          void decideWhatsAppAssociation(
            sourceMessageId,
            candidateMessageId,
            decision,
          )
        }
        onLoadPage={(jid, page) => void loadGroupMessages(jid, page)}
      />

      <MediaPreviewModal
        url={previewMediaUrl}
        onClose={() => setPreviewMediaUrl(null)}
      />

      <DisconnectConfirmModal
        dialog={disconnectDialog}
        hasInstagramConnected={Boolean(connections?.instagram)}
        onConfirm={() => void confirmDisconnect()}
        onClose={() => {
          if (disconnectDialog?.status !== "pending") setDisconnectDialog(null);
        }}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  setupRequirement: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    padding: 16,
  },
  requirementIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  requirementCopy: { flex: 1, alignItems: "flex-end", gap: 7 },
  requirementTitleRow: {
    width: "100%",
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  requirementTitle: { fontSize: 14, fontWeight: "800", textAlign: "right" },
  requirementBody: {
    width: "100%",
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "700",
    textAlign: "right",
  },
  requirementHint: {
    width: "100%",
    fontSize: 12,
    lineHeight: 19,
    textAlign: "right",
  },
  onboardingActions: { alignItems: "stretch", gap: 12, paddingTop: 2 },
  onboardingContinue: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  onboardingContinueText: { fontSize: 13, fontWeight: "800" },
  error: { fontSize: 12, lineHeight: 18, textAlign: "right" },
});
