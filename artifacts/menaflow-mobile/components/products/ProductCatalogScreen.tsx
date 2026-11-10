import React, { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useAuth } from "@clerk/expo";
import {
  getGetSocialConnectionsQueryKey,
  getSocialAccountDetails,
  getSocialConnections,
  type AccountPlatform,
  type SocialAccountPost,
} from "@workspace/api-client-react";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isLocalAuthDisabled } from "@/constants/auth";
import {
  CairoText as Text,
  CairoTextInput,
} from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import {
  formatArabicCurrency,
  formatArabicDate,
  formatArabicDateTime,
  formatArabicNumber,
  normalizeArabicDigits,
} from "@/lib/formatting";
import { mediaUrlForApp } from "@/lib/content-utils";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  createExtractionProductDraft,
  createCatalogProduct,
  dismissProductExtraction,
  analyzeWhatsAppProductMessages,
  getProductCandidates,
  getProductCatalog,
  getInventoryMovements,
  getWhatsAppProductExtractions,
  getPublishableAccounts,
  getProductPublicationJobs,
  publishCatalogProducts,
  retryProductPublicationJobs,
  importProductCandidate,
  reviewProductExtraction,
  type CatalogProduct,
  type PublishableAccount,
  type ProductExtractionSuggestion,
  type ProductPublicationSnapshot,
} from "@/lib/product-catalog-api";
import {
  draftFromExtraction,
  draftFromProduct,
  emptyDraft,
  useProductEditorWorkflow,
  type ProductDraft,
} from "@/hooks/use-product-editor-workflow";

type CatalogTabId = "all" | "drafts" | "active" | "archived" | "extractions";
const MAX_SELECTED_PRODUCTS = 50;

const catalogTabDefinitions: Array<{ id: CatalogTabId; label: string }> = [
  { id: "all", label: "الكل" },
  { id: "drafts", label: "المسودات" },
  { id: "active", label: "المفعّلة" },
  { id: "archived", label: "الأرشيف" },
  { id: "extractions", label: "اقتراحات الاستخراج" },
];

function productPublicationPreview(product: CatalogProduct): string {
  const availability = {
    unknown: "",
    in_stock: "متوفر",
    out_of_stock: "غير متوفر",
    preorder: "متاح للطلب المسبق",
  }[product.availability];
  return [
    product.name.trim(),
    product.description.trim(),
    product.price !== null
      ? [product.price, product.currency].filter(Boolean).join(" ")
      : "",
    availability,
  ]
    .filter(Boolean)
    .filter((line, index, lines) => lines.indexOf(line) === index)
    .join("\n");
}

function productPublicationDisabledReason(
  product: CatalogProduct,
): string | null {
  if (product.status !== "active") {
    return "فعّل المنتج من حالة السجل قبل نشره.";
  }
  if (!product.verifiedAt) {
    return "راجع بيانات المنتج واحفظها بعد التحقق قبل نشره.";
  }
  return null;
}

function catalogLoadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "تعذر تحميل بيانات المنتجات. تحقق من اتصال الإنترنت ثم أعد المحاولة.";
  }
  if (
    /failed to fetch|network request failed|networkerror/i.test(error.message)
  ) {
    return "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.";
  }
  return error.message;
}

function ProductMediaThumbnail({ uri, label }: { uri: string; label: string }) {
  const colors = useColors();
  const resolvedUri = mediaUrlForApp(uri);
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (failedUri === resolvedUri) {
    return (
      <View
        accessibilityLabel="تعذر تحميل الصورة"
        style={[
          styles.productMediaThumbnail,
          styles.productVideoPlaceholder,
          { backgroundColor: colors.secondary },
        ]}
      >
        <Text
          style={{
            color: colors.mutedForeground,
            fontSize: 10,
            textAlign: "center",
          }}
        >
          تعذر تحميل الصورة
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: resolvedUri }}
      style={styles.productMediaThumbnail}
      contentFit="cover"
      cachePolicy="disk"
      accessibilityLabel={label}
      onError={() => setFailedUri(resolvedUri)}
    />
  );
}

function CatalogTabs({
  activeTab,
  counts,
  onSelect,
}: {
  activeTab: CatalogTabId;
  counts: Record<CatalogTabId, number | null>;
  onSelect: (tab: CatalogTabId) => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[styles.catalogTabsFrame, { backgroundColor: colors.secondary }]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.catalogTabsScroll}
        contentContainerStyle={styles.catalogTabsContent}
      >
        {catalogTabDefinitions.map((tab) => {
          const selected = activeTab === tab.id;
          const count = counts[tab.id];
          return (
            <Pressable
              key={tab.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => onSelect(tab.id)}
              style={({ pressed }) => [
                styles.catalogTab,
                {
                  backgroundColor: selected ? colors.card : "transparent",
                  borderColor: selected ? colors.border : "transparent",
                  opacity: pressed ? 0.76 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: selected ? colors.primary : colors.mutedForeground,
                  fontSize: 12,
                  fontWeight: selected ? "800" : "600",
                }}
              >
                {tab.label}
              </Text>
              <View
                style={[
                  styles.catalogTabCount,
                  {
                    backgroundColor: selected
                      ? colors.accent
                      : colors.secondary,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected ? colors.primary : colors.mutedForeground,
                    fontSize: 10,
                    fontWeight: "700",
                  }}
                >
                  {count === null ? "…" : formatArabicNumber(count)}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function ProductCatalogScreen() {
  if (isLocalAuthDisabled) return <ProductCatalogContent userId={null} />;
  return <AuthenticatedProductCatalog />;
}

function AuthenticatedProductCatalog() {
  const { userId } = useAuth();
  return <ProductCatalogContent userId={userId ?? null} />;
}

function ProductCatalogContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<CatalogTabId>("all");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [publishModalVisible, setPublishModalVisible] = useState(false);
  const [selectedTargetKeys, setSelectedTargetKeys] = useState<Set<string>>(
    new Set(),
  );
  const [publicationRequestKey, setPublicationRequestKey] = useState<
    string | null
  >(null);
  const [pendingRequestKey, setPendingRequestKey] = useState<string | null>(
    null,
  );
  const [error, setError] = useState("");
  const [analysisSummary, setAnalysisSummary] = useState("");
  const [selectedScanPlatform, setSelectedScanPlatform] =
    useState<AccountPlatform | null>(null);
  const [selectedScanOperation, setSelectedScanOperation] = useState<
    "messages" | "posts" | null
  >(null);
  const [scannedPosts, setScannedPosts] = useState<SocialAccountPost[]>([]);
  const catalogKey = ["product-catalog", userId ?? "local", activeTab] as const;
  const candidatesKey = ["product-post-candidates", userId ?? "local"] as const;
  const extractionsKey = [
    "whatsapp-product-extractions",
    userId ?? "local",
  ] as const;
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => getProductCatalog(activeTab === "archived"),
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
    staleTime: 60_000,
  });
  const candidates = useQuery({
    queryKey: candidatesKey,
    queryFn: getProductCandidates,
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
    refetchInterval: 45 * 60_000,
  });
  const extractions = useQuery({
    queryKey: extractionsKey,
    queryFn: getWhatsAppProductExtractions,
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
    refetchInterval: 10_000,
  });
  const connections = useQuery({
    queryKey: [
      ...getGetSocialConnectionsQueryKey(),
      userId ?? "local",
    ] as const,
    queryFn: getSocialConnections,
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
  });
  const publishableAccounts = useQuery({
    queryKey: ["product-publish-accounts", userId ?? "local"],
    queryFn: getPublishableAccounts,
    enabled: (isLocalAuthDisabled || Boolean(userId)) && publishModalVisible,
    retry: false,
  });
  const publication = useQuery({
    queryKey: [
      "product-publication-jobs",
      userId ?? "local",
      publicationRequestKey,
    ],
    queryFn: () => getProductPublicationJobs(publicationRequestKey!),
    enabled:
      (isLocalAuthDisabled || Boolean(userId)) &&
      Boolean(publicationRequestKey),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.summary.inProgress ? 2000 : false,
  });
  useEffect(() => {
    if (!publicationRequestKey || !publication.data) return;
    if (publication.data.summary.inProgress > 0) return;
    void queryClient.invalidateQueries({
      queryKey: ["product-catalog", userId ?? "local"],
    });
  }, [
    publication.data?.summary.inProgress,
    publicationRequestKey,
    queryClient,
    userId,
  ]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["product-catalog", userId ?? "local"],
      }),
      queryClient.invalidateQueries({ queryKey: candidatesKey }),
      queryClient.invalidateQueries({ queryKey: extractionsKey }),
    ]);
  };
  const {
    editor,
    setEditor,
    save,
    mediaUploading,
    openEditor,
    requestEditorClose,
    updateDraft,
    removeProductMedia,
    addProductMedia,
    saveProduct,
  } = useProductEditorWorkflow({ catalogKey, refresh, setError });
  const inventoryProductId = editor?.id;
  const inventoryMovements = useQuery({
    queryKey: [
      "inventory-movements",
      userId ?? "local",
      editor?.id ?? "new-product",
    ],
    queryFn: () => {
      if (!inventoryProductId) {
        throw new Error("لا يمكن تحميل سجل المخزون دون تحديد المنتج.");
      }
      return getInventoryMovements(inventoryProductId);
    },
    enabled:
      (isLocalAuthDisabled || Boolean(userId)) &&
      Boolean(editor?.id && editor.value.inventoryTracked),
  });
  const analyzeWhatsAppMessages = useMutation({
    mutationFn: analyzeWhatsAppProductMessages,
    onSuccess: async (result) => {
      await refresh();
      setError("");
      setAnalysisSummary(
        result.queuedMessages > 0
          ? `تمت جدولة معالجة ${result.queuedMessages} رسالة. ستظهر المنتجات والاقتراحات تلقائيًا بعد اكتمالها.`
          : "لا توجد رسائل جديدة أو غير معالجة في المجموعات المحددة.",
      );
      setScannedPosts([]);
    },
    onError: (cause) => {
      setAnalysisSummary("");
      setError(
        cause instanceof Error ? cause.message : "تعذر تحليل رسائل WhatsApp.",
      );
    },
  });
  const scanConnectedPosts = useMutation({
    mutationFn: (platform: AccountPlatform) =>
      getSocialAccountDetails(platform),
    onSuccess: (details) => {
      const posts = details.posts ?? [];
      setScannedPosts(posts);
      setAnalysisSummary(
        posts.length
          ? `تم جلب ${formatArabicNumber(posts.length)} من أحدث منشورات ${details.platform === "facebook" ? "فيسبوك" : "إنستغرام"} للمراجعة.`
          : "لم يُعثر على منشورات متاحة لهذا الحساب.",
      );
      setError(
        posts.length === 0 && details.issues.length > 0
          ? details.issues[0]!
          : "",
      );
    },
    onError: (cause) => {
      setScannedPosts([]);
      setAnalysisSummary("");
      const message = cause instanceof Error ? cause.message : "";
      setError(
        /[\u0600-\u06FF]/.test(message)
          ? message
          : "تعذر جلب منشورات الحساب. تحقق من اتصال الحساب وصلاحيات القراءة ثم أعد المحاولة.",
      );
    },
  });
  const publishProducts = useMutation({
    mutationFn: publishCatalogProducts,
    onSuccess: async (result) => {
      setPublicationRequestKey(result.requestKey);
      setPendingRequestKey(null);
      setSelectedProductIds(new Set());
      setPublishModalVisible(false);
      setError("");
      await queryClient.invalidateQueries({
        queryKey: ["product-publication-jobs", userId ?? "local"],
      });
    },
    onError: (cause) => {
      setError(
        cause instanceof Error ? cause.message : "تعذر جدولة عمليات النشر.",
      );
    },
  });
  const retryPublication = useMutation({
    mutationFn: retryProductPublicationJobs,
    onSuccess: async () => {
      if (publicationRequestKey) {
        await queryClient.invalidateQueries({
          queryKey: [
            "product-publication-jobs",
            userId ?? "local",
            publicationRequestKey,
          ],
        });
      }
    },
    onError: (cause) => {
      setError(
        cause instanceof Error ? cause.message : "تعذرت إعادة محاولة النشر.",
      );
    },
  });
  const createExtractionDraft = useMutation({
    mutationFn: (suggestionId: string) =>
      createExtractionProductDraft(suggestionId),
    onSuccess: async (product) => {
      await refresh();
      openEditor({
        id: product.id,
        value: draftFromProduct(product),
        mediaPreviews: product.mediaPreviews,
      });
      setError("");
    },
    onError: (cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "تعذر إنشاء مسودة من الاقتراح.",
      ),
  });
  const allProducts = catalog.data ?? [];
  const productsForTab =
    activeTab === "drafts"
      ? allProducts.filter((product) => product.status === "draft")
      : activeTab === "active"
        ? allProducts.filter((product) => product.status === "active")
        : activeTab === "archived"
          ? allProducts.filter((product) => product.status === "archived")
          : activeTab === "extractions"
            ? []
            : allProducts;
  const normalizedProductSearch = normalizeArabicDigits(productSearch)
    .trim()
    .toLocaleLowerCase("ar");
  const visibleProducts = productsForTab.filter((product) => {
    if (!normalizedProductSearch) return true;
    const searchableText = normalizeArabicDigits(
      [product.name, product.sku ?? "", ...product.aliases, product.description]
        .join(" ")
        .toLocaleLowerCase("ar"),
    );
    return searchableText.includes(normalizedProductSearch);
  });
  const selectedProducts = allProducts.filter(
    (product) =>
      selectedProductIds.has(product.id) &&
      productPublicationDisabledReason(product) === null,
  );
  const selectableVisibleProducts = visibleProducts.filter(
    (product) => productPublicationDisabledReason(product) === null,
  );
  const extractionCount =
    extractions.isPending || candidates.isPending
      ? null
      : (extractions.data?.length ?? 0) + (candidates.data?.length ?? 0);
  const tabCounts: Record<CatalogTabId, number | null> = {
    all: catalog.data === undefined ? null : allProducts.length,
    drafts:
      catalog.data === undefined
        ? null
        : allProducts.filter((product) => product.status === "draft").length,
    active:
      catalog.data === undefined
        ? null
        : allProducts.filter((product) => product.status === "active").length,
    archived:
      catalog.data === undefined
        ? null
        : allProducts.filter((product) => product.status === "archived").length,
    extractions: extractionCount,
  };
  const selectedAllVisible =
    selectableVisibleProducts.length > 0 &&
    selectableVisibleProducts.every((product) =>
      selectedProductIds.has(product.id),
    );
  const connectedAccounts = publishableAccounts.data ?? [];
  const scanAccounts = [
    connections.data?.whatsapp
      ? {
          platform: "whatsapp" as const,
          accountName: connections.data.whatsapp.accountName,
          ready:
            connections.data.whatsapp.connected === true &&
            connections.data.whatsapp.connectionState === "connected",
        }
      : null,
    connections.data?.facebook
      ? {
          platform: "facebook" as const,
          accountName: connections.data.facebook.accountName,
          ready: connections.data.facebook.authorizationStatus === "ready",
        }
      : null,
    connections.data?.instagram
      ? {
          platform: "instagram" as const,
          accountName: connections.data.instagram.accountName,
          ready: connections.data.instagram.authorizationStatus === "ready",
        }
      : null,
  ].filter(
    (account): account is NonNullable<typeof account> => account !== null,
  );
  const activeScanPlatform =
    selectedScanPlatform &&
    scanAccounts.some(
      (account) => account.platform === selectedScanPlatform,
    )
      ? selectedScanPlatform
      : (scanAccounts.find((account) => account.ready)?.platform ??
        scanAccounts[0]?.platform ??
        null);
  const activeScanAccount = scanAccounts.find(
    (account) => account.platform === activeScanPlatform,
  );
  const defaultScanOperation =
    activeScanPlatform === "whatsapp"
      ? "messages"
      : activeScanPlatform
        ? "posts"
        : null;
  const activeScanOperation =
    selectedScanOperation === defaultScanOperation
      ? selectedScanOperation
      : defaultScanOperation;
  const selectedTargets = connectedAccounts.filter(
    (account) =>
      account.authorizationStatus === "ready" &&
      selectedTargetKeys.has(`${account.channel}:${account.accountId}`),
  );
  const repeatedPublicationCount = selectedProducts.filter((product) =>
    (product.publicationHistory ?? []).some((publication) =>
      selectedTargets.some(
        (target) =>
          target.channel === publication.channel &&
          target.accountId === publication.accountId,
      ),
    ),
  ).length;
  const instagramMediaMissing =
    selectedTargets.some(({ channel }) => channel === "instagram") &&
    selectedProducts.some((product) => product.mediaUrls.length === 0);
  const toggleProductSelection = (productId: string) => {
    if (
      !selectedProductIds.has(productId) &&
      selectedProductIds.size >= MAX_SELECTED_PRODUCTS
    ) {
      setError(
        `يمكن تحديد ${MAX_SELECTED_PRODUCTS} منتجًا كحد أقصى لكل عملية نشر.`,
      );
      return;
    }
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setError("");
  };
  const toggleAllVisibleProducts = () => {
    const remaining = MAX_SELECTED_PRODUCTS - selectedProductIds.size;
    const additions = selectableVisibleProducts.filter(
      (product) => !selectedProductIds.has(product.id),
    );
    if (!selectedAllVisible && additions.length > remaining) {
      setError(
        `يمكن تحديد ${MAX_SELECTED_PRODUCTS} منتجًا كحد أقصى لكل عملية نشر.`,
      );
    } else {
      setError("");
    }
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (selectedAllVisible) {
        selectableVisibleProducts.forEach((product) => next.delete(product.id));
      } else {
        selectableVisibleProducts
          .filter((product) => !next.has(product.id))
          .slice(0, Math.max(remaining, 0))
          .forEach((product) => next.add(product.id));
      }
      return next;
    });
  };
  const startProductPublication = () => {
    if (selectedTargets.length === 0 || selectedProducts.length === 0) return;
    if (
      selectedTargets.some(({ channel }) => channel === "instagram") &&
      selectedProducts.some((product) => product.mediaUrls.length === 0)
    ) {
      return;
    }
    const requestKey = pendingRequestKey ?? randomUUID();
    setPendingRequestKey(requestKey);
    publishProducts.mutate({
      requestKey,
      productIds: selectedProducts.map((product) => product.id),
      targets: selectedTargets.map(({ channel, accountId }) => ({
        channel,
        accountId,
      })),
    });
  };
  const dismissExtraction = useMutation({
    mutationFn: dismissProductExtraction,
    onSuccess: refresh,
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "تعذر استبعاد اقتراح المنتج.",
      ),
  });
  const reviewExtraction = useMutation({
    mutationFn: reviewProductExtraction,
    onSuccess: refresh,
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "تعذر حفظ تقييم الاقتراح.",
      ),
  });
  const importPost = useMutation({
    mutationFn: importProductCandidate,
    onSuccess: async (product) => {
      await refresh();
      openEditor({
        id: product.id,
        value: draftFromProduct(product),
        mediaPreviews: product.mediaPreviews,
        importedFromPost: product.status !== "active",
      });
      setError("");
    },
    onError: (cause) =>
      setError(
        cause instanceof Error ? cause.message : "تعذر استيراد المنشور كمسودة.",
      ),
  });

  const openExtractionEditor = (
    suggestion: ProductExtractionSuggestion,
    product: CatalogProduct | null,
    useExtractedValues: boolean,
  ) => {
    openEditor(
      product
        ? {
            id: product.id,
            value: draftFromProduct(product),
            mediaPreviews: product.mediaPreviews,
            sourceContext: suggestion.sources.map((source) => source.text),
          }
        : {
            id: null,
            value: useExtractedValues
              ? draftFromExtraction(suggestion)
              : { ...emptyDraft },
            mediaPreviews: [],
            extractionSuggestionId: suggestion.id,
            sourceContext: suggestion.sources.map((source) => source.text),
          },
    );
    setError("");
  };

  const confirmDismissExtraction = (suggestionId: string) => {
    Alert.alert(
      "استبعاد الاقتراح؟",
      "سيختفي الاقتراح من قائمة المراجعة، مع الاحتفاظ بالرسائل المصدر.",
      [
        { text: "إلغاء", style: "cancel" },
        {
          text: "استبعاد",
          style: "destructive",
          onPress: () => dismissExtraction.mutate(suggestionId),
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <Page
        bottomPadding={selectedProducts.length ? 184 : undefined}
        refreshControl={
          <RefreshControl
            refreshing={
              catalog.isRefetching ||
              candidates.isRefetching ||
              extractions.isRefetching
            }
            onRefresh={() => void refresh()}
            tintColor={colors.primary}
          />
        }
      >
        <BrandHeader />
        <Panel style={styles.catalogIntro}>
          <View
            style={[styles.catalogEyebrow, { backgroundColor: colors.accent }]}
          >
            <Icon name="package" size={15} color={colors.primary} />
            <Text
              style={[styles.catalogEyebrowText, { color: colors.primary }]}
            >
              مكتبة منتجاتك
            </Text>
          </View>
          <PageTitle
            title="كتالوج المنتجات"
            subtitle="مصدر معلومات المنتجات المعتمدة للرد على العملاء."
            back={{
              href:
                returnTo === "settings"
                  ? "/(tabs)/more/settings"
                  : "/(tabs)/products",
              label:
                returnTo === "settings"
                  ? "العودة إلى الإعدادات"
                  : "العودة إلى المنتجات",
            }}
            action={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إضافة منتج"
                onPress={() =>
                  openEditor({ id: null, value: emptyDraft, mediaPreviews: [] })
                }
                style={({ pressed }) => [
                  styles.addButton,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.84 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
              >
                <Icon name="plus" size={17} color={colors.primaryForeground} />
                <Text
                  style={{
                    color: colors.primaryForeground,
                    fontWeight: "700",
                  }}
                >
                  إضافة منتج
                </Text>
              </Pressable>
            }
          />
        </Panel>
        <CatalogTabs
          activeTab={activeTab}
          counts={tabCounts}
          onSelect={(tab) => {
            if (tab === activeTab) return;
            setActiveTab(tab);
            setSelectedProductIds(new Set());
          }}
        />

        {error ? (
          <Panel
            style={[styles.errorPanel, { borderColor: colors.destructive }]}
          >
            <Text
              accessibilityRole="alert"
              style={{ color: colors.destructive }}
            >
              {error}
            </Text>
          </Panel>
        ) : null}

        {activeTab === "extractions" ? (
          <View style={styles.section}>
            <Panel style={styles.scanPanel}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                فحص محتوى الحسابات المتصلة
              </Text>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                اختر الحساب ثم نوع المحتوى الذي تريد مراجعته.
              </Text>
              {connections.isPending ? (
                <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                  جارٍ تحميل الحسابات المتصلة...
                </Text>
              ) : scanAccounts.length ? (
                <View style={styles.scanOptions}>
                  {scanAccounts.map((account) => {
                    const selected = activeScanPlatform === account.platform;
                    const platformName =
                      account.platform === "whatsapp"
                        ? "واتساب"
                        : account.platform === "facebook"
                          ? "فيسبوك"
                          : "إنستغرام";
                    return (
                      <Pressable
                        key={account.platform}
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: selected,
                          disabled: !account.ready,
                        }}
                        disabled={!account.ready || scanConnectedPosts.isPending || analyzeWhatsAppMessages.isPending}
                        onPress={() => {
                          setSelectedScanPlatform(account.platform);
                          setSelectedScanOperation(
                            account.platform === "whatsapp" ? "messages" : "posts",
                          );
                          setScannedPosts([]);
                          setAnalysisSummary("");
                          setError("");
                        }}
                        style={[
                          styles.scanAccountOption,
                          {
                            borderColor: selected ? colors.primary : colors.border,
                            backgroundColor: selected ? colors.accent : colors.card,
                            opacity: account.ready ? 1 : 0.55,
                          },
                        ]}
                      >
                        <View style={styles.scanAccountCopy}>
                          <Text style={[styles.accountName, { color: colors.foreground }]}>
                            {platformName}
                          </Text>
                          <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                            {account.accountName}
                          </Text>
                          {!account.ready ? (
                            <Text style={[styles.helper, { color: colors.warning }]}>
                              تحقق من اتصال الحساب وصلاحياته
                            </Text>
                          ) : null}
                        </View>
                        <View
                          style={[
                            styles.scanRadio,
                            {
                              borderColor: selected ? colors.primary : colors.border,
                              backgroundColor: selected ? colors.primary : "transparent",
                            },
                          ]}
                        >
                          {selected ? (
                            <Icon name="check" size={12} color={colors.primaryForeground} />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : connections.isError ? (
                <Text accessibilityRole="alert" style={[styles.helper, { color: colors.destructive }]}>
                  تعذر تحميل الحسابات المتصلة. أعد المحاولة أو تحقق من صفحة المصادر.
                </Text>
              ) : (
                <View style={styles.scanEmpty}>
                  <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                    اربط حساب WhatsApp أو Facebook أو Instagram لبدء الفحص.
                  </Text>
                  <ActionButton
                    label="إدارة الحسابات المتصلة"
                    icon="link"
                    secondary
                    onPress={() => router.push("/(tabs)/sources")}
                  />
                </View>
              )}
              {activeScanAccount ? (
                <>
                  <Text style={[styles.scanLabel, { color: colors.foreground }]}>
                    نوع الفحص
                  </Text>
                  <View style={styles.scanOperations}>
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: activeScanOperation === "messages",
                        disabled:
                          activeScanPlatform !== "whatsapp" ||
                          !activeScanAccount.ready,
                      }}
                      disabled={
                        activeScanPlatform !== "whatsapp" ||
                        !activeScanAccount.ready
                      }
                      onPress={() => setSelectedScanOperation("messages")}
                      style={[
                        styles.scanOperation,
                        {
                          borderColor:
                            activeScanOperation === "messages"
                              ? colors.primary
                              : colors.border,
                          backgroundColor:
                            activeScanOperation === "messages"
                              ? colors.accent
                              : colors.card,
                          opacity: activeScanPlatform === "whatsapp" ? 1 : 0.55,
                        },
                      ]}
                    >
                      <Icon name="message-circle" size={18} color={colors.primary} />
                      <View style={styles.scanAccountCopy}>
                        <Text style={[styles.accountName, { color: colors.foreground }]}>
                          فحص رسائل WhatsApp
                        </Text>
                        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                          استخراج المنتجات من الرسائل غير المفحوصة.
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: activeScanOperation === "posts",
                        disabled:
                          activeScanPlatform === "whatsapp" ||
                          !activeScanAccount.ready,
                      }}
                      disabled={
                        activeScanPlatform === "whatsapp" ||
                        !activeScanAccount.ready
                      }
                      onPress={() => setSelectedScanOperation("posts")}
                      style={[
                        styles.scanOperation,
                        {
                          borderColor:
                            activeScanOperation === "posts"
                              ? colors.primary
                              : colors.border,
                          backgroundColor:
                            activeScanOperation === "posts"
                              ? colors.accent
                              : colors.card,
                          opacity: activeScanPlatform === "whatsapp" ? 0.55 : 1,
                        },
                      ]}
                    >
                      <Icon name="file-text" size={18} color={colors.primary} />
                      <View style={styles.scanAccountCopy}>
                        <Text style={[styles.accountName, { color: colors.foreground }]}>
                          فحص المنشورات
                        </Text>
                        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                          جلب أحدث 25 منشورًا من حساب Meta للمراجعة.
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                  <ActionButton
                    label={
                      activeScanOperation === "messages"
                        ? analyzeWhatsAppMessages.isPending
                          ? "جارٍ جدولة رسائل WhatsApp..."
                          : "بدء فحص الرسائل"
                        : scanConnectedPosts.isPending
                          ? "جارٍ جلب المنشورات..."
                          : "بدء فحص المنشورات"
                    }
                    icon="refresh-cw"
                    disabled={
                      !activeScanAccount.ready ||
                      analyzeWhatsAppMessages.isPending ||
                      scanConnectedPosts.isPending
                    }
                    onPress={() => {
                      setError("");
                      setAnalysisSummary("");
                      setScannedPosts([]);
                      if (activeScanOperation === "messages") {
                        analyzeWhatsAppMessages.mutate();
                      } else if (
                        activeScanPlatform &&
                        activeScanPlatform !== "whatsapp"
                      ) {
                        scanConnectedPosts.mutate(activeScanPlatform);
                      }
                    }}
                  />
                </>
              ) : null}
            </Panel>
            {analysisSummary ? (
              <Text style={[styles.helper, { color: colors.primary }]}>
                {analysisSummary}
              </Text>
            ) : null}
            {scannedPosts.map((post) => (
              <Panel key={post.id} style={styles.scannedPost}>
                <View style={styles.scannedPostHeader}>
                  <Text style={[styles.accountName, { color: colors.foreground }]}>
                    {post.publishedAt
                      ? formatArabicDateTime(post.publishedAt) ?? "منشور حديث"
                      : "منشور حديث"}
                  </Text>
                  {post.url ? (
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel="فتح المنشور على المنصة"
                      onPress={() => {
                        void Linking.openURL(post.url!).catch(() =>
                          setError("تعذر فتح رابط المنشور."),
                        );
                      }}
                      style={styles.scanPostLink}
                    >
                      <Icon name="external-link" size={16} color={colors.primary} />
                    </Pressable>
                  ) : null}
                </View>
                {post.text ? (
                  <Text
                    numberOfLines={5}
                    style={[styles.description, { color: colors.foreground }]}
                  >
                    {post.text}
                  </Text>
                ) : (
                  <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                    لا يحتوي المنشور على نص.
                  </Text>
                )}
                {post.imageUrl ? (
                  <ProductMediaThumbnail uri={post.imageUrl} label="وسائط المنشور" />
                ) : null}
                <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                  الإعجابات: {formatArabicNumber(post.likes ?? 0)} · التعليقات:{" "}
                  {formatArabicNumber(post.comments ?? 0)}
                </Text>
              </Panel>
            ))}
            {extractions.isError ? (
              <Text
                accessibilityRole="alert"
                style={[styles.helper, { color: colors.destructive }]}
              >
                {extractions.error instanceof Error
                  ? extractions.error.message
                  : "تعذر تحميل اقتراحات المنتجات."}
              </Text>
            ) : extractions.isPending ? (
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                جارٍ تحميل اقتراحات المنتجات...
              </Text>
            ) : extractions.data?.length ? (
              <>
                {extractions.data.map((suggestion) => (
                  <ProductExtractionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    product={
                      suggestion.productId
                        ? (catalog.data?.find(
                            (item) => item.id === suggestion.productId,
                          ) ?? null)
                        : null
                    }
                    actionPending={
                      createExtractionDraft.isPending ||
                      dismissExtraction.isPending ||
                      reviewExtraction.isPending
                    }
                    onCreateDraft={() =>
                      suggestion.status === "possible_duplicate" ||
                      !suggestion.extractedData.name?.trim()
                        ? openExtractionEditor(suggestion, null, true)
                        : createExtractionDraft.mutate(suggestion.id)
                    }
                    onDismiss={() => confirmDismissExtraction(suggestion.id)}
                    onReview={(field, correct) => {
                      reviewExtraction.mutate(
                        {
                          suggestionId: suggestion.id,
                          field,
                          correct,
                        },
                        {
                          onSuccess: () => {
                            if (correct) return;
                            if (field === "classification") {
                              if (suggestion.classification === "product") {
                                confirmDismissExtraction(suggestion.id);
                                return;
                              }
                              const linkedProduct =
                                suggestion.status === "draft_created"
                                  ? (catalog.data?.find(
                                      (item) =>
                                        item.id === suggestion.productId,
                                    ) ?? null)
                                  : null;
                              if (
                                suggestion.status === "draft_created" &&
                                !linkedProduct
                              ) {
                                setError(
                                  "تعذر العثور على المسودة المرتبطة. حدّث قائمة المنتجات ثم أعد المحاولة.",
                                );
                                return;
                              }
                              openExtractionEditor(
                                suggestion,
                                linkedProduct,
                                false,
                              );
                            } else if (
                              field !== "grouping" &&
                              suggestion.classification === "product"
                            ) {
                              openExtractionEditor(
                                suggestion,
                                suggestion.status === "draft_created"
                                  ? (catalog.data?.find(
                                      (item) =>
                                        item.id === suggestion.productId,
                                    ) ?? null)
                                  : null,
                                true,
                              );
                            }
                          },
                        },
                      );
                    }}
                    onEditProduct={(product) =>
                      openEditor({
                        id: product.id,
                        value: draftFromProduct(product),
                        mediaPreviews: product.mediaPreviews,
                      })
                    }
                  />
                ))}
              </>
            ) : (
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                لا توجد اقتراحات بعد. تظهر هنا نتائج المعالجة التلقائية للرسائل
                المستوردة.
              </Text>
            )}
          </View>
        ) : null}

        {activeTab !== "extractions" ? (
          <View style={styles.section}>
            <Panel style={styles.catalogToolbar}>
              <View style={styles.sectionHeading}>
                <View style={styles.productSectionTitle}>
                  <Text
                    style={[styles.sectionTitle, { color: colors.foreground }]}
                  >
                    المنتجات
                  </Text>
                  {catalog.data ? (
                    <View
                      style={[
                        styles.productCount,
                        { backgroundColor: colors.accent },
                      ]}
                    >
                      <Text
                        style={[
                          styles.productCountText,
                          { color: colors.primary },
                        ]}
                      >
                        {formatArabicNumber(visibleProducts.length)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.selectionActions}>
                  {selectedProducts.length ? (
                    <Text
                      style={[styles.helper, { color: colors.mutedForeground }]}
                    >
                      المحدد: {formatArabicNumber(selectedProducts.length)}
                    </Text>
                  ) : null}
                  {selectedProductIds.size ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="إلغاء تحديد المنتجات"
                      onPress={() => {
                        setSelectedProductIds(new Set());
                        setError("");
                      }}
                    >
                      <Text style={[styles.link, { color: colors.primary }]}>
                        إلغاء التحديد
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel="تحديد جميع المنتجات المعتمدة المعروضة"
                    accessibilityState={{
                      checked: selectedAllVisible,
                      disabled: selectableVisibleProducts.length === 0,
                    }}
                    disabled={selectableVisibleProducts.length === 0}
                    onPress={toggleAllVisibleProducts}
                    style={({ pressed }) => [
                      styles.selectAll,
                      {
                        opacity:
                          selectableVisibleProducts.length === 0
                            ? 0.45
                            : pressed
                              ? 0.7
                              : 1,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.checkbox,
                        {
                          borderColor: selectedAllVisible
                            ? colors.primary
                            : colors.border,
                          backgroundColor: selectedAllVisible
                            ? colors.primary
                            : "transparent",
                        },
                      ]}
                    >
                      {selectedAllVisible ? (
                        <Icon
                          name="check"
                          size={13}
                          color={colors.primaryForeground}
                        />
                      ) : null}
                    </View>
                    <Text style={[styles.link, { color: colors.primary }]}>
                      تحديد الكل
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View
                style={[
                  styles.productSearchRow,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Icon name="search" size={18} color={colors.mutedForeground} />
                <CairoTextInput
                  accessibilityLabel="البحث في المنتجات"
                  value={productSearch}
                  onChangeText={setProductSearch}
                  placeholder="ابحث بالاسم أو رقم المنتج"
                  placeholderTextColor={colors.mutedForeground}
                  style={[
                    styles.productSearchInput,
                    { color: colors.foreground },
                  ]}
                  returnKeyType="search"
                />
                {productSearch ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="مسح البحث"
                    onPress={() => setProductSearch("")}
                    hitSlop={8}
                  >
                    <Icon name="x" size={17} color={colors.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
              {selectableVisibleProducts.length > 0 &&
              selectedProducts.length === 0 ? (
                <Text
                  style={[
                    styles.selectionHint,
                    { color: colors.mutedForeground },
                  ]}
                >
                  حدد مربع الاختيار بجانب منتج معتمد لمراجعة النشر.
                </Text>
              ) : null}
            </Panel>
            {catalog.isError ? (
              <Panel
                style={[styles.catalogError, { borderColor: colors.border }]}
              >
                <View
                  style={[
                    styles.catalogErrorIcon,
                    { backgroundColor: colors.secondary },
                  ]}
                >
                  <Icon
                    name="alert-circle"
                    size={22}
                    color={colors.destructive}
                  />
                </View>
                <Text
                  accessibilityRole="alert"
                  style={[
                    styles.catalogErrorTitle,
                    { color: colors.foreground },
                  ]}
                >
                  تعذر تحميل المنتجات
                </Text>
                <Text
                  style={[
                    styles.catalogErrorBody,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {catalogLoadErrorMessage(catalog.error)}
                </Text>
                <ActionButton
                  label={
                    catalog.isFetching ? "جارٍ التحقق..." : "إعادة المحاولة"
                  }
                  icon={catalog.isFetching ? "clock" : "refresh-cw"}
                  disabled={catalog.isFetching}
                  onPress={() => void catalog.refetch()}
                />
              </Panel>
            ) : catalog.isPending ? (
              <EmptyState
                icon="clock"
                title="جارٍ تجهيز كتالوجك"
                body="نحمّل بيانات المنتجات المعتمدة."
              />
            ) : visibleProducts.length ? (
              visibleProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  selected={selectedProducts.some(
                    (selectedProduct) => selectedProduct.id === product.id,
                  )}
                  selectionDisabledReason={productPublicationDisabledReason(
                    product,
                  )}
                  onToggleSelection={() => toggleProductSelection(product.id)}
                  onEdit={() =>
                    openEditor({
                      id: product.id,
                      value: draftFromProduct(product),
                      mediaPreviews: product.mediaPreviews,
                    })
                  }
                />
              ))
            ) : productSearch.trim() ? (
              <EmptyState
                icon="search"
                title="لا توجد نتائج مطابقة"
                body="جرّب اسمًا أو رقم منتج مختلفًا."
              />
            ) : (
              <EmptyState
                icon="file-text"
                title="لا توجد منتجات بعد"
                body="أضف منتجًا موثوقًا أو ابدأ من أحد منشوراتك المنشورة كمسودة."
              />
            )}
          </View>
        ) : null}

        {activeTab !== "extractions" && publicationRequestKey ? (
          <ProductPublicationStatus
            snapshot={publication.data ?? null}
            loading={publication.isPending || publication.isRefetching}
            error={
              publication.isError
                ? publication.error instanceof Error
                  ? publication.error.message
                  : "تعذر تحميل حالة النشر."
                : null
            }
            pending={retryPublication.isPending}
            onRetry={(jobIds) => retryPublication.mutate(jobIds)}
            productNames={
              new Map(allProducts.map((product) => [product.id, product.name]))
            }
          />
        ) : null}

        {activeTab === "extractions" ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              منشورات سابقة — استخراج بيانات المنتجات
            </Text>
            {candidates.isError ? (
              <Text style={{ color: colors.destructive, textAlign: "left" }}>
                {candidates.error instanceof Error
                  ? candidates.error.message
                  : "تعذر تحميل المنشورات المرشحة."}
              </Text>
            ) : candidates.isPending ? (
              <Text
                style={{ color: colors.mutedForeground, textAlign: "left" }}
              >
                جارٍ تحميل المنشورات...
              </Text>
            ) : candidates.data?.length ? (
              candidates.data.slice(0, 20).map((post) => (
                <Panel key={post.id} style={styles.candidate}>
                  <Text
                    style={[styles.productName, { color: colors.foreground }]}
                  >
                    {post.title || "منشور بدون عنوان"}
                  </Text>
                  {post.body ? (
                    <Text
                      numberOfLines={3}
                      style={[
                        styles.description,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {post.body}
                    </Text>
                  ) : null}
                  {post.mediaPreviews.length ? (
                    <View
                      accessibilityLabel={`وسائط المنشور، ${post.mediaPreviews.length} عنصر`}
                      style={styles.productMediaList}
                    >
                      {post.mediaPreviews.slice(0, 4).map((media) =>
                        media.mediaType === "image" ? (
                          <ProductMediaThumbnail
                            key={media.id}
                            uri={media.url}
                            label="معاينة وسيط المنشور"
                          />
                        ) : (
                          <View
                            key={media.id}
                            style={[
                              styles.productMediaThumbnail,
                              styles.productVideoPlaceholder,
                              { backgroundColor: colors.accent },
                            ]}
                          >
                            <Icon
                              name="play"
                              size={22}
                              color={colors.primary}
                            />
                          </View>
                        ),
                      )}
                    </View>
                  ) : null}
                  <ActionButton
                    label={
                      importPost.isPending && importPost.variables === post.id
                        ? "جارٍ إنشاء المسودة..."
                        : "استخراج بيانات المنتج واستيراده"
                    }
                    icon="file-plus"
                    disabled={importPost.isPending}
                    onPress={() => importPost.mutate(post.id)}
                  />
                </Panel>
              ))
            ) : (
              <Text
                style={{ color: colors.mutedForeground, textAlign: "left" }}
              >
                لا توجد منشورات منشورة غير مرتبطة بمنتج.
              </Text>
            )}
          </View>
        ) : null}
      </Page>
      {selectedProducts.length > 0 ? (
        <Panel
          style={[
            styles.publishBar,
            {
              start: 12,
              end: 12,
              bottom: insets.bottom + (Platform.OS === "web" ? 96 : 72),
            },
          ]}
        >
          <View style={styles.publishBarCopy}>
            <Text
              style={[styles.publishBarCount, { color: colors.foreground }]}
            >
              {formatArabicNumber(selectedProducts.length)} منتجات محددة
            </Text>
            <Text
              style={[styles.publishBarHint, { color: colors.mutedForeground }]}
            >
              راجع الحسابات والمحتوى قبل الجدولة
            </Text>
          </View>
          <ActionButton
            label="مراجعة النشر"
            icon="send"
            onPress={() => {
              setSelectedTargetKeys(new Set());
              setPendingRequestKey(randomUUID());
              setPublishModalVisible(true);
            }}
          />
        </Panel>
      ) : null}
      <Modal
        visible={editor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          requestEditorClose();
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {editor?.id
                  ? "تعديل المنتج"
                  : editor?.extractionSuggestionId
                    ? "تصحيح الاقتراح وإنشاء مسودة"
                    : "إضافة منتج"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق نموذج المنتج"
                disabled={save.isPending || mediaUploading}
                onPress={requestEditorClose}
              >
                <Icon name="x" size={21} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
            >
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.helper, { color: colors.destructive }]}
                >
                  {error}
                </Text>
              ) : null}
              {editor?.importedFromPost ? (
                <Text style={[styles.helper, { color: colors.warning }]}>
                  استخرجنا البيانات المتاحة من المنشور. أكمل الحقول الناقصة
                  وراجعها قبل اعتماد المنتج للرد الآلي.
                </Text>
              ) : null}
              {editor?.sourceContext?.length ? (
                <View style={styles.sourceMessage}>
                  <Text
                    style={[styles.fieldLabel, { color: colors.foreground }]}
                  >
                    الرسائل المصدر للمراجعة
                  </Text>
                  {editor.sourceContext.map((sourceText, index) => (
                    <Text
                      key={`${index}:${sourceText}`}
                      style={[styles.helper, { color: colors.mutedForeground }]}
                    >
                      {sourceText || "لا يوجد نص في الرسالة المصدر."}
                    </Text>
                  ))}
                </View>
              ) : null}
              <View style={styles.productMediaSection}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
                  إضافة وسائط
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="اختيار صور أو فيديوهات للمنتج"
                  disabled={save.isPending || mediaUploading}
                  onPress={() => void addProductMedia()}
                  style={[
                    styles.addMediaButton,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Icon
                    name={mediaUploading ? "refresh-cw" : "plus"}
                    size={17}
                    color={colors.primary}
                  />
                  <Text style={{ color: colors.primary, fontWeight: "700" }}>
                    {mediaUploading
                      ? "جارٍ رفع الوسائط..."
                      : "اختيار من الجهاز"}
                  </Text>
                </Pressable>
                {editor?.mediaPreviews.length ? (
                  <View style={styles.productMediaList}>
                    {editor.mediaPreviews.map((media) => (
                      <View key={media.id} style={styles.productMediaItem}>
                        {media.mediaType === "image" ? (
                          <ProductMediaThumbnail
                            uri={media.url}
                            label="معاينة وسيط المنتج"
                          />
                        ) : (
                          <View
                            style={[
                              styles.productMediaThumbnail,
                              styles.productVideoPlaceholder,
                              { backgroundColor: colors.accent },
                            ]}
                          >
                            <Icon
                              name="play"
                              size={22}
                              color={colors.primary}
                            />
                          </View>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="إزالة وسيط المنتج"
                          disabled={save.isPending || mediaUploading}
                          onPress={() => removeProductMedia(media.id)}
                          style={[
                            styles.removeProductMedia,
                            { backgroundColor: colors.destructive },
                          ]}
                        >
                          <Icon name="x" size={14} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Text
                  style={[styles.helper, { color: colors.mutedForeground }]}
                >
                  يمكنك إضافة صور أو فيديوهات، بحد أقصى 20 وسيطًا.
                </Text>
              </View>
              <Field
                label="اسم المنتج"
                value={editor?.value.name ?? ""}
                onChangeText={(name) => updateDraft({ name })}
                required
              />
              {!editor?.value.name.trim() ? (
                <Text
                  style={[styles.helper, { color: colors.mutedForeground }]}
                >
                  أدخل اسم المنتج قبل الحفظ. لم يُستخدم عنوان المنشور أو نصه
                  كاسم للمنتج.
                </Text>
              ) : null}
              <Field
                label="رقم المنتج / SKU"
                value={editor?.value.sku ?? ""}
                onChangeText={(sku) => updateDraft({ sku: sku || null })}
                writingDirection="ltr"
              />
              <Field
                label="أسماء بديلة (افصل بينها بفاصلة)"
                value={editor?.value.aliases.join(", ") ?? ""}
                onChangeText={(value) =>
                  updateDraft({
                    aliases: value
                      .split(",")
                      .map((alias) => alias.trim())
                      .filter(Boolean),
                  })
                }
              />
              <Field
                label="وصف مؤكد"
                value={editor?.value.description ?? ""}
                onChangeText={(description) => updateDraft({ description })}
                multiline
              />
              <View style={styles.inlineFields}>
                <View style={styles.inlineField}>
                  <Field
                    label="السعر (اختياري)"
                    value={editor?.value.price ?? ""}
                    onChangeText={(price) => {
                      const normalizedPrice = normalizeArabicDigits(price)
                        .replace(/٬/g, "")
                        .trim();
                      updateDraft({ price: normalizedPrice || null });
                    }}
                    keyboardType="decimal-pad"
                    writingDirection="ltr"
                  />
                </View>
                <View style={styles.inlineField}>
                  <DropdownField
                    label="العملة"
                    options={[
                      { value: "YER", label: "ريال يمني" },
                      { value: "SAR", label: "ريال سعودي" },
                      { value: "USD", label: "دولار أمريكي" },
                    ]}
                    value={editor?.value.currency ?? ""}
                    onSelect={(currency) => updateDraft({ currency })}
                  />
                </View>
              </View>
              {editor?.value.inventoryTracked ? (
                <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                  حالة التوفر تُحدّث تلقائيًا بحسب الكمية المتاحة.
                </Text>
              ) : (
                <ChoiceField
                  label="التوفر"
                  options={[
                    { value: "unknown", label: "غير محدد" },
                    { value: "in_stock", label: "متوفر" },
                    { value: "out_of_stock", label: "غير متوفر" },
                    { value: "preorder", label: "طلب مسبق" },
                  ]}
                  value={editor?.value.availability ?? "unknown"}
                  onSelect={(availability) =>
                    updateDraft({
                      availability:
                        availability as ProductDraft["availability"],
                    })
                  }
                />
              )}
              <ChoiceField
                label="إدارة المخزون"
                options={[
                  { value: "false", label: "بدون تتبع" },
                  { value: "true", label: "تتبع الكمية" },
                ]}
                value={String(editor?.value.inventoryTracked ?? false)}
                onSelect={(value) =>
                  updateDraft({ inventoryTracked: value === "true" })
                }
              />
              {editor?.value.inventoryTracked ? (
                <Field
                  label="الكمية الفعلية في المخزون"
                  value={String(editor.value.stockOnHand ?? 0)}
                  onChangeText={(value) => {
                    const digits = normalizeArabicDigits(value).replace(
                      /\D/g,
                      "",
                    );
                    const stockOnHand = Number(digits || 0);
                    if (stockOnHand <= 2_000_000_000) {
                      updateDraft({ stockOnHand });
                    }
                  }}
                  keyboardType="number-pad"
                  writingDirection="ltr"
                />
              ) : null}
              {editor?.value.inventoryTracked ? (
                <Field
                  label="حد التنبيه عند انخفاض المخزون (0 لتعطيله)"
                  value={String(editor.value.lowStockThreshold ?? 0)}
                  onChangeText={(value) => {
                    const digits = normalizeArabicDigits(value).replace(
                      /\D/g,
                      "",
                    );
                    const lowStockThreshold = Number(digits || 0);
                    if (lowStockThreshold <= 2_000_000_000) {
                      updateDraft({ lowStockThreshold });
                    }
                  }}
                  keyboardType="number-pad"
                  writingDirection="ltr"
                />
              ) : null}
              {editor?.value.inventoryTracked ? (
                <Field
                  label="سبب تعديل المخزون (اختياري)"
                  value={editor.value.inventoryReason ?? ""}
                  onChangeText={(inventoryReason) =>
                    updateDraft({ inventoryReason })
                  }
                />
              ) : null}
              {editor?.id && editor.value.inventoryTracked ? (
                <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                  المحجوز للطلبات: {formatArabicNumber(
                    catalog.data?.find((product) => product.id === editor.id)
                      ?.stockReserved ?? 0,
                  )} · المتاح: {formatArabicNumber(
                    Math.max(
                      0,
                      (editor.value.stockOnHand ?? 0) -
                        (catalog.data?.find((product) => product.id === editor.id)
                          ?.stockReserved ?? 0),
                    ),
                  )}
                </Text>
              ) : null}
              {editor?.id && editor.value.inventoryTracked ? (
                <View style={styles.inventoryHistory}>
                  <Text
                    style={[styles.fieldLabel, { color: colors.foreground }]}
                  >
                    آخر حركات المخزون
                  </Text>
                  {inventoryMovements.isPending ? (
                    <Text
                      style={[styles.helper, { color: colors.mutedForeground }]}
                    >
                      جارٍ تحميل سجل المخزون...
                    </Text>
                  ) : inventoryMovements.isError ? (
                    <View style={styles.inventoryHistory}>
                      <Text
                        style={[
                          styles.helper,
                          { color: colors.destructive },
                        ]}
                      >
                        {inventoryMovements.error instanceof Error
                          ? inventoryMovements.error.message
                          : "تعذّر تحميل سجل حركات المخزون."}
                      </Text>
                      <ActionButton
                        label="إعادة تحميل سجل المخزون"
                        icon="refresh-cw"
                        secondary
                        onPress={() => void inventoryMovements.refetch()}
                      />
                    </View>
                  ) : inventoryMovements.data?.length ? (
                    inventoryMovements.data.slice(0, 5).map((movement) => (
                      <Text
                        key={movement.id}
                        style={[
                          styles.helper,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {movement.reason} ·{" "}
                        {movement.stockDelta > 0 ? "+" : ""}
                        {formatArabicNumber(movement.stockDelta)} ·{" "}
                        {formatArabicDateTime(movement.createdAt) ?? ""}
                      </Text>
                    ))
                  ) : (
                    <Text
                      style={[styles.helper, { color: colors.mutedForeground }]}
                    >
                      لا توجد حركات مسجلة بعد.
                    </Text>
                  )}
                </View>
              ) : null}
              {!editor?.extractionSuggestionId ? (
                <ChoiceField
                  label="حالة السجل"
                  options={[
                    { value: "draft", label: "مسودة" },
                    { value: "active", label: "معتمد للرد الآلي" },
                    { value: "archived", label: "مؤرشف" },
                  ]}
                  value={editor?.value.status ?? "draft"}
                  onSelect={(status) =>
                    updateDraft({ status: status as ProductDraft["status"] })
                  }
                />
              ) : (
                <Text style={[styles.helper, { color: colors.warning }]}>
                  ستُحفظ المسودة دون اعتمادها أو إتاحتها للرد الآلي. راجع
                  البيانات ثم فعّلها من صفحة المنتج عند التأكد منها.
                </Text>
              )}
              {editor?.value.status === "active" ? (
                <Text style={[styles.helper, { color: colors.warning }]}>
                  تفعيل المنتج يسمح للرد الآلي باستخدام بياناته. تأكد من صحة
                  السعر والتوفر والوصف قبل الحفظ.
                </Text>
              ) : null}
            </ScrollView>
            <View style={styles.footer}>
              <ActionButton
                label={
                  mediaUploading
                    ? "جارٍ رفع الوسائط..."
                    : save.isPending
                      ? "جارٍ الحفظ..."
                      : editor?.extractionSuggestionId
                        ? "حفظ المسودة"
                        : "حفظ المنتج"
                }
                icon={save.isPending ? "refresh-cw" : "save"}
                disabled={
                  save.isPending || mediaUploading || !editor?.value.name.trim()
                }
                onPress={() => void saveProduct()}
              />
              <ActionButton
                label="إلغاء"
                icon="x"
                secondary
                disabled={save.isPending || mediaUploading}
                onPress={requestEditorClose}
              />
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={publishModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!publishProducts.isPending) setPublishModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.dialog,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                مراجعة وجدولة النشر
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق مراجعة النشر"
                onPress={() => {
                  if (!publishProducts.isPending) setPublishModalVisible(false);
                }}
              >
                <Icon name="x" size={20} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.form}>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                ستنشأ عملية مستقلة لكل منتج وحساب. المنتجات المحددة:{" "}
                {selectedProducts.length} · إجمالي العمليات:{" "}
                {selectedProducts.length * selectedTargets.length}.
              </Text>
              <View
                style={[
                  styles.publicationReview,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  },
                ]}
              >
                <Text
                  style={[styles.accountName, { color: colors.foreground }]}
                >
                  معاينة المنتجات
                </Text>
                {selectedProducts.map((product) => (
                  <View
                    key={product.id}
                    style={[
                      styles.reviewProduct,
                      { borderTopColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[styles.accountName, { color: colors.foreground }]}
                    >
                      {product.name}
                    </Text>
                    <Text
                      style={[styles.helper, { color: colors.mutedForeground }]}
                    >
                      معاينة نص المنشور{"\n"}
                      {productPublicationPreview(product)}
                    </Text>
                    {product.mediaPreviews.length ? (
                      <View style={styles.productMediaList}>
                        {product.mediaPreviews.slice(0, 4).map((media) =>
                          media.mediaType === "image" ? (
                            <ProductMediaThumbnail
                              key={media.id}
                              uri={media.url}
                              label={`معاينة صورة ${product.name}`}
                            />
                          ) : (
                            <View
                              key={media.id}
                              style={[
                                styles.productMediaThumbnail,
                                styles.productVideoPlaceholder,
                                { backgroundColor: colors.accent },
                              ]}
                            >
                              <Icon
                                name="play"
                                size={22}
                                color={colors.primary}
                              />
                            </View>
                          ),
                        )}
                      </View>
                    ) : null}
                    {product.postIds.length ? (
                      <Text style={[styles.helper, { color: colors.warning }]}>
                        مرتبط بـ {product.postIds.length} منشور سابق.
                      </Text>
                    ) : null}
                    <ProductPublicationHistory
                      history={product.publicationHistory}
                      accounts={connectedAccounts}
                    />
                  </View>
                ))}
              </View>
              {publishableAccounts.isError ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.helper, { color: colors.destructive }]}
                >
                  {publishableAccounts.error instanceof Error
                    ? publishableAccounts.error.message
                    : "تعذر تحميل الحسابات المتصلة."}
                </Text>
              ) : null}
              {publishableAccounts.isPending ? (
                <Text
                  style={[styles.helper, { color: colors.mutedForeground }]}
                >
                  جارٍ تحميل الحسابات المتصلة...
                </Text>
              ) : connectedAccounts.length ? (
                connectedAccounts.map((account) => {
                  const key = `${account.channel}:${account.accountId}`;
                  const ready = account.authorizationStatus === "ready";
                  const checked = selectedTargetKeys.has(key);
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="checkbox"
                      accessibilityLabel={`${account.channel === "facebook" ? "فيسبوك" : "إنستغرام"}: ${account.accountName}`}
                      accessibilityState={{ checked, disabled: !ready }}
                      disabled={!ready || publishProducts.isPending}
                      onPress={() =>
                        setSelectedTargetKeys((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                      style={[
                        styles.accountOption,
                        {
                          borderColor: checked ? colors.primary : colors.border,
                          opacity: ready ? 1 : 0.6,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: checked
                              ? colors.primary
                              : colors.border,
                            backgroundColor: checked
                              ? colors.primary
                              : "transparent",
                          },
                        ]}
                      >
                        {checked ? (
                          <Icon
                            name="check"
                            size={13}
                            color={colors.primaryForeground}
                          />
                        ) : null}
                      </View>
                      <View style={styles.accountDetails}>
                        <Text
                          style={[
                            styles.accountName,
                            { color: colors.foreground },
                          ]}
                        >
                          {account.channel === "facebook"
                            ? "فيسبوك"
                            : "إنستغرام"}{" "}
                          · {account.accountName}
                        </Text>
                        <Text
                          style={[
                            styles.helper,
                            { color: ready ? colors.primary : colors.warning },
                          ]}
                        >
                          {ready
                            ? "متصل وجاهز للنشر"
                            : "يحتاج إلى إعادة التحقق من الاتصال أو الصلاحيات"}
                        </Text>
                      </View>
                      <Icon
                        name={
                          account.channel === "facebook"
                            ? "facebook"
                            : "instagram"
                        }
                        size={20}
                        color={colors.primary}
                      />
                    </Pressable>
                  );
                })
              ) : (
                <Text style={[styles.helper, { color: colors.warning }]}>
                  لا توجد حسابات Meta جاهزة. اربط Facebook أو Instagram أولًا.
                </Text>
              )}
              {instagramMediaMissing ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.helper, { color: colors.destructive }]}
                >
                  لا يمكن النشر على Instagram: أضف صورة أو فيديو لكل منتج محدد،
                  أو أزل Instagram من الحسابات المختارة.
                </Text>
              ) : null}
              {repeatedPublicationCount > 0 ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.helper, { color: colors.warning }]}
                >
                  سبق نشر {repeatedPublicationCount} من المنتجات المحددة على
                  الحساب نفسه. المتابعة ستنشئ منشورًا جديدًا ولن تعدّل المنشور
                  السابق.
                </Text>
              ) : null}
              <ActionButton
                label={
                  publishProducts.isPending
                    ? "جارٍ جدولة عمليات النشر..."
                    : repeatedPublicationCount > 0
                      ? `تأكيد إنشاء منشورات جديدة · ${selectedProducts.length} منتج`
                      : `جدولة ${selectedProducts.length} منتجًا على ${selectedTargets.length} حساب`
                }
                icon={publishProducts.isPending ? "refresh-cw" : "send"}
                disabled={
                  publishProducts.isPending ||
                  selectedTargets.length === 0 ||
                  selectedProducts.length === 0 ||
                  instagramMediaMissing
                }
                onPress={startProductPublication}
              />
              <ActionButton
                label="إلغاء"
                icon="x"
                secondary
                disabled={publishProducts.isPending}
                onPress={() => setPublishModalVisible(false)}
              />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ExtractionFieldReview({
  correct,
  disabled,
  correctLabel = "صحيح",
  incorrectLabel = "خاطئ أو ناقص",
  onSelect,
}: {
  correct: boolean | undefined;
  disabled: boolean;
  correctLabel?: string;
  incorrectLabel?: string;
  onSelect: (correct: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldReview}>
      {(
        [
          [true, correctLabel],
          [false, incorrectLabel],
        ] as const
      ).map(([value, label]) => {
        const selected = correct === value;
        return (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onSelect(value)}
            style={[
              styles.reviewChoice,
              {
                backgroundColor: selected ? colors.primary : colors.secondary,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: selected ? colors.primaryForeground : colors.foreground,
                fontSize: 11,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
      <Text style={[styles.evidence, { color: colors.mutedForeground }]}>
        {correct === undefined
          ? "لم يراجع"
          : correct
            ? "تم تأكيده"
            : "يحتاج تصحيحًا"}
      </Text>
    </View>
  );
}

function ProductExtractionCard({
  suggestion,
  product,
  actionPending,
  onCreateDraft,
  onDismiss,
  onReview,
  onEditProduct,
}: {
  suggestion: ProductExtractionSuggestion;
  product: CatalogProduct | null;
  actionPending: boolean;
  onCreateDraft: () => void;
  onDismiss: () => void;
  onReview: (field: string, correct: boolean) => void;
  onEditProduct: (product: CatalogProduct) => void;
}) {
  const colors = useColors();
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const fields: Array<[string, string, string | null]> = [
    ["الاسم", suggestion.extractedData.name ?? "غير مستخرج", "name"],
    [
      "الوصف",
      suggestion.extractedData.description ?? "غير مستخرج",
      "description",
    ],
    [
      "السعر",
      formatArabicCurrency(
        suggestion.extractedData.price,
        suggestion.extractedData.currency,
      ) ?? "غير مستخرج",
      "price",
    ],
    [
      "التوفر",
      suggestion.extractedData.availability ?? "غير مستخرج",
      "availability",
    ],
    ["رقم المنتج", suggestion.extractedData.sku ?? "غير مستخرج", "sku"],
  ];
  const statusLabel =
    suggestion.status === "draft_created"
      ? "أُنشئت مسودة"
      : suggestion.classification === "not_product"
        ? "لم يُصنف كمنتج — راجع الرسالة"
        : suggestion.status === "possible_duplicate"
          ? "مطابقة محتملة — تحتاج مراجعة"
          : "تحتاج مراجعة";
  return (
    <Panel style={styles.extractionCard}>
      <View style={styles.productHeading}>
        <Text style={[styles.productName, { color: colors.foreground }]}>
          {suggestion.classification === "not_product"
            ? "لم يستخرج منتجًا من الرسالة"
            : (suggestion.extractedData.name ?? "اقتراح بدون اسم واضح")}
        </Text>
        <Text
          style={[
            styles.badge,
            {
              color:
                suggestion.status === "possible_duplicate"
                  ? colors.destructive
                  : colors.primary,
              backgroundColor: colors.secondary,
            },
          ]}
        >
          {statusLabel}
        </Text>
      </View>
      {suggestion.classification === "product"
        ? fields.map(([label, value, key]) => (
            <View key={label} style={styles.extractionField}>
              <Text style={[styles.description, { color: colors.foreground }]}>
                {label}: {value}
                {key && suggestion.confidence[key] !== undefined
                  ? ` — ثقة النموذج ${Math.round(suggestion.confidence[key] * 100)}%`
                  : ""}
              </Text>
              {key && suggestion.evidence[key] ? (
                <Text
                  style={[styles.evidence, { color: colors.mutedForeground }]}
                >
                  الدليل: «{suggestion.evidence[key]}»
                </Text>
              ) : null}
              {key ? (
                <ExtractionFieldReview
                  correct={suggestion.fieldReview[key]}
                  disabled={actionPending}
                  onSelect={(correct) => onReview(key, correct)}
                />
              ) : null}
            </View>
          ))
        : null}
      {suggestion.classification === "product" &&
      suggestion.extractedData.aliases.length ? (
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          أسماء بديلة: {suggestion.extractedData.aliases.join("، ")}
        </Text>
      ) : null}
      {suggestion.sources.map((source) => {
        const expanded = expandedSourceIds.has(source.id);
        const canExpand = source.text.length > 240;
        return (
          <View key={source.id} style={styles.sourceMessage}>
            <Text style={[styles.evidence, { color: colors.mutedForeground }]}>
              {source.groupName ?? "مجموعة"}
              {source.senderName ? ` · ${source.senderName}` : ""}
            </Text>
            {source.mediaPreviews.length ? (
              <View
                accessibilityLabel={`وسائط الرسالة، ${source.mediaPreviews.length} عنصر`}
                style={styles.productMediaList}
              >
                {source.mediaPreviews.slice(0, 4).map((media) =>
                  media.mediaType === "image" ? (
                    <ProductMediaThumbnail
                      key={media.id}
                      uri={media.url}
                      label="معاينة وسيط الرسالة"
                    />
                  ) : (
                    <View
                      key={media.id}
                      style={[
                        styles.productMediaThumbnail,
                        styles.productVideoPlaceholder,
                        { backgroundColor: colors.accent },
                      ]}
                    >
                      <Icon name="play" size={22} color={colors.primary} />
                    </View>
                  ),
                )}
              </View>
            ) : null}
            <Text
              numberOfLines={expanded ? undefined : 5}
              style={[styles.description, { color: colors.foreground }]}
            >
              {source.text}
            </Text>
            {canExpand ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() =>
                  setExpandedSourceIds((current) => {
                    const next = new Set(current);
                    if (next.has(source.id)) next.delete(source.id);
                    else next.add(source.id);
                    return next;
                  })
                }
              >
                <Text
                  style={[
                    styles.sourceMessageToggle,
                    { color: colors.primary },
                  ]}
                >
                  {expanded ? "عرض أقل" : "عرض النص الكامل"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <Text style={[styles.evidence, { color: colors.mutedForeground }]}>
        نموذج التحليل: {suggestion.aiModel}
      </Text>
      {suggestion.status === "possible_duplicate" ? (
        <View style={styles.sourceMessage}>
          <Text style={[styles.description, { color: colors.warning }]}>
            تحقق من المنتجات المشابهة قبل إنشاء منتج آخر:
          </Text>
          {suggestion.possibleDuplicateProducts?.length ? (
            suggestion.possibleDuplicateProducts.map((duplicate) => (
              <View
                key={duplicate.id}
                style={[
                  styles.extractionField,
                  {
                    borderColor: colors.border,
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: 9,
                  },
                ]}
              >
                <Text
                  style={[styles.description, { color: colors.foreground }]}
                >
                  {duplicate.name}
                  {duplicate.sku ? ` · SKU: ${duplicate.sku}` : ""}
                  {` · ${
                    duplicate.status === "active"
                      ? "معتمد"
                      : duplicate.status === "archived"
                        ? "مؤرشف"
                        : "مسودة"
                  }`}
                </Text>
                {duplicate.description ? (
                  <Text
                    style={[styles.evidence, { color: colors.mutedForeground }]}
                  >
                    {duplicate.description}
                  </Text>
                ) : null}
                {duplicate.price !== null ? (
                  <Text
                    style={[styles.evidence, { color: colors.mutedForeground }]}
                  >
                    السعر:{" "}
                    {formatArabicCurrency(duplicate.price, duplicate.currency)}
                  </Text>
                ) : null}
                <Text
                  style={[styles.evidence, { color: colors.mutedForeground }]}
                >
                  التوفر:{" "}
                  {duplicate.availability === "in_stock"
                    ? "متوفر"
                    : duplicate.availability === "out_of_stock"
                      ? "غير متوفر"
                      : duplicate.availability === "preorder"
                        ? "طلب مسبق"
                        : "غير محدد"}
                </Text>
              </View>
            ))
          ) : (
            <Text style={[styles.evidence, { color: colors.mutedForeground }]}>
              لم تُحدد مطابقة بعينها؛ افحص قائمة المنتجات قبل المتابعة.
            </Text>
          )}
        </View>
      ) : null}
      <View style={styles.extractionField}>
        <Text style={[styles.description, { color: colors.foreground }]}>
          التصنيف:{" "}
          {suggestion.classification === "product" ? "منتج" : "ليس منتجًا"}
        </Text>
        <ExtractionFieldReview
          correct={suggestion.fieldReview.classification}
          disabled={actionPending}
          correctLabel={
            suggestion.classification === "product"
              ? "صحيح: منتج"
              : "صحيح: ليس منتجًا"
          }
          incorrectLabel={
            suggestion.classification === "product"
              ? "ليس منتجًا"
              : "فاتنا منتج"
          }
          onSelect={(correct) => onReview("classification", correct)}
        />
      </View>
      {suggestion.classification === "product" &&
      suggestion.sources.length > 1 ? (
        <View style={styles.extractionField}>
          <Text style={[styles.description, { color: colors.foreground }]}>
            هل جُمعت الرسائل للمنتج نفسه؟
          </Text>
          <ExtractionFieldReview
            correct={suggestion.fieldReview.grouping}
            disabled={actionPending}
            correctLabel="نعم"
            incorrectLabel="لا"
            onSelect={(correct) => onReview("grouping", correct)}
          />
        </View>
      ) : null}
      {product ? (
        <ActionButton
          label="مراجعة مسودة المنتج"
          icon="edit-3"
          onPress={() => onEditProduct(product)}
        />
      ) : suggestion.status === "draft_created" ? (
        <Text style={[styles.helper, { color: colors.primary }]}>
          أُنشئت مسودة المنتج؛ ستظهر ضمن قائمة المنتجات بعد تحديثها.
        </Text>
      ) : null}
      {suggestion.classification === "product" &&
      (suggestion.status === "review" ||
        suggestion.status === "possible_duplicate") ? (
        <ActionButton
          label={
            suggestion.status === "possible_duplicate"
              ? "إنشاء مسودة جديدة بعد المقارنة"
              : suggestion.extractedData.name?.trim()
                ? "إنشاء مسودة للمراجعة"
                : "إكمال بيانات المنتج يدويًا"
          }
          icon="file-plus"
          disabled={actionPending}
          onPress={onCreateDraft}
        />
      ) : null}
      {suggestion.status !== "draft_created" ? (
        <ActionButton
          label="استبعاد الاقتراح"
          icon="x"
          secondary
          disabled={actionPending}
          onPress={onDismiss}
        />
      ) : null}
    </Panel>
  );
}

function ProductCard({
  product,
  selected,
  selectionDisabledReason,
  onToggleSelection,
  onEdit,
}: {
  product: CatalogProduct;
  selected: boolean;
  selectionDisabledReason: string | null;
  onToggleSelection: () => void;
  onEdit: () => void;
}) {
  const colors = useColors();
  const statusLabel =
    product.status === "active"
      ? "معتمد"
      : product.status === "archived"
        ? "مؤرشف"
        : "مسودة";
  const availabilityLabel = {
    unknown: "التوفر غير محدد",
    in_stock: "متوفر",
    out_of_stock: "غير متوفر",
    preorder: "طلب مسبق",
  }[product.availability];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`تعديل المنتج ${product.name.trim() || "بدون اسم"}`}
      onPress={onEdit}
    >
      <Panel style={styles.productCard}>
        <View style={styles.productHeading}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={`تحديد المنتج ${product.name.trim() || "بدون اسم"}`}
            accessibilityHint={selectionDisabledReason ?? undefined}
            accessibilityState={{
              checked: selected,
              disabled: Boolean(selectionDisabledReason),
            }}
            disabled={Boolean(selectionDisabledReason)}
            onPress={(event) => {
              event.stopPropagation();
              onToggleSelection();
            }}
            style={[
              styles.checkbox,
              {
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : "transparent",
              },
            ]}
          >
            {selected ? (
              <Icon name="check" size={13} color={colors.primaryForeground} />
            ) : null}
          </Pressable>
          <Text style={[styles.productName, { color: colors.foreground }]}>
            {product.name.trim() || "اسم المنتج يحتاج إلى مراجعة"}
          </Text>
          <Text
            style={[
              styles.badge,
              {
                color:
                  product.status === "active" ? colors.primary : colors.warning,
                backgroundColor: colors.accent,
              },
            ]}
          >
            {statusLabel}
          </Text>
        </View>
        {product.sku ? (
          <Text
            style={[
              styles.description,
              { color: colors.mutedForeground, writingDirection: "ltr" },
            ]}
          >
            SKU: {product.sku}
          </Text>
        ) : null}
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          {availabilityLabel}
          {product.price !== null
            ? ` · ${formatArabicCurrency(product.price, product.currency)}`
            : " · لا يوجد سعر معتمد"}
        </Text>
        {product.inventoryTracked ? (
          <View style={styles.inventoryHistory}>
            <Text
              style={[styles.description, { color: colors.mutedForeground }]}
            >
              المخزون المتاح:{" "}
              {formatArabicNumber(
                Math.max(0, product.stockOnHand - product.stockReserved),
              )}{" "}
              · محجوز: {formatArabicNumber(product.stockReserved)}
            </Text>
            {product.lowStockThreshold > 0 &&
            product.stockOnHand - product.stockReserved <=
              product.lowStockThreshold ? (
              <Text
                style={[
                  styles.description,
                  { color: colors.warning, fontWeight: "700" },
                ]}
              >
                مخزون منخفض · حد التنبيه{" "}
                {formatArabicNumber(product.lowStockThreshold)}
              </Text>
            ) : null}
          </View>
        ) : null}
        {product.description ? (
          <Text
            numberOfLines={2}
            style={[styles.description, { color: colors.mutedForeground }]}
          >
            {product.description}
          </Text>
        ) : null}
        {product.mediaPreviews.length ? (
          <View
            accessibilityLabel={`وسائط المنتج، ${product.mediaPreviews.length} عنصر`}
            style={styles.productMediaList}
          >
            {product.mediaPreviews.slice(0, 4).map((media) =>
              media.mediaType === "image" ? (
                <ProductMediaThumbnail
                  key={media.id}
                  uri={media.url}
                  label="معاينة وسيط المنتج"
                />
              ) : (
                <View
                  key={media.id}
                  style={[
                    styles.productMediaThumbnail,
                    styles.productVideoPlaceholder,
                    { backgroundColor: colors.accent },
                  ]}
                >
                  <Icon name="play" size={22} color={colors.primary} />
                </View>
              ),
            )}
          </View>
        ) : null}
        {product.postIds.length ? (
          <Text style={[styles.description, { color: colors.mutedForeground }]}>
            مرتبط بـ {product.postIds.length} منشور سابق
          </Text>
        ) : null}
        <ProductPublicationHistory history={product.publicationHistory} />
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          {product.verifiedAt
            ? `آخر تحقق: ${formatArabicDate(product.verifiedAt) ?? "غير محدد"}`
            : "لم يتم التحقق من البيانات بعد"}
        </Text>
        {selectionDisabledReason ? (
          <Text style={[styles.description, { color: colors.warning }]}>
            {selectionDisabledReason}
          </Text>
        ) : null}
      </Panel>
    </Pressable>
  );
}

function ProductPublicationHistory({
  history,
  accounts = [],
}: {
  history: CatalogProduct["publicationHistory"];
  accounts?: PublishableAccount[];
}) {
  const colors = useColors();
  if (!history?.length) return null;

  return (
    <View style={styles.inventoryHistory}>
      <Text style={[styles.description, { color: colors.warning }]}>
        سجل النشر السابق · إعادة النشر تنشئ منشورًا جديدًا
      </Text>
      {history.slice(0, 4).map((publication, index) => {
        const accountName = accounts.find(
          (account) =>
            account.channel === publication.channel &&
            account.accountId === publication.accountId,
        )?.accountName;
        return (
          <View
            key={`${publication.channel}:${publication.accountId}:${publication.createdAt}:${index}`}
            style={styles.productPublicationHistoryRow}
          >
            <Text
              style={[styles.description, { color: colors.mutedForeground }]}
            >
              {publication.channel === "facebook" ? "فيسبوك" : "إنستغرام"}
              {accountName ? ` · ${accountName}` : ""} ·{" "}
              {formatArabicDateTime(
                publication.completedAt ?? publication.createdAt,
              ) ?? "وقت غير محدد"}
            </Text>
            {publication.permalink ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`فتح منشور ${publication.channel === "facebook" ? "فيسبوك" : "إنستغرام"} السابق`}
                onPress={(event) => {
                  event.stopPropagation();
                  const permalink = publication.permalink;
                  if (!permalink) return;
                  void Linking.openURL(permalink).catch(() =>
                    Alert.alert("تعذر فتح المنشور", "تحقق من اتصال الإنترنت."),
                  );
                }}
              >
                <Text style={[styles.description, { color: colors.primary }]}>
                  فتح المنشور السابق
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function ProductPublicationStatus({
  snapshot,
  loading,
  error,
  pending,
  onRetry,
  productNames,
}: {
  snapshot: ProductPublicationSnapshot | null;
  loading: boolean;
  error: string | null;
  pending: boolean;
  onRetry: (jobIds: string[]) => void;
  productNames: Map<string, string>;
}) {
  const colors = useColors();
  if (!snapshot && !loading && !error) return null;
  const statusLabels: Record<
    ProductPublicationSnapshot["jobs"][number]["status"],
    string
  > = {
    queued: "في انتظار النشر",
    processing: "جارٍ تجهيز المحتوى أو النشر",
    published: "تم النشر بنجاح",
    failed: "فشل النشر",
    action_required: "يحتاج إلى إجراء",
  };
  const failedJobs =
    snapshot?.jobs.filter((job) => job.status === "failed") ?? [];
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        حالة عمليات النشر
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {error}
        </Text>
      ) : loading && !snapshot ? (
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          جارٍ تحميل حالة النشر...
        </Text>
      ) : null}
      {snapshot ? (
        <Panel style={styles.publicationPanel}>
          <Text style={[styles.helper, { color: colors.foreground }]}>
            الإجمالي {snapshot.summary.total} · نجح{" "}
            {snapshot.summary.successful} · فشل {snapshot.summary.failed} · قيد
            التنفيذ {snapshot.summary.inProgress} · يحتاج إجراء{" "}
            {snapshot.summary.needsAction}
          </Text>
          {snapshot.jobs.map((job) => (
            <View key={job.id} style={styles.publicationJob}>
              <View style={styles.jobHeading}>
                <Text
                  style={[styles.accountName, { color: colors.foreground }]}
                >
                  {productNames.get(job.productId) ?? "منتج"} ·{" "}
                  {job.channel === "facebook" ? "Facebook" : "Instagram"}
                </Text>
                <Text
                  style={[
                    styles.helper,
                    {
                      color:
                        job.status === "published"
                          ? colors.primary
                          : job.status === "failed" ||
                              job.status === "action_required"
                            ? colors.destructive
                            : colors.warning,
                    },
                  ]}
                >
                  {statusLabels[job.status]}
                </Text>
              </View>
              {job.permalink ? (
                <Text
                  selectable
                  style={[styles.helper, { color: colors.primary }]}
                >
                  {job.permalink}
                </Text>
              ) : null}
              {job.error ? (
                <Text
                  selectable
                  style={[styles.helper, { color: colors.destructive }]}
                >
                  {job.error}
                </Text>
              ) : null}
            </View>
          ))}
          {failedJobs.length ? (
            <ActionButton
              label={
                pending
                  ? "جارٍ إعادة المحاولة..."
                  : `إعادة محاولة ${failedJobs.length} عملية فاشلة`
              }
              icon="refresh-cw"
              disabled={pending}
              onPress={() => onRetry(failedJobs.map((job) => job.id))}
            />
          ) : null}
        </Panel>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  required = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  writingDirection = "rtl",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  required?: boolean;
  keyboardType?: "default" | "decimal-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  writingDirection?: "ltr" | "rtl";
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
        {required ? " *" : ""}
      </Text>
      <CairoTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={multiline ? 3000 : 200}
        textAlign={writingDirection === "rtl" ? "right" : "left"}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: colors.foreground,
            backgroundColor: colors.background,
            borderColor: colors.border,
            writingDirection,
          },
        ]}
      />
    </View>
  );
}

function ChoiceField({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onSelect: (value: string) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <View style={styles.choices}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: option.value === value }}
            onPress={() => onSelect(option.value)}
            style={[
              styles.choice,
              {
                backgroundColor:
                  option.value === value ? colors.primary : colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Text
              style={{
                color:
                  option.value === value
                    ? colors.primaryForeground
                    : colors.foreground,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function DropdownField({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onSelect: (value: string) => void;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? "اختر العملة";

  return (
    <View style={[styles.field, open && styles.dropdownFieldOpen]}>
      <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={[
          styles.dropdownButton,
          {
            backgroundColor: colors.background,
            borderColor: colors.border,
          },
        ]}
      >
        <Icon
          name="chevron-left"
          size={17}
          color={colors.mutedForeground}
          style={{ transform: [{ rotate: open ? "90deg" : "-90deg" }] }}
        />
        <Text style={{ color: colors.foreground }}>{selectedLabel}</Text>
      </Pressable>
      {open ? (
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.dropdownOptions,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === value }}
              onPress={() => {
                onSelect(option.value);
                setOpen(false);
              }}
              style={[
                styles.dropdownOption,
                option.value === value && {
                  backgroundColor: colors.accent,
                },
              ]}
            >
              <Text style={{ color: colors.foreground }}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  catalogIntro: { gap: 12, padding: 18 },
  catalogEyebrow: {
    alignSelf: "flex-start",
    minHeight: 28,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    paddingHorizontal: 9,
  },
  catalogEyebrowText: { fontSize: 11, fontWeight: "700" },
  addButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  section: { gap: 10 },
  scanPanel: { gap: 10 },
  scanOptions: { gap: 8 },
  scanAccountOption: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  scanAccountCopy: { flex: 1, gap: 3 },
  scanRadio: {
    width: 20,
    height: 20,
    borderWidth: 1.5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  scanEmpty: { gap: 10 },
  scanLabel: { fontSize: 13, fontWeight: "800", textAlign: "right" },
  scanOperations: { gap: 8 },
  scanOperation: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  scannedPost: { gap: 9 },
  scannedPostHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  scanPostLink: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  catalogTabsFrame: { borderRadius: 16, padding: 4 },
  catalogTabsScroll: { flexGrow: 0 },
  catalogTabsContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 42,
  },
  catalogTab: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
    flexShrink: 0,
  },
  catalogTabCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  productSearchRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  productSearchInput: {
    flex: 1,
    minHeight: 46,
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  productSectionTitle: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
  },
  productCount: {
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingHorizontal: 6,
  },
  productCountText: { fontSize: 11, fontWeight: "700" },
  catalogToolbar: { gap: 12, padding: 14 },
  catalogError: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 22,
  },
  catalogErrorIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  catalogErrorTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  catalogErrorBody: {
    maxWidth: 420,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  link: { fontSize: 12, fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "700", textAlign: "right" },
  selectionActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 10,
  },
  selectionHint: { fontSize: 12, lineHeight: 18, textAlign: "right" },
  selectAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  publishBar: {
    position: "absolute",
    minHeight: 76,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 12,
    elevation: 8,
    zIndex: 50,
  },
  publishBarCopy: { flex: 1, gap: 4, alignItems: "flex-start" },
  publishBarCount: { fontSize: 13, fontWeight: "800", textAlign: "right" },
  publishBarHint: { fontSize: 11, lineHeight: 16, textAlign: "right" },
  productCard: { gap: 7 },
  publicationPanel: { gap: 10 },
  publicationJob: {
    gap: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#B7BEC8",
    paddingTop: 8,
  },
  jobHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  accountOption: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  publicationReview: {
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  reviewProduct: {
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  accountDetails: { flex: 1, gap: 3 },
  accountName: { fontSize: 13, fontWeight: "700", textAlign: "right" },
  productMediaSection: { gap: 8 },
  addMediaButton: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  productMediaList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  productMediaItem: { position: "relative" },
  productMediaThumbnail: {
    width: 76,
    height: 76,
    borderRadius: 10,
    backgroundColor: "#E8EDF2",
  },
  productVideoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  removeProductMedia: {
    position: "absolute",
    top: 4,
    start: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  productHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  productName: { flex: 1, fontSize: 15, fontWeight: "700", textAlign: "right" },
  badge: {
    overflow: "hidden",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
  },
  description: { fontSize: 12, lineHeight: 19, textAlign: "left" },
  candidate: { gap: 9 },
  extractionCard: { gap: 9 },
  fieldReview: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  reviewChoice: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  extractionField: { gap: 2 },
  evidence: { fontSize: 11, lineHeight: 18, textAlign: "left" },
  sourceMessage: {
    gap: 3,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#B7BEC8",
    paddingTop: 6,
  },
  sourceMessageToggle: {
    alignSelf: "flex-start",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
  },
  errorPanel: { borderWidth: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
    backgroundColor: "rgba(10, 37, 64, 0.55)",
  },
  dialog: {
    width: "100%",
    maxWidth: 620,
    maxHeight: "94%",
    borderWidth: 1,
    borderRadius: 18,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
  },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  form: { gap: 14, paddingHorizontal: 16, paddingBottom: 16 },
  field: { gap: 6 },
  inventoryHistory: { gap: 4, paddingTop: 6 },
  productPublicationHistoryRow: { gap: 2 },
  fieldLabel: { fontSize: 13, fontWeight: "600", textAlign: "right" },
  input: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  dropdownButton: {
    cursor: "pointer",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  dropdownOptions: {
    position: "absolute",
    top: 68,
    left: 0,
    right: 0,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 20,
    elevation: 8,
  },
  dropdownFieldOpen: {
    zIndex: 20,
    elevation: 8,
  },
  dropdownOption: {
    cursor: "pointer",
    minHeight: 42,
    justifyContent: "center",
    alignItems: "flex-start",
    paddingHorizontal: 12,
  },
  multiline: { minHeight: 88 },
  inlineFields: {
    flexDirection: "row",
    gap: 10,
    zIndex: 30,
    elevation: 30,
  },
  inlineField: { flex: 1 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  choice: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  helper: { fontSize: 12, lineHeight: 20, textAlign: "left" },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 14,
  },
});
