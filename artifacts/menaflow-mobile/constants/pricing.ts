/**
 * Landing-page pricing.
 *
 * Mirrors `subscriptionPlans` in artifacts/api-server/src/lib/subscriptions.ts,
 * which is the source of truth for enforcement. Keep the two in sync until the
 * API exposes a public plans endpoint (today `/api/subscription` is
 * workspace-scoped and requires auth).
 *
 * The paid plans all allow the same three channels, so the channel limit is
 * only listed on the free plan and stated once under the pricing section —
 * repeating it in every card made the paid tiers look identical.
 */
export type MarketingPlan = {
  id: "free" | "starter" | "growth";
  name: string;
  monthlyPriceUsd: number;
  description: string;
  limits: string[];
};

export const marketingPlans: MarketingPlan[] = [
  {
    id: "free",
    name: "مجاني",
    monthlyPriceUsd: 0,
    description: "للبدء وتنظيم سير العمل الأساسي.",
    limits: [
      "10 منشورات شهريًا",
      "10 عمليات توليد بالذكاء الاصطناعي شهريًا",
      "قناتان من أصل ثلاث",
    ],
  },
  {
    id: "starter",
    name: "بداية",
    monthlyPriceUsd: 9,
    description: "لإدارة نشاطك بمساحة أكبر للنشر.",
    limits: [
      "100 منشور شهريًا",
      "100 عملية توليد بالذكاء الاصطناعي شهريًا",
      "القنوات الثلاث كاملة",
    ],
  },
  {
    id: "growth",
    name: "نمو",
    monthlyPriceUsd: 29,
    description: "لأحجام عمل تحتاج إلى حدود استخدام أعلى.",
    limits: [
      "500 منشور شهريًا",
      "500 عملية توليد بالذكاء الاصطناعي شهريًا",
      "القنوات الثلاث كاملة",
    ],
  },
];

export const channelNote =
  "القنوات الثلاث هي فيسبوك وإنستغرام وواتساب؛ تستطيع ربطها ضمن مساحة العمل بعد إنشاء الحساب.";
