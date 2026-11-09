import React, { useMemo, useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  Alert,
  Pressable,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAuth } from "@clerk/expo";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ActionButton,
  BrandHeader,
  EmptyState,
  Page,
  PageTitle,
  Panel,
} from "@/components/Ui";
import {
  CairoText as Text,
  CairoTextInput,
} from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { isLocalAuthDisabled } from "@/constants/auth";
import { useColors } from "@/hooks/useColors";
import {
  formatArabicCurrency,
  formatArabicDateTime,
  formatArabicNumber,
} from "@/lib/formatting";
import {
  createOrder,
  getOrders,
  getOrderSummary,
  updateOrderStatus,
  type CustomerOrder,
  type OrderStatus,
} from "@/lib/orders-api";
import {
  getProductCatalog,
  type CatalogProduct,
} from "@/lib/product-catalog-api";

const orderStatuses: Array<{ id: OrderStatus | "all"; label: string }> = [
  { id: "all", label: "الكل" },
  { id: "draft", label: "مسودة" },
  { id: "confirmed", label: "مؤكد" },
  { id: "preparing", label: "قيد التجهيز" },
  { id: "shipped", label: "تم الشحن" },
  { id: "completed", label: "مكتمل" },
  { id: "cancelled", label: "ملغي" },
];

const statusLabels: Record<OrderStatus, string> = {
  draft: "مسودة",
  confirmed: "مؤكد",
  preparing: "قيد التجهيز",
  shipped: "تم الشحن",
  completed: "مكتمل",
  cancelled: "ملغي",
};

const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = {
  draft: "confirmed",
  confirmed: "preparing",
  preparing: "shipped",
  shipped: "completed",
};

function orderErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "تعذر إكمال العملية. تحقق من اتصالك ثم أعد المحاولة.";
  }
  if (
    /failed to fetch|network request failed|networkerror/i.test(error.message)
  ) {
    return "تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.";
  }
  return error.message;
}

function getStatusColor(
  status: OrderStatus,
  colors: ReturnType<typeof useColors>,
) {
  if (status === "completed") return colors.green;
  if (status === "cancelled") return colors.destructive;
  if (status === "shipped") return colors.blue;
  return colors.primary;
}

function confirmOrderCancellation(
  orderNumber: string,
  onConfirm: () => void,
): void {
  const message = `سيتم تسجيل الطلب ${orderNumber} كملغي.`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    if (window.confirm(message)) onConfirm();
    return;
  }
  Alert.alert("تأكيد إلغاء الطلب", message, [
    { text: "العودة", style: "cancel" },
    { text: "إلغاء الطلب", style: "destructive", onPress: onConfirm },
  ]);
}

export default function OrderManagementScreen() {
  return isLocalAuthDisabled ? (
    <OrderManagementContent userId={null} />
  ) : (
    <AuthenticatedOrders />
  );
}

function AuthenticatedOrders() {
  const { userId } = useAuth();
  return <OrderManagementContent userId={userId ?? null} />;
}

function OrderManagementContent({ userId }: { userId: string | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    sourceMetaInboxItemId?: string | string[];
    customerName?: string | string[];
  }>();
  const initialSourceId = Array.isArray(params.sourceMetaInboxItemId)
    ? params.sourceMetaInboxItemId[0]
    : params.sourceMetaInboxItemId;
  const initialCustomerName = Array.isArray(params.customerName)
    ? params.customerName[0]
    : params.customerName;
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(Boolean(initialSourceId));
  const [customerName, setCustomerName] = useState(initialCustomerName ?? "");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [sourceMetaInboxItemId, setSourceMetaInboxItemId] = useState(
    initialSourceId ?? "",
  );
  const [clientRequestId, setClientRequestId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [productSearch, setProductSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const queryKey = ["orders", userId ?? "local", statusFilter, search] as const;
  const orders = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getOrders(statusFilter, search, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: isLocalAuthDisabled || Boolean(userId),
  });
  const products = useQuery({
    queryKey: ["order-products", userId ?? "local"],
    queryFn: () => getProductCatalog(),
    enabled: (isLocalAuthDisabled || Boolean(userId)) && showForm,
  });
  const createMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: (order) => {
      setFormError(null);
      setSuccessMessage(`تم حفظ الطلب ${order.orderNumber} كمسودة.`);
      setCustomerName("");
      setCustomerPhone("");
      setDeliveryAddress("");
      setNotes("");
      setQuantities({});
      setClientRequestId(null);
      setSourceMetaInboxItemId("");
      setShowForm(false);
      void queryClient.invalidateQueries({
        queryKey: ["orders", userId ?? "local"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["order-summary", userId ?? "local"],
      });
    },
    onError: (error) => setFormError(orderErrorMessage(error)),
  });
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      updateOrderStatus(id, status),
    onSuccess: () => {
      setFormError(null);
      void queryClient.invalidateQueries({
        queryKey: ["orders", userId ?? "local"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["order-summary", userId ?? "local"],
      });
    },
    onError: (error) => setFormError(orderErrorMessage(error)),
  });
  const availableProducts = useMemo(
    () =>
      (products.data ?? []).filter(
        (product) =>
          product.status === "active" &&
          product.price !== null &&
          product.currency !== null &&
          product.verifiedAt !== null &&
          product.availability !== "out_of_stock",
      ),
    [products.data],
  );
  const visibleProducts = availableProducts.filter((product) =>
    product.name
      .toLocaleLowerCase()
      .includes(productSearch.trim().toLocaleLowerCase()),
  );
  const selectedProducts = availableProducts.filter(
    (product) => (quantities[product.id] ?? 0) > 0,
  );
  const currencies = new Set(
    selectedProducts.map((product) => product.currency).filter(Boolean),
  );
  const selectedCurrency = selectedProducts[0]?.currency ?? null;
  const hasMixedCurrencies = currencies.size > 1;
  const loadedOrders = orders.data?.pages.flatMap((page) => page.orders) ?? [];
  const estimatedTotal =
    selectedProducts.reduce((total, product) => {
      const [whole, fraction = ""] = (product.price ?? "0").split(".");
      const unitPriceMinor =
        Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
      return total + unitPriceMinor * (quantities[product.id] ?? 0);
    }, 0) / 100;

  const toggleProduct = (product: CatalogProduct) => {
    setFormError(null);
    setSuccessMessage(null);
    const currentQuantity = quantities[product.id] ?? 0;
    if (currentQuantity === 0 && Object.keys(quantities).length >= 30) {
      setFormError("يمكن إضافة 30 منتجًا كحد أقصى للطلب.");
      return;
    }
    if (
      currentQuantity === 0 &&
      selectedCurrency &&
      product.currency &&
      selectedCurrency !== product.currency
    ) {
      setFormError("يجب أن تكون عملة جميع المنتجات في الطلب واحدة.");
      return;
    }
    setClientRequestId(null);
    setQuantities((current) => {
      if ((current[product.id] ?? 0) > 0) {
        const next = { ...current };
        delete next[product.id];
        return next;
      }
      return { ...current, [product.id]: 1 };
    });
  };

  const adjustQuantity = (productId: string, delta: number) => {
    if ((quantities[productId] ?? 0) + delta > 999) return;
    setClientRequestId(null);
    setQuantities((current) => {
      const quantity = (current[productId] ?? 0) + delta;
      if (quantity < 1) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      if (quantity > 999) return current;
      return { ...current, [productId]: quantity };
    });
  };

  const submitOrder = () => {
    setFormError(null);
    setSuccessMessage(null);
    if (!customerName.trim()) {
      setFormError("أدخل اسم العميل لإنشاء الطلب.");
      return;
    }
    if (!selectedProducts.length) {
      setFormError("اختر منتجًا واحدًا على الأقل.");
      return;
    }
    if (hasMixedCurrencies) {
      setFormError("يجب أن تكون عملة جميع المنتجات في الطلب واحدة.");
      return;
    }
    const requestId = clientRequestId ?? randomUUID();
    setClientRequestId(requestId);
    createMutation.mutate({
      clientRequestId: requestId,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim() || undefined,
      deliveryAddress: deliveryAddress.trim() || undefined,
      notes: notes.trim() || undefined,
      sourceMetaInboxItemId: sourceMetaInboxItemId || undefined,
      items: selectedProducts.map((product) => ({
        productId: product.id,
        quantity: quantities[product.id],
      })),
    });
  };

  return (
    <Page
      refreshControl={
        <RefreshControl
          refreshing={orders.isRefetching}
          onRefresh={() => void orders.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <BrandHeader />
      <PageTitle
        title="الطلبات"
        subtitle="سجّل الطلبات الواردة وتابع تجهيزها. لا تشمل هذه النسخة تحصيل الدفع أو خصم المخزون."
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showForm ? "إغلاق نموذج الطلب" : "إنشاء طلب"}
            onPress={() => {
              setShowForm((current) => !current);
              setFormError(null);
              setSuccessMessage(null);
            }}
            style={[styles.addButton, { backgroundColor: colors.primary }]}
          >
            <Icon
              name={showForm ? "x" : "plus"}
              size={17}
              color={colors.primaryForeground}
            />
            <Text
              style={{
                color: colors.primaryForeground,
                fontWeight: "800",
                fontSize: 12,
              }}
            >
              {showForm ? "إغلاق" : "طلب جديد"}
            </Text>
          </Pressable>
        }
      />

      {successMessage ? (
        <Panel style={[styles.noticePanel, { backgroundColor: colors.accent }]}>
          <Icon name="check-circle" size={18} color={colors.primary} />
          <Text
            accessibilityRole="alert"
            style={{
              color: colors.primary,
              flex: 1,
              textAlign: "right",
              fontWeight: "700",
            }}
          >
            {successMessage}
          </Text>
        </Panel>
      ) : null}
      {formError ? (
        <Panel style={[styles.errorPanel, { borderColor: colors.destructive }]}>
          <Text
            accessibilityRole="alert"
            style={{ color: colors.destructive, textAlign: "right" }}
          >
            {formError}
          </Text>
        </Panel>
      ) : null}

      {showForm ? (
        <Panel style={styles.formPanel}>
          <View style={styles.sectionHeading}>
            <View
              style={[styles.sectionIcon, { backgroundColor: colors.accent }]}
            >
              <Icon name="shopping-bag" size={17} color={colors.primary} />
            </View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              تفاصيل الطلب
            </Text>
          </View>
          {sourceMetaInboxItemId ? (
            <View
              style={[styles.sourceNotice, { backgroundColor: colors.accent }]}
            >
              <Icon name="message-square" size={16} color={colors.primary} />
              <Text
                style={{
                  color: colors.primary,
                  flex: 1,
                  textAlign: "right",
                  fontSize: 11,
                  fontWeight: "700",
                }}
              >
                سيرتبط الطلب بالمحادثة التي جئت منها.
              </Text>
            </View>
          ) : null}
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            اسم العميل *
          </Text>
          <CairoTextInput
            accessibilityLabel="اسم العميل"
            editable={!createMutation.isPending}
            value={customerName}
            onChangeText={(value) => {
              setClientRequestId(null);
              setCustomerName(value);
            }}
            placeholder="مثال: سارة محمد"
            maxLength={160}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            رقم التواصل
          </Text>
          <CairoTextInput
            accessibilityLabel="رقم هاتف العميل"
            editable={!createMutation.isPending}
            value={customerPhone}
            onChangeText={(value) => {
              setClientRequestId(null);
              setCustomerPhone(value);
            }}
            placeholder="+967..."
            keyboardType="phone-pad"
            maxLength={40}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            عنوان التوصيل
          </Text>
          <CairoTextInput
            accessibilityLabel="عنوان التوصيل"
            editable={!createMutation.isPending}
            value={deliveryAddress}
            onChangeText={(value) => {
              setClientRequestId(null);
              setDeliveryAddress(value);
            }}
            placeholder="المدينة، الحي، تفاصيل العنوان"
            maxLength={500}
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
            ملاحظات
          </Text>
          <CairoTextInput
            accessibilityLabel="ملاحظات الطلب"
            editable={!createMutation.isPending}
            value={notes}
            onChangeText={(value) => {
              setClientRequestId(null);
              setNotes(value);
            }}
            placeholder="ملاحظات اختيارية للطلب"
            maxLength={1000}
            multiline
            style={[
              styles.input,
              styles.multiline,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />

          <View style={styles.sectionHeading}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              المنتجات
            </Text>
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              اختر من المنتجات النشطة ذات السعر المعتمد
            </Text>
          </View>
          <View
            style={[
              styles.searchBox,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
              },
            ]}
          >
            <Icon name="search" size={17} color={colors.mutedForeground} />
            <CairoTextInput
              accessibilityLabel="ابحث عن منتج للطلب"
              value={productSearch}
              onChangeText={setProductSearch}
              placeholder="ابحث عن منتج"
              style={[styles.searchInput, { color: colors.foreground }]}
            />
          </View>
          {products.isPending ? (
            <Text
              style={[styles.inlineNotice, { color: colors.mutedForeground }]}
            >
              جارٍ تحميل المنتجات...
            </Text>
          ) : products.isError ? (
            <View style={styles.errorInline}>
              <Text style={{ color: colors.destructive, textAlign: "right" }}>
                {orderErrorMessage(products.error)}
              </Text>
              <ActionButton
                label="إعادة تحميل المنتجات"
                icon="refresh-cw"
                onPress={() => void products.refetch()}
              />
            </View>
          ) : visibleProducts.length ? (
            <View style={styles.productList}>
              {visibleProducts.slice(0, 60).map((product) => {
                const quantity = quantities[product.id] ?? 0;
                return (
                  <View
                    key={product.id}
                    style={[
                      styles.productRow,
                      {
                        backgroundColor: quantity
                          ? colors.accent
                          : colors.background,
                        borderColor: quantity ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: quantity > 0 }}
                      accessibilityLabel={`${product.name}${product.price ? `، ${product.price} ${product.currency}` : ""}`}
                      onPress={() => toggleProduct(product)}
                      disabled={createMutation.isPending}
                      style={styles.productSelect}
                    >
                      <Icon
                        name={quantity ? "check-circle" : "package"}
                        size={19}
                        color={
                          quantity ? colors.primary : colors.mutedForeground
                        }
                      />
                      <View style={styles.productCopy}>
                        <Text
                          style={[
                            styles.productName,
                            { color: colors.foreground },
                          ]}
                        >
                          {product.name}
                        </Text>
                        <Text
                          style={[
                            styles.productPrice,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {formatArabicCurrency(
                            Number(product.price),
                            product.currency ?? "",
                          )}
                        </Text>
                      </View>
                    </Pressable>
                    {quantity > 0 ? (
                      <View style={styles.quantityControl}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`زيادة كمية ${product.name}`}
                          onPress={() => adjustQuantity(product.id, 1)}
                          disabled={createMutation.isPending}
                          style={[
                            styles.quantityButton,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Icon name="plus" size={14} color={colors.primary} />
                        </Pressable>
                        <Text
                          accessibilityLabel={`الكمية ${quantity}`}
                          style={[
                            styles.quantityText,
                            { color: colors.foreground },
                          ]}
                        >
                          {formatArabicNumber(quantity)}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`تقليل كمية ${product.name}`}
                          onPress={() => adjustQuantity(product.id, -1)}
                          disabled={createMutation.isPending}
                          style={[
                            styles.quantityButton,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Icon name="minus" size={14} color={colors.primary} />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <EmptyState
              icon="package"
              title={
                availableProducts.length
                  ? "لا توجد نتائج"
                  : "لا توجد منتجات جاهزة للطلب"
              }
              body={
                availableProducts.length
                  ? "جرّب اسمًا مختلفًا."
                  : "فعّل منتجًا وحدد سعره وعملته أولًا من الكتالوج."
              }
            />
          )}
          {selectedProducts.length ? (
            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
              <Text style={[styles.totalLabel, { color: colors.foreground }]}>
                الإجمالي التقديري
              </Text>
              <Text style={[styles.totalValue, { color: colors.primary }]}>
                {formatArabicCurrency(estimatedTotal, selectedCurrency ?? "")}
              </Text>
            </View>
          ) : null}
          <ActionButton
            label={
              createMutation.isPending ? "جارٍ حفظ الطلب..." : "حفظ كمسودة"
            }
            icon={createMutation.isPending ? "clock" : "save"}
            disabled={createMutation.isPending || products.isPending}
            onPress={submitOrder}
          />
        </Panel>
      ) : null}

      <Panel style={styles.listPanel}>
        <View style={styles.sectionHeading}>
          <View
            style={[styles.sectionIcon, { backgroundColor: colors.accent }]}
          >
            <Icon name="file-text" size={17} color={colors.primary} />
          </View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            سجل الطلبات
          </Text>
          {orders.data ? (
            <View
              style={[styles.countBadge, { backgroundColor: colors.secondary }]}
            >
              <Text style={[styles.countText, { color: colors.foreground }]}>
                {formatArabicNumber(loadedOrders.length)}
              </Text>
            </View>
          ) : null}
        </View>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Icon name="search" size={17} color={colors.mutedForeground} />
          <CairoTextInput
            accessibilityLabel="ابحث بالعميل أو رقم الطلب"
            value={search}
            onChangeText={setSearch}
            placeholder="ابحث بالعميل أو رقم الطلب"
            style={[styles.searchInput, { color: colors.foreground }]}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statusFilters}
        >
          {orderStatuses.map((status) => {
            const selected = statusFilter === status.id;
            return (
              <Pressable
                key={status.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setStatusFilter(status.id)}
                style={[
                  styles.statusFilter,
                  {
                    backgroundColor: selected
                      ? colors.primary
                      : colors.background,
                    borderColor: selected ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: selected
                      ? colors.primaryForeground
                      : colors.foreground,
                    fontSize: 11,
                    fontWeight: "700",
                  }}
                >
                  {status.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {orders.isPending ? (
          <Text
            style={[styles.inlineNotice, { color: colors.mutedForeground }]}
          >
            جارٍ تحميل الطلبات...
          </Text>
        ) : orders.isError && !orders.data ? (
          <View style={styles.errorInline}>
            <Text style={{ color: colors.destructive, textAlign: "right" }}>
              {orderErrorMessage(orders.error)}
            </Text>
            <ActionButton
              label="إعادة المحاولة"
              icon="refresh-cw"
              onPress={() => void orders.refetch()}
            />
          </View>
        ) : loadedOrders.length ? (
          <View style={styles.orderList}>
            {loadedOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                isUpdating={
                  statusMutation.isPending &&
                  statusMutation.variables?.id === order.id
                }
                onStatusChange={(status) =>
                  statusMutation.mutate({ id: order.id, status })
                }
              />
            ))}
            {orders.hasNextPage ? (
              <ActionButton
                label={
                  orders.isFetchingNextPage
                    ? "جارٍ تحميل المزيد..."
                    : "تحميل طلبات أقدم"
                }
                icon={orders.isFetchingNextPage ? "clock" : "chevron-down"}
                disabled={orders.isFetchingNextPage}
                onPress={() => void orders.fetchNextPage()}
              />
            ) : null}
            {orders.isError ? (
              <View style={styles.errorInline}>
                <Text
                  accessibilityRole="alert"
                  style={{ color: colors.destructive, textAlign: "right" }}
                >
                  {orderErrorMessage(orders.error)}
                </Text>
                <ActionButton
                  label="إعادة المحاولة"
                  icon="refresh-cw"
                  onPress={() => void orders.fetchNextPage()}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <EmptyState
            icon="shopping-bag"
            title={search ? "لا توجد نتائج" : "لا توجد طلبات بعد"}
            body={
              search
                ? "جرّب كلمة بحث مختلفة."
                : "ابدأ بتسجيل أول طلب من زر «طلب جديد»."
            }
          />
        )}
      </Panel>
    </Page>
  );

  function OrderCard({
    order,
    isUpdating,
    onStatusChange,
  }: {
    order: CustomerOrder;
    isUpdating: boolean;
    onStatusChange: (status: OrderStatus) => void;
  }) {
    const statusColor = getStatusColor(order.status, colors);
    return (
      <Panel style={[styles.orderCard, { borderColor: colors.border }]}>
        <View style={styles.orderTop}>
          <View style={styles.orderHeading}>
            <Text style={[styles.orderNumber, { color: colors.foreground }]}>
              {order.orderNumber}
            </Text>
            <Text
              style={[styles.orderCustomer, { color: colors.mutedForeground }]}
            >
              {order.customerName}
            </Text>
          </View>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${statusColor}18` },
            ]}
          >
            <Text
              style={{ color: statusColor, fontSize: 11, fontWeight: "800" }}
            >
              {statusLabels[order.status]}
            </Text>
          </View>
        </View>
        <Text style={[styles.orderDate, { color: colors.mutedForeground }]}>
          {formatArabicDateTime(order.createdAt) ?? "وقت غير محدد"}
        </Text>
        <View style={styles.lineItems}>
          {order.items.map((item) => (
            <View key={item.id} style={styles.lineItem}>
              <Text style={[styles.lineName, { color: colors.foreground }]}>
                {item.productName} × {formatArabicNumber(item.quantity)}
              </Text>
              <Text
                style={[styles.linePrice, { color: colors.mutedForeground }]}
              >
                {formatArabicCurrency(Number(item.lineTotal), order.currency)}
              </Text>
            </View>
          ))}
        </View>
        {order.customerPhone ? (
          <View style={styles.detailRow}>
            <Icon
              name="message-circle"
              size={14}
              color={colors.mutedForeground}
            />
            <Text
              style={[styles.detailText, { color: colors.mutedForeground }]}
            >
              {order.customerPhone}
            </Text>
          </View>
        ) : null}
        {order.deliveryAddress ? (
          <View style={styles.detailRow}>
            <Icon name="globe" size={14} color={colors.mutedForeground} />
            <Text
              style={[styles.detailText, { color: colors.mutedForeground }]}
            >
              {order.deliveryAddress}
            </Text>
          </View>
        ) : null}
        {order.sourceMetaInboxItemId ? (
          <View style={styles.detailRow}>
            <Icon name="message-square" size={14} color={colors.primary} />
            <Text style={[styles.detailText, { color: colors.primary }]}>
              {order.sourcePlatform === "facebook"
                ? "مرتبط بمحادثة فيسبوك"
                : "مرتبط بمحادثة إنستغرام"}
            </Text>
          </View>
        ) : null}
        <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
          <Text style={[styles.totalLabel, { color: colors.foreground }]}>
            الإجمالي
          </Text>
          <Text style={[styles.totalValue, { color: colors.primary }]}>
            {formatArabicCurrency(Number(order.total), order.currency)}
          </Text>
        </View>
        {order.notes ? (
          <Text style={[styles.orderNotes, { color: colors.mutedForeground }]}>
            {order.notes}
          </Text>
        ) : null}
        {order.events.length > 1 ? (
          <View style={[styles.history, { borderTopColor: colors.border }]}>
            <Text
              style={[styles.historyTitle, { color: colors.mutedForeground }]}
            >
              سجل الحالة
            </Text>
            {order.events.slice(-4).map((event) => (
              <Text
                key={event.id}
                style={[styles.historyText, { color: colors.mutedForeground }]}
              >
                {statusLabels[event.toStatus]} ·{" "}
                {formatArabicDateTime(event.createdAt) ?? ""}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.orderActions}>
          {nextStatus[order.status] ? (
            <ActionButton
              label={
                isUpdating
                  ? "جارٍ التحديث..."
                  : `تحديث إلى: ${statusLabels[nextStatus[order.status]!]}`
              }
              icon="chevron-left"
              disabled={isUpdating}
              onPress={() => onStatusChange(nextStatus[order.status]!)}
            />
          ) : null}
          {["draft", "confirmed", "preparing"].includes(order.status) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`إلغاء الطلب ${order.orderNumber}`}
              disabled={isUpdating}
              onPress={() =>
                confirmOrderCancellation(order.orderNumber, () =>
                  onStatusChange("cancelled"),
                )
              }
              style={[
                styles.cancelButton,
                {
                  borderColor: colors.destructive,
                  opacity: isUpdating ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={{
                  color: colors.destructive,
                  fontSize: 12,
                  fontWeight: "700",
                }}
              >
                إلغاء الطلب
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Panel>
    );
  }
}

const styles = StyleSheet.create({
  addButton: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 11,
  },
  noticePanel: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
    paddingVertical: 11,
  },
  sourceNotice: {
    minHeight: 38,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    borderRadius: 11,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  errorPanel: { borderWidth: 1, paddingVertical: 11 },
  formPanel: { gap: 11 },
  listPanel: { gap: 12 },
  sectionHeading: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
  },
  sectionIcon: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "right",
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
    marginTop: 3,
  },
  fieldHint: { fontSize: 10, textAlign: "right" },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlign: "right",
    fontSize: 13,
  },
  multiline: { minHeight: 78, textAlignVertical: "top" },
  searchBox: {
    minHeight: 44,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
  },
  searchInput: { flex: 1, minHeight: 40, fontSize: 12, textAlign: "right" },
  productList: { gap: 7 },
  productRow: {
    minHeight: 58,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  productSelect: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 9,
  },
  productCopy: { flex: 1, minWidth: 0, alignItems: "flex-start", gap: 3 },
  productName: { fontSize: 12, fontWeight: "700", textAlign: "right" },
  productPrice: { fontSize: 10, textAlign: "right" },
  quantityControl: { flexDirection: "row", alignItems: "center", gap: 8 },
  quantityButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 9,
  },
  quantityText: {
    minWidth: 18,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
  },
  totalRow: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 11,
    marginTop: 2,
  },
  totalLabel: { fontSize: 13, fontWeight: "800" },
  totalValue: { fontSize: 15, fontWeight: "900" },
  statusFilters: { flexDirection: "row-reverse", gap: 7, paddingVertical: 2 },
  statusFilter: {
    minHeight: 34,
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 11,
  },
  countBadge: {
    minWidth: 27,
    height: 27,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    paddingHorizontal: 7,
  },
  countText: { fontSize: 11, fontWeight: "800" },
  orderList: { gap: 10 },
  orderCard: { gap: 10, padding: 13 },
  orderTop: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  orderHeading: { flex: 1, gap: 3, alignItems: "flex-start" },
  orderNumber: { fontSize: 14, fontWeight: "900" },
  orderCustomer: { fontSize: 12, fontWeight: "600" },
  statusBadge: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  orderDate: { fontSize: 10, textAlign: "right" },
  lineItems: { gap: 7 },
  lineItem: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  lineName: { flex: 1, fontSize: 12, textAlign: "right" },
  linePrice: { fontSize: 11, fontWeight: "700" },
  detailRow: { flexDirection: "row-reverse", alignItems: "center", gap: 6 },
  detailText: { flex: 1, fontSize: 11, textAlign: "right" },
  orderNotes: { fontSize: 11, lineHeight: 18, textAlign: "right" },
  history: { gap: 5, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 9 },
  historyTitle: { textAlign: "right", fontSize: 10, fontWeight: "800" },
  historyText: { textAlign: "right", fontSize: 10 },
  orderActions: { gap: 7, alignItems: "stretch" },
  cancelButton: {
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 11,
  },
  inlineNotice: { textAlign: "right", fontSize: 12, paddingVertical: 8 },
  errorInline: { gap: 9, alignItems: "stretch" },
});
