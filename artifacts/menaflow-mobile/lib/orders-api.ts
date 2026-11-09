import { fetchApiResponse } from "@workspace/api-client-react";

export type OrderStatus =
  "draft" | "confirmed" | "preparing" | "shipped" | "completed" | "cancelled";

export type OrderItem = {
  id: string;
  productId: string | null;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export type OrderEvent = {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  createdAt: string;
};

export type CustomerOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string | null;
  deliveryAddress: string | null;
  notes: string;
  sourceMetaInboxItemId: string | null;
  sourcePlatform: "facebook" | "instagram" | null;
  sourceConversationId: string | null;
  status: OrderStatus;
  currency: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  items: OrderItem[];
  events: OrderEvent[];
};

export type CreateOrderInput = {
  clientRequestId: string;
  customerName: string;
  customerPhone?: string;
  deliveryAddress?: string;
  notes?: string;
  sourceMetaInboxItemId?: string;
  items: Array<{ productId: string; quantity: number }>;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    throw new Error("تعذر قراءة استجابة الخادم.");
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new Error(
      typeof error === "string" ? error : `HTTP ${response.status}`,
    );
  }
  return payload as T;
}

export async function getOrders(
  status: OrderStatus | "all",
  search: string,
  cursor?: string,
): Promise<{ orders: CustomerOrder[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (status !== "all") query.set("status", status);
  if (search.trim()) query.set("search", search.trim());
  if (cursor) query.set("cursor", cursor);
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetchApiResponse(`/api/social/orders${suffix}`);
  return responseJson<{ orders: CustomerOrder[]; nextCursor: string | null }>(
    response,
  );
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<CustomerOrder> {
  const response = await fetchApiResponse("/api/social/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = await responseJson<{ order: CustomerOrder }>(response);
  return result.order;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<CustomerOrder> {
  const response = await fetchApiResponse(
    `/api/social/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  const result = await responseJson<{ order: CustomerOrder }>(response);
  return result.order;
}
