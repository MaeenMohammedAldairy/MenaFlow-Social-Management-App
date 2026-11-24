/**
 * Orders API.
 *
 * A thin adapter over the generated client, not a second implementation. The
 * types and the transport come from `@workspace/api-spec` via codegen, so the
 * contract is the only place an order's shape is written down. What stays here
 * is ergonomics only: positional arguments instead of a params object, and
 * unwrapping the `{ order }` envelope the endpoints return.
 *
 * Before this was a hand-written module with its own copies of `CustomerOrder`,
 * `OrderStatus`, `OrderSummary` and friends, kept in sync by hand — the exact
 * drift the contract exists to prevent.
 */
import {
  createOrder as createOrderRequest,
  getOrderSummary,
  listOrders,
  updateOrderDelivery as updateOrderDeliveryRequest,
  updateOrderStatus as updateOrderStatusRequest,
  type CollectionStatus,
  type CreateOrderRequest,
  type DeliveryStatus,
  type ListOrdersParams,
  type MetaConfirmationStatus,
  type Order,
  type OrderEvent,
  type OrderItem,
  type OrderStatus,
  type OrderSummary,
  type WhatsAppConfirmationStatus,
} from "@workspace/api-client-react";

export type {
  CollectionStatus,
  DeliveryStatus,
  MetaConfirmationStatus,
  OrderEvent,
  OrderItem,
  OrderStatus,
  OrderSummary,
  WhatsAppConfirmationStatus,
};

export { getOrderSummary };

/** The wire name is `Order`; the app calls a merchant's order a customer order. */
export type CustomerOrder = Order;

export type CreateOrderInput = CreateOrderRequest;

export async function getOrders(
  status: OrderStatus | "all",
  search: string,
  cursor?: string,
): Promise<{ orders: CustomerOrder[]; nextCursor: string | null }> {
  const params: ListOrdersParams = {};
  if (status !== "all") params.status = status;
  const trimmedSearch = search.trim();
  if (trimmedSearch) params.search = trimmedSearch;
  if (cursor) params.cursor = cursor;
  return listOrders(params);
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<CustomerOrder> {
  const { order } = await createOrderRequest(input);
  return order;
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<CustomerOrder> {
  const { order } = await updateOrderStatusRequest(orderId, { status });
  return order;
}

export async function updateOrderDelivery(
  orderId: string,
  input: OrderDeliveryUpdate,
): Promise<CustomerOrder> {
  const { order } = await updateOrderDeliveryRequest(orderId, input);
  return order;
}

export type OrderDeliveryUpdate = {
  deliveryStatus?: DeliveryStatus;
  deliveryProvider?: string | null;
  trackingNumber?: string | null;
  deliveryFee?: string;
  collectionStatus?: CollectionStatus;
  collectedAmount?: string;
};
