/**
 * Landing-page pricing.
 *
 * Mirrors `subscriptionPlans` in artifacts/api-server/src/lib/plan-catalog.ts,
 * which is the source of truth for enforcement (served publicly at GET /plans).
 * The numeric limits below are checked against that catalogue by
 * `constants/pricing.test.mjs`, so a plan change cannot drift silently.
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

/** Numeric limits, kept in step with the server catalogue by a parity test. */
export const marketingPlanLimits = {
  free: { postsCreated: 10, aiGenerations: 10, channels: 2 },
  starter: { postsCreated: 100, aiGenerations: 100, channels: 3 },
  growth: { postsCreated: 500, aiGenerations: 500, channels: 3 },
} as const;

export const marketingPlanPrices = {
  free: 0,
  starter: 9,
  growth: 29,
} as const;

const postsLimit = (plan: keyof typeof marketingPlanLimits) =>
  `${marketingPlanLimits[plan].postsCreated} منشورات شهريًا`;
const aiLimit = (plan: keyof typeof marketingPlanLimits) =>
  `${marketingPlanLimits[plan].aiGenerations} عملية توليد بالذكاء الاصطناعي شهريًا`;
const channelsLimit = (plan: keyof typeof marketingPlanLimits) =>
  marketingPlanLimits[plan].channels >= 3
    ? "القنوات الثلاث كاملة"
    : "قناتان من أصل ثلاث";

export const marketingPlans: MarketingPlan[] = [
  {
    id: "free",
    name: "مجاني",
    monthlyPriceUsd: marketingPlanPrices.free,
    description: "للبدء وتنظيم سير العمل الأساسي.",
    limits: [postsLimit("free"), aiLimit("free"), channelsLimit("free")],
  },
  {
    id: "starter",
    name: "بداية",
    monthlyPriceUsd: marketingPlanPrices.starter,
    description: "لإدارة نشاطك بمساحة أكبر للنشر.",
    limits: [
      postsLimit("starter"),
      aiLimit("starter"),
      channelsLimit("starter"),
    ],
  },
  {
    id: "growth",
    name: "نمو",
    monthlyPriceUsd: marketingPlanPrices.growth,
    description: "لأحجام عمل تحتاج إلى حدود استخدام أعلى.",
    limits: [
      postsLimit("growth"),
      aiLimit("growth"),
      channelsLimit("growth"),
    ],
  },
];

export const channelNote =
  "القنوات الثلاث هي فيسبوك وإنستغرام وواتساب؛ تستطيع ربطها ضمن مساحة العمل بعد إنشاء الحساب.";
