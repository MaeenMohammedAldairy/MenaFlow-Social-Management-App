import type { OrderStatus } from "@workspace/db";

export type CreateOrderInput = {
  clientRequestId: string;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  notes: string;
  sourceMetaInboxItemId: string | null;
  items: Array<{ productId: string; quantity: number }>;
};

export type OrderableProduct = {
  id: string;
  sku: string | null;
  name: string;
  price: string | null;
  currency: string | null;
  availability: "unknown" | "in_stock" | "out_of_stock" | "preorder";
  status: "draft" | "active" | "archived";
  verifiedAt: Date | null;
};

export type CalculatedOrder = {
  currency: string;
  total: string;
  items: Array<{
    productId: string;
    productName: string;
    productSku: string | null;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
};

const orderStatuses: readonly OrderStatus[] = [
  "draft",
  "confirmed",
  "preparing",
  "shipped",
  "completed",
  "cancelled",
];
const validStatuses = new Set<string>(orderStatuses);
const transitions: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

function optionalText(value: unknown, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

export function parseCreateOrderInput(value: unknown): CreateOrderInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const clientRequestId =
    typeof input.clientRequestId === "string"
      ? input.clientRequestId.trim()
      : "";
  const customerName =
    typeof input.customerName === "string" ? input.customerName.trim() : "";
  const customerPhone = optionalText(input.customerPhone, 40);
  const deliveryAddress = optionalText(input.deliveryAddress, 500);
  const notes =
    typeof input.notes === "string"
      ? input.notes.trim()
      : input.notes === undefined
        ? ""
        : null;
  const sourceMetaInboxItemId = optionalText(input.sourceMetaInboxItemId, 200);
  if (
    !/^[A-Za-z0-9_-]{16,100}$/.test(clientRequestId) ||
    !customerName ||
    customerName.length > 160 ||
    (input.customerPhone !== undefined &&
      input.customerPhone !== null &&
      input.customerPhone !== "" &&
      customerPhone === null) ||
    (input.deliveryAddress !== undefined &&
      input.deliveryAddress !== null &&
      input.deliveryAddress !== "" &&
      deliveryAddress === null) ||
    notes === null ||
    notes.length > 1000 ||
    (input.sourceMetaInboxItemId !== undefined &&
      input.sourceMetaInboxItemId !== null &&
      input.sourceMetaInboxItemId !== "" &&
      sourceMetaInboxItemId === null) ||
    !Array.isArray(input.items) ||
    input.items.length < 1 ||
    input.items.length > 30
  ) {
    return null;
  }
  const items: CreateOrderInput["items"] = [];
  const productIds = new Set<string>();
  for (const rawItem of input.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      return null;
    }
    const item = rawItem as Record<string, unknown>;
    if (
      typeof item.productId !== "string" ||
      !item.productId.trim() ||
      item.productId.length > 200 ||
      !Number.isInteger(item.quantity) ||
      (item.quantity as number) < 1 ||
      (item.quantity as number) > 999 ||
      productIds.has(item.productId)
    ) {
      return null;
    }
    productIds.add(item.productId);
    items.push({
      productId: item.productId,
      quantity: item.quantity as number,
    });
  }
  return {
    clientRequestId,
    customerName,
    customerPhone,
    deliveryAddress,
    notes,
    sourceMetaInboxItemId,
    items,
  };
}

export function parseOrderStatus(value: unknown): OrderStatus | null {
  return typeof value === "string" && validStatuses.has(value)
    ? (value as OrderStatus)
    : null;
}

export function canTransitionOrderStatus(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  return transitions[current].includes(next);
}

export function moneyToMinorUnits(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const minorUnits = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minorUnits) ? minorUnits : null;
}

export function minorUnitsToMoney(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

export function calculateOrder(
  requestedItems: CreateOrderInput["items"],
  products: OrderableProduct[],
):
  | { order: CalculatedOrder }
  | {
      error:
        | "PRODUCT_NOT_FOUND"
        | "PRODUCT_UNAVAILABLE"
        | "PRODUCT_NOT_ORDERABLE"
        | "INVALID_PRODUCT_PRICE"
        | "ORDER_TOTAL_TOO_LARGE";
    } {
  if (products.length !== requestedItems.length) {
    return { error: "PRODUCT_NOT_FOUND" };
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  let currency: string | null = null;
  let totalMinorUnits = 0;
  const lines: CalculatedOrder["items"] = [];
  for (const requestedItem of requestedItems) {
    const product = productById.get(requestedItem.productId);
    if (!product || product.status !== "active") {
      return { error: "PRODUCT_UNAVAILABLE" };
    }
    if (
      product.availability === "out_of_stock" ||
      product.price === null ||
      product.currency === null ||
      product.verifiedAt === null
    ) {
      return { error: "PRODUCT_NOT_ORDERABLE" };
    }
    const unitPriceMinorUnits = moneyToMinorUnits(product.price);
    if (
      unitPriceMinorUnits === null ||
      (currency !== null && currency !== product.currency)
    ) {
      return { error: "INVALID_PRODUCT_PRICE" };
    }
    currency = product.currency;
    const lineTotalMinorUnits = unitPriceMinorUnits * requestedItem.quantity;
    totalMinorUnits += lineTotalMinorUnits;
    if (
      !Number.isSafeInteger(totalMinorUnits) ||
      totalMinorUnits > 999_999_999_999
    ) {
      return { error: "ORDER_TOTAL_TOO_LARGE" };
    }
    lines.push({
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      quantity: requestedItem.quantity,
      unitPrice: minorUnitsToMoney(unitPriceMinorUnits),
      lineTotal: minorUnitsToMoney(lineTotalMinorUnits),
    });
  }
  if (currency === null) return { error: "INVALID_PRODUCT_PRICE" };
  return {
    order: {
      currency,
      total: minorUnitsToMoney(totalMinorUnits),
      items: lines,
    },
  };
}
