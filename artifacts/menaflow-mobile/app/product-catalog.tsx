import React, { useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Image } from "expo-image";
import { useAuth } from "@clerk/expo";
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
  getWhatsAppProductExtractions,
  getPublishableAccounts,
  getProductPublicationJobs,
  publishCatalogProducts,
  retryProductPublicationJobs,
  importProductCandidate,
  reviewProductExtraction,
  uploadProductMedia,
  updateCatalogProduct,
  type CatalogProduct,
  type ProductInput,
  type ProductExtractionSuggestion,
  type ProductPublicationSnapshot,
} from "@/lib/product-catalog-api";

type ProductDraft = ProductInput;
type CatalogTabId = "all" | "drafts" | "active" | "archived" | "extractions";

const catalogTabDefinitions: Array<{ id: CatalogTabId; label: string }> = [
  { id: "all", label: "الكل" },
  { id: "drafts", label: "المسودات" },
  { id: "active", label: "المفعّلة" },
  { id: "archived", label: "الأرشيف" },
  { id: "extractions", label: "اقتراحات الاستخراج" },
];

type EditorState = {
  id: string | null;
  value: ProductDraft;
  mediaPreviews: CatalogProduct["mediaPreviews"];
  importedFromPost?: boolean;
  extractionSuggestionId?: string;
  sourceContext?: string[];
};

const emptyDraft: ProductDraft = {
  sku: null,
  name: "",
  aliases: [],
  description: "",
  price: null,
  currency: null,
  availability: "unknown",
  status: "draft",
  mediaUrls: [],
};

function draftFromProduct(product: CatalogProduct): ProductDraft {
  return {
    sku: product.sku,
    name: product.name,
    aliases: product.aliases,
    description: product.description,
    price: normalizeProductPriceInput(product.price),
    currency: product.currency,
    availability: product.availability,
    status: product.status,
    mediaUrls: product.mediaUrls,
  };
}

function draftFromExtraction(
  suggestion: ProductExtractionSuggestion,
): ProductDraft {
  const { extractedData } = suggestion;
  const hasPriceAndCurrency = Boolean(
    extractedData.price && extractedData.currency,
  );
  return {
    sku: extractedData.sku,
    name: extractedData.name ?? "",
    aliases: extractedData.aliases,
    description: extractedData.description ?? "",
    price: hasPriceAndCurrency ? extractedData.price : null,
    currency: hasPriceAndCurrency ? extractedData.currency : null,
    availability: extractedData.availability ?? "unknown",
    status: "draft",
    mediaUrls: [],
  };
}

function normalizeProductPriceInput(price: string | null): string | null {
  if (price === null) return null;
  const normalizedPrice = normalizeArabicDigits(price).replace(/٬/g, "");
  const [integer, fraction] = normalizedPrice.split(".");
  const normalizedFraction = fraction?.replace(/0+$/, "");
  return normalizedFraction ? `${integer}.${normalizedFraction}` : integer;
}

function ProductMediaThumbnail({
  uri,
  label,
}: {
  uri: string;
  label: string;
}) {
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
            style={[
              styles.catalogTab,
              {
                borderBottomColor: selected ? colors.primary : "transparent",
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
                  backgroundColor: selected ? colors.accent : colors.secondary,
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
  const catalogKey = ["product-catalog", userId ?? "local"] as const;
  const candidatesKey = ["product-post-candidates", userId ?? "local"] as const;
  const extractionsKey = [
    "whatsapp-product-extractions",
    userId ?? "local",
  ] as const;
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => getProductCatalog(true),
    enabled: isLocalAuthDisabled || Boolean(userId),
    retry: false,
    refetchInterval: 10_000,
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
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [error, setError] = useState("");
  const [analysisSummary, setAnalysisSummary] = useState("");
  const [mediaUploading, setMediaUploading] = useState(false);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: catalogKey }),
      queryClient.invalidateQueries({ queryKey: candidatesKey }),
      queryClient.invalidateQueries({ queryKey: extractionsKey }),
    ]);
  };
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
    },
    onError: (cause) => {
      setAnalysisSummary("");
      setError(
        cause instanceof Error ? cause.message : "تعذر تحليل رسائل WhatsApp.",
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
      setEditor({
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
    visibleProducts.length > 0 &&
    visibleProducts.every((product) => selectedProductIds.has(product.id));
  const connectedAccounts = publishableAccounts.data ?? [];
  const selectedTargets = connectedAccounts.filter(
    (account) =>
      account.authorizationStatus === "ready" &&
      selectedTargetKeys.has(`${account.channel}:${account.accountId}`),
  );
  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };
  const toggleAllVisibleProducts = () => {
    setSelectedProductIds((current) => {
      const next = new Set(current);
      if (selectedAllVisible) {
        visibleProducts.forEach((product) => next.delete(product.id));
      } else {
        visibleProducts.forEach((product) => next.add(product.id));
      }
      return next;
    });
  };
  const startProductPublication = () => {
    if (selectedTargets.length === 0 || selectedProductIds.size === 0) return;
    const requestKey = pendingRequestKey ?? randomUUID();
    setPendingRequestKey(requestKey);
    publishProducts.mutate({
      requestKey,
      productIds: [...selectedProductIds],
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
  const save = useMutation({
    mutationFn: (state: EditorState) =>
      state.id
        ? updateCatalogProduct({ id: state.id, product: state.value })
        : state.extractionSuggestionId
          ? createExtractionProductDraft(
              state.extractionSuggestionId,
              state.value,
            )
          : createCatalogProduct(state.value),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "تعذر حفظ المنتج."),
  });
  const importPost = useMutation({
    mutationFn: importProductCandidate,
    onSuccess: async (product) => {
      await refresh();
      setEditor({
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

  useEffect(() => {
    if (!editor) setError("");
  }, [editor]);

  const updateDraft = (changes: Partial<ProductDraft>) => {
    setEditor((current) =>
      current
        ? { ...current, value: { ...current.value, ...changes } }
        : current,
    );
  };

  const removeProductMedia = (mediaId: string) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            value: {
              ...current.value,
              mediaUrls: current.value.mediaUrls.filter(
                (url) => url !== mediaId,
              ),
            },
            mediaPreviews: current.mediaPreviews.filter(
              (media) => media.id !== mediaId,
            ),
          }
        : current,
    );
  };

  const addProductMedia = async () => {
    if (!editor || mediaUploading) return;
    setError("");
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 0.9,
      });
      if (selection.canceled) return;
      const availableSlots = 20 - editor.value.mediaUrls.length;
      if (availableSlots <= 0) {
        setError("يمكن إرفاق 20 وسيطًا كحد أقصى للمنتج.");
        return;
      }
      if (selection.assets.length > availableSlots) {
        setError(
          `يمكن إضافة ${availableSlots} وسيطًا إضافيًا فقط؛ الحد الأقصى 20.`,
        );
      }
      setMediaUploading(true);
      for (const asset of selection.assets.slice(0, availableSlots)) {
        if (asset.fileSize && asset.fileSize > 20 * 1024 * 1024) {
          setError("حجم كل ملف يجب ألا يتجاوز 20 ميغابايت.");
          continue;
        }
        if (!asset.mimeType) {
          setError("تعذّر تحديد نوع أحد الملفات المختارة.");
          continue;
        }
        const uploaded = await uploadProductMedia({
          uri: asset.uri,
          mimeType: asset.mimeType,
        });
        const mediaPreview = uploaded.mediaPreview;
        if (!mediaPreview) {
          throw new Error("تم رفع الوسيط لكن تعذّر إنشاء معاينته.");
        }
        setEditor((current) =>
          current
            ? {
                ...current,
                value: {
                  ...current.value,
                  mediaUrls: [...current.value.mediaUrls, uploaded.id],
                },
                mediaPreviews: [...current.mediaPreviews, mediaPreview],
              }
            : current,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذّر رفع الوسائط المحددة.",
      );
    } finally {
      setMediaUploading(false);
    }
  };

  const saveProduct = async () => {
    if (!editor || save.isPending || mediaUploading) return;
    try {
      const savedProduct = await save.mutateAsync(editor);
      queryClient.setQueryData<CatalogProduct[]>(catalogKey, (current) =>
        current?.map((product) =>
          product.id === savedProduct.id ? savedProduct : product,
        ),
      );
      setEditor(null);
      setError("");
      void refresh().catch((cause) =>
        setError(
          cause instanceof Error
            ? `تم الحفظ، لكن تعذر تحديث القائمة: ${cause.message}`
            : "تم الحفظ، لكن تعذر تحديث القائمة.",
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ المنتج.");
    }
  };

  const openExtractionEditor = (
    suggestion: ProductExtractionSuggestion,
    product: CatalogProduct | null,
    useExtractedValues: boolean,
  ) => {
    setEditor(
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
        <PageTitle
          title="كتالوج المنتجات"
          subtitle="مصدر معلومات المنتجات المعتمدة للرد على العملاء."
          action={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إضافة منتج"
              onPress={() =>
                setEditor({ id: null, value: emptyDraft, mediaPreviews: [] })
              }
              style={[styles.addButton, { backgroundColor: colors.primary }]}
            >
              <Icon name="plus" size={17} color={colors.primaryForeground} />
              <Text
                style={{ color: colors.primaryForeground, fontWeight: "700" }}
              >
                منتج
              </Text>
            </Pressable>
          }
        />
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
          <ActionButton
            label={
              analyzeWhatsAppMessages.isPending
                ? "جارٍ جدولة الرسائل القديمة..."
                : "إعادة فحص الرسائل السابقة"
            }
            icon="refresh-cw"
            disabled={analyzeWhatsAppMessages.isPending}
            onPress={() => {
              setError("");
              setAnalysisSummary("");
              analyzeWhatsAppMessages.mutate();
            }}
          />
          {analysisSummary ? (
            <Text style={[styles.helper, { color: colors.primary }]}>
              {analysisSummary}
            </Text>
          ) : null}
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
                                    (item) => item.id === suggestion.productId,
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
                                    (item) => item.id === suggestion.productId,
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
                    setEditor({
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
          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              المنتجات
            </Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel="تحديد جميع المنتجات المعروضة"
              accessibilityState={{ checked: selectedAllVisible }}
              disabled={visibleProducts.length === 0}
              onPress={toggleAllVisibleProducts}
              style={styles.selectAll}
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
          <View
            style={[
              styles.productSearchRow,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Icon name="search" size={17} color={colors.mutedForeground} />
            <CairoTextInput
              accessibilityLabel="البحث في المنتجات"
              value={productSearch}
              onChangeText={setProductSearch}
              placeholder="ابحث بالاسم أو رقم المنتج"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.productSearchInput, { color: colors.foreground }]}
              returnKeyType="search"
            />
            {productSearch ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="مسح البحث"
                onPress={() => setProductSearch("")}
              >
                <Icon name="x" size={17} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          {catalog.isError ? (
            <EmptyState
              icon="alert-circle"
              title="تعذر تحميل المنتجات"
              body={
                catalog.error instanceof Error
                  ? catalog.error.message
                  : "تحقق من الاتصال ثم أعد المحاولة."
              }
            />
          ) : catalog.isPending ? (
            <Text style={{ color: colors.mutedForeground, textAlign: "left" }}>
              جارٍ تحميل المنتجات...
            </Text>
          ) : visibleProducts.length ? (
            visibleProducts.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                selected={selectedProductIds.has(product.id)}
                onToggleSelection={() => toggleProductSelection(product.id)}
                onEdit={() =>
                  setEditor({
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
              new Map(
                allProducts.map((product) => [product.id, product.name]),
              )
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
            <Text style={{ color: colors.mutedForeground, textAlign: "left" }}>
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
                          <Icon name="play" size={22} color={colors.primary} />
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
            <Text style={{ color: colors.mutedForeground, textAlign: "left" }}>
              لا توجد منشورات منشورة غير مرتبطة بمنتج.
            </Text>
          )}
          </View>
        ) : null}
      </Page>
      {selectedProductIds.size > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`النشر التلقائي، ${selectedProductIds.size} منتجات محددة`}
          onPress={() => {
            setSelectedTargetKeys(new Set());
            setPendingRequestKey(randomUUID());
            setPublishModalVisible(true);
          }}
          style={[
            styles.publishFab,
            {
              start: 16,
              bottom: insets.bottom + 16,
              backgroundColor: colors.primary,
            },
          ]}
        >
          <Icon name="send" size={18} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>
            النشر التلقائي ({selectedProductIds.size})
          </Text>
        </Pressable>
      ) : null}
      <Modal
        visible={editor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!save.isPending && !mediaUploading) setEditor(null);
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
                onPress={() => setEditor(null)}
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
                    availability: availability as ProductDraft["availability"],
                  })
                }
              />
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
                onPress={() => setEditor(null)}
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
                اختيار منصات النشر
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="إغلاق اختيار منصات النشر"
                onPress={() => {
                  if (!publishProducts.isPending) setPublishModalVisible(false);
                }}
              >
                <Icon name="x" size={20} color={colors.foreground} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.form}>
              <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                ستنشأ عملية مستقلة لكل منتج وحساب. عدد المنتجات المحددة:{" "}
                {selectedProductIds.size}.
              </Text>
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
              <ActionButton
                label={
                  publishProducts.isPending
                    ? "جارٍ جدولة عمليات النشر..."
                    : `نشر ${selectedProductIds.size} منتجًا على ${selectedTargets.length} حساب`
                }
                icon={publishProducts.isPending ? "refresh-cw" : "send"}
                disabled={
                  publishProducts.isPending ||
                  selectedTargets.length === 0 ||
                  selectedProductIds.size === 0
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
                  style={[styles.sourceMessageToggle, { color: colors.primary }]}
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
                    السعر: {formatArabicCurrency(duplicate.price, duplicate.currency)}
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
  onToggleSelection,
  onEdit,
}: {
  product: CatalogProduct;
  selected: boolean;
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
            accessibilityState={{ checked: selected }}
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
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          {product.verifiedAt
            ? `آخر تحقق: ${formatArabicDate(product.verifiedAt) ?? "غير محدد"}`
            : "لم يتم التحقق من البيانات بعد"}
        </Text>
      </Panel>
    </Pressable>
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
  keyboardType?: "default" | "decimal-pad";
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
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  section: { gap: 10 },
  catalogTabsScroll: { flexGrow: 0, marginTop: -8, marginBottom: -4 },
  catalogTabsContent: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 4,
    minHeight: 46,
  },
  catalogTab: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderBottomWidth: 2,
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
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
  },
  productSearchInput: {
    flex: 1,
    minHeight: 42,
    textAlign: "right",
    writingDirection: "rtl",
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  link: { fontSize: 12, fontWeight: "600" },
  sectionTitle: { fontSize: 16, fontWeight: "700", textAlign: "right" },
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
  publishFab: {
    position: "absolute",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 28,
    paddingHorizontal: 18,
    elevation: 8,
    zIndex: 50,
  },
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
