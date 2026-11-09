import assert from "node:assert/strict";
import test from "node:test";
import {
  canTransitionOrderStatus,
  calculateOrder,
  minorUnitsToMoney,
  moneyToMinorUnits,
  parseCreateOrderInput,
  parseOrderStatus,
} from "./order-validation.ts";

test("validates and normalizes order input without accepting duplicate products", () => {
  assert.deepEqual(
    parseCreateOrderInput({
      clientRequestId: "123e4567-e89b-12d3-a456-426614174000",
      customerName: "  سارة  ",
      customerPhone: "+967 700 000 000",
      items: [{ productId: "product-1", quantity: 2 }],
    }),
    {
      clientRequestId: "123e4567-e89b-12d3-a456-426614174000",
      customerName: "سارة",
      customerPhone: "+967 700 000 000",
      deliveryAddress: null,
      notes: "",
      sourceMetaInboxItemId: null,
      items: [{ productId: "product-1", quantity: 2 }],
    },
  );
  assert.equal(
    parseCreateOrderInput({
      clientRequestId: "123e4567-e89b-12d3-a456-426614174000",
      customerName: "سارة",
      items: [
        { productId: "product-1", quantity: 1 },
        { productId: "product-1", quantity: 2 },
      ],
    }),
    null,
  );
  assert.equal(
    parseCreateOrderInput({
      clientRequestId: "123e4567-e89b-12d3-a456-426614174000",
      customerName: "سارة",
      items: [{ productId: "product-1", quantity: 0 }],
    }),
    null,
  );
});

test("allows only explicit forward transitions and cancellation before shipment", () => {
  assert.equal(canTransitionOrderStatus("draft", "confirmed"), true);
  assert.equal(canTransitionOrderStatus("confirmed", "preparing"), true);
  assert.equal(canTransitionOrderStatus("preparing", "cancelled"), true);
  assert.equal(canTransitionOrderStatus("shipped", "cancelled"), false);
  assert.equal(canTransitionOrderStatus("completed", "confirmed"), false);
  assert.equal(parseOrderStatus("unknown"), null);
});

test("converts money through integer minor units to avoid floating point drift", () => {
  assert.equal(moneyToMinorUnits("129.95"), 12995);
  assert.equal(moneyToMinorUnits("0"), 0);
  assert.equal(moneyToMinorUnits("1.999"), null);
  assert.equal(moneyToMinorUnits("-1"), null);
  assert.equal(minorUnitsToMoney(12995), "129.95");
});

test("calculates order totals from current verified product prices", () => {
  const products = [
    {
      id: "product-1",
      sku: "P-1",
      name: "منتج أول",
      price: "19.95",
      currency: "SAR",
      availability: "in_stock",
      status: "active",
      verifiedAt: new Date("2026-11-09T00:00:00.000Z"),
    },
    {
      id: "product-2",
      sku: null,
      name: "منتج ثان",
      price: "10",
      currency: "SAR",
      availability: "preorder",
      status: "active",
      verifiedAt: new Date("2026-11-09T00:00:00.000Z"),
    },
  ];
  assert.deepEqual(
    calculateOrder(
      [
        { productId: "product-1", quantity: 2 },
        { productId: "product-2", quantity: 1 },
      ],
      products,
    ),
    {
      order: {
        currency: "SAR",
        total: "49.90",
        items: [
          {
            productId: "product-1",
            productName: "منتج أول",
            productSku: "P-1",
            quantity: 2,
            unitPrice: "19.95",
            lineTotal: "39.90",
          },
          {
            productId: "product-2",
            productName: "منتج ثان",
            productSku: null,
            quantity: 1,
            unitPrice: "10.00",
            lineTotal: "10.00",
          },
        ],
      },
    },
  );
  assert.deepEqual(
    calculateOrder(
      [
        { productId: "product-1", quantity: 1 },
        { productId: "product-2", quantity: 1 },
      ],
      [{ ...products[0], currency: "YER" }, products[1]],
    ),
    { error: "INVALID_PRODUCT_PRICE" },
  );
  assert.deepEqual(
    calculateOrder(
      [{ productId: "product-1", quantity: 1 }],
      [{ ...products[0], availability: "out_of_stock" }],
    ),
    { error: "PRODUCT_NOT_ORDERABLE" },
  );
  assert.deepEqual(
    calculateOrder(
      [{ productId: "product-1", quantity: 1 }],
      [{ ...products[0], verifiedAt: null }],
    ),
    { error: "PRODUCT_NOT_ORDERABLE" },
  );
});
