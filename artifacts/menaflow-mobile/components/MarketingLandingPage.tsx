import React from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { Link } from "expo-router";
import { CairoText as Text } from "@/components/CairoTypography";
import {
  LucideIcon as Icon,
  type LucideIconName,
} from "@/components/LucideIcon";
import { useColors } from "@/hooks/useColors";

const features: Array<{
  icon: LucideIconName;
  title: string;
  description: string;
}> = [
  {
    icon: "send",
    title: "تنظيم النشر",
    description:
      "أنشئ محتوى قنواتك الاجتماعية وتابع حالة المنشورات من مساحة عمل واحدة.",
  },
  {
    icon: "message-square",
    title: "متابعة المحادثات",
    description:
      "اجمع محادثات Meta ورسائل WhatsApp المرتبطة بمساحة العمل في تدفق واضح.",
  },
  {
    icon: "package",
    title: "كتالوج المنتجات والطلبات",
    description:
      "نظّم بيانات المنتجات وتابع طلبات العملاء المرتبطة بالمحادثات.",
  },
  {
    icon: "bar-chart-2",
    title: "تقارير الأداء",
    description:
      "راجع مؤشرات المحتوى والقنوات لمتابعة ما نُشر وما يحتاج إلى إجراء.",
  },
];

const plans = [
  {
    name: "مجاني",
    price: "$0",
    description: "للبدء وتنظيم سير العمل الأساسي.",
    limits: [
      "10 منشورات شهريًا",
      "10 عمليات توليد بالذكاء الاصطناعي شهريًا",
      "حتى قناتين",
    ],
  },
  {
    name: "بداية",
    price: "$9",
    description: "لإدارة نشاطك بمساحة أكبر للنشر.",
    limits: [
      "100 منشور شهريًا",
      "100 عملية توليد بالذكاء الاصطناعي شهريًا",
      "حتى 3 قنوات",
    ],
  },
  {
    name: "نمو",
    price: "$29",
    description: "لأحجام عمل تحتاج إلى حدود استخدام أعلى.",
    limits: [
      "500 منشور شهريًا",
      "500 عملية توليد بالذكاء الاصطناعي شهريًا",
      "حتى 3 قنوات",
    ],
  },
];

const steps = [
  {
    number: "١",
    title: "أنشئ حسابك",
    description: "سجّل بياناتك وأنشئ مساحة العمل الخاصة بنشاطك.",
  },
  {
    number: "٢",
    title: "اربط قنواتك",
    description: "اختر الحسابات ومصادر الرسائل التي تريد إدارتها.",
  },
  {
    number: "٣",
    title: "ابدأ التنظيم",
    description: "تابع المحتوى والمحادثات والمنتجات والطلبات من لوحة واحدة.",
  },
];

export function MarketingLandingPage() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const showThreeColumns = width >= 980;
  const contentWidth = Math.min(width - (compact ? 28 : 48), 1120);

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.content,
            { width: contentWidth, maxWidth: contentWidth },
          ]}
        >
          <View
            style={[
              styles.header,
              compact && styles.headerCompact,
              { borderBottomColor: colors.border },
            ]}
          >
            <View style={styles.brand}>
              <Image
                source={require("../assets/images/icon.png")}
                style={styles.brandIcon}
              />
              <Text style={[styles.brandName, { color: colors.foreground }]}>
                MenaFlow
              </Text>
            </View>
            <View
              style={[
                styles.headerActions,
                compact && styles.headerActionsCompact,
              ]}
            >
              <Link href="/(auth)/sign-in" asChild>
                <Pressable
                  accessibilityRole="button"
                  style={StyleSheet.flatten([
                    styles.headerLink,
                    { borderColor: colors.border },
                  ])}
                >
                  <Text
                    style={[
                      styles.headerLinkText,
                      { color: colors.foreground },
                    ]}
                  >
                    تسجيل الدخول
                  </Text>
                </Pressable>
              </Link>
              <Link href="/(auth)/sign-up" asChild>
                <Pressable
                  accessibilityRole="button"
                  style={StyleSheet.flatten([
                    styles.headerPrimary,
                    { backgroundColor: colors.primary },
                  ])}
                >
                  <Text
                    style={[
                      styles.headerLinkText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    إنشاء حساب
                  </Text>
                </Pressable>
              </Link>
            </View>
          </View>

          <View
            style={[
              styles.hero,
              compact && styles.heroCompact,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.heroCopy}>
              <View
                style={[styles.eyebrow, { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.eyebrowText, { color: colors.primary }]}>
                  إدارة التواصل من مكان واحد
                </Text>
              </View>
              <Text style={[styles.heroTitle, { color: colors.foreground }]}>
                نظّم محتواك ومحادثات عملائك مع MenaFlow
              </Text>
              <Text
                style={[
                  styles.heroDescription,
                  { color: colors.mutedForeground },
                ]}
              >
                مساحة عمل تساعدك على متابعة النشر، والرسائل، والمنتجات، والطلبات
                ضمن تجربة عربية واضحة.
              </Text>
              <View
                style={[
                  styles.heroActions,
                  compact && styles.heroActionsCompact,
                ]}
              >
                <Link href="/(auth)/sign-up" asChild>
                  <Pressable
                    accessibilityRole="button"
                    style={StyleSheet.flatten([
                      styles.primaryCta,
                      { backgroundColor: colors.primary },
                    ])}
                  >
                    <Text
                      style={[
                        styles.ctaText,
                        { color: colors.primaryForeground },
                      ]}
                    >
                      ابدأ مجانًا
                    </Text>
                    <Icon
                      name="chevron-left"
                      size={18}
                      color={colors.primaryForeground}
                    />
                  </Pressable>
                </Link>
                <Link href="/(auth)/sign-in" asChild>
                  <Pressable
                    accessibilityRole="button"
                    style={StyleSheet.flatten([
                      styles.secondaryCta,
                      { borderColor: colors.border },
                    ])}
                  >
                    <Text
                      style={[styles.ctaText, { color: colors.foreground }]}
                    >
                      لدي حساب بالفعل
                    </Text>
                  </Pressable>
                </Link>
              </View>
              <Text
                style={[styles.heroNote, { color: colors.mutedForeground }]}
              >
                ابدأ بالخطة المجانية؛ لا يلزم اختيار باقة مدفوعة لإنشاء حساب.
              </Text>
            </View>
            <View
              style={[
                styles.heroVisual,
                { backgroundColor: colors.accent, borderColor: colors.border },
              ]}
            >
              <View
                style={[styles.visualTop, { backgroundColor: colors.card }]}
              >
                <View
                  style={[
                    styles.visualDot,
                    { backgroundColor: colors.primary },
                  ]}
                />
                <Text
                  style={[styles.visualLabel, { color: colors.foreground }]}
                >
                  مساحة العمل
                </Text>
              </View>
              <View style={styles.visualStats}>
                {[
                  ["منشورات", "تنظيم المحتوى"],
                  ["محادثات", "متابعة الرسائل"],
                  ["طلبات", "سير عمل أوضح"],
                ].map(([label, caption]) => (
                  <View
                    key={label}
                    style={[
                      styles.visualStat,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.visualStatLabel,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {label}
                    </Text>
                    <Text
                      style={[
                        styles.visualStatCaption,
                        { color: colors.foreground },
                      ]}
                    >
                      {caption}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <SectionHeading
              eyebrow="ماذا يمكنك أن تدير؟"
              title="أدوات مترابطة لعملك اليومي"
              description="تابع المهام الأساسية لقنواتك الاجتماعية وعملياتك من لوحة واحدة."
            />
            <View style={[styles.featureGrid, compact && styles.column]}>
              {features.map((feature) => (
                <View
                  key={feature.title}
                  style={[
                    styles.featureCard,
                    compact ? styles.fullWidth : styles.halfWidth,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.featureIcon,
                      { backgroundColor: colors.accent },
                    ]}
                  >
                    <Icon
                      name={feature.icon}
                      size={20}
                      color={colors.primary}
                    />
                  </View>
                  <Text
                    style={[styles.featureTitle, { color: colors.foreground }]}
                  >
                    {feature.title}
                  </Text>
                  <Text
                    style={[
                      styles.featureDescription,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {feature.description}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[styles.section, { backgroundColor: colors.secondary }]}>
            <SectionHeading
              eyebrow="طريقة البدء"
              title="ثلاث خطوات للانطلاق"
              description="إعداد بسيط يعرّفك على مساحة العمل قبل البدء باستخدامها."
            />
            <View style={[styles.stepGrid, compact && styles.column]}>
              {steps.map((step) => (
                <View
                  key={step.number}
                  style={[
                    styles.stepCard,
                    compact || !showThreeColumns
                      ? styles.halfWidth
                      : styles.thirdWidth,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.stepNumber, { color: colors.primary }]}>
                    {step.number}
                  </Text>
                  <Text
                    style={[styles.featureTitle, { color: colors.foreground }]}
                  >
                    {step.title}
                  </Text>
                  <Text
                    style={[
                      styles.featureDescription,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {step.description}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section} nativeID="pricing">
            <SectionHeading
              eyebrow="الأسعار"
              title="اختر حدود الاستخدام المناسبة لك"
              description="الأسعار الشهرية وحدود الاستخدام المعروضة مبنية على إعدادات الباقات الحالية."
            />
            <View style={[styles.planGrid, compact && styles.column]}>
              {plans.map((plan, index) => (
                <View
                  key={plan.name}
                  style={[
                    styles.planCard,
                    compact ? styles.fullWidth : styles.planWidth,
                    {
                      backgroundColor: colors.card,
                      borderColor: index === 2 ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.planName, { color: colors.foreground }]}>
                    {plan.name}
                  </Text>
                  <Text
                    style={[
                      styles.planDescription,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {plan.description}
                  </Text>
                  <View style={styles.priceLine}>
                    <Text style={[styles.price, { color: colors.foreground }]}>
                      {plan.price}
                    </Text>
                    <Text
                      style={[
                        styles.pricePeriod,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      دولار أمريكي / شهر
                    </Text>
                  </View>
                  <View style={styles.planLimits}>
                    {plan.limits.map((limit) => (
                      <View key={limit} style={styles.limitRow}>
                        <Icon name="check" size={16} color={colors.primary} />
                        <Text
                          style={[
                            styles.limitText,
                            { color: colors.foreground },
                          ]}
                        >
                          {limit}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <Link href="/(auth)/sign-up" asChild>
                    <Pressable
                      accessibilityRole="button"
                      style={StyleSheet.flatten([
                        styles.planButton,
                        index === 2
                          ? { backgroundColor: colors.primary }
                          : { borderColor: colors.border },
                      ])}
                    >
                      <Text
                        style={[
                          styles.planButtonText,
                          {
                            color:
                              index === 2
                                ? colors.primaryForeground
                                : colors.foreground,
                          },
                        ]}
                      >
                        إنشاء حساب
                      </Text>
                    </Pressable>
                  </Link>
                </View>
              ))}
            </View>
            <Text
              style={[styles.pricingNotice, { color: colors.mutedForeground }]}
            >
              الأسعار بالدولار الأمريكي وفق الإعدادات الحالية. الدفع الإلكتروني
              والاشتراكات المدفوعة غير مفعّلة حاليًا؛ الباقات المدفوعة معروضة
              للتعريف بحدودها فقط.
            </Text>
          </View>

          <View
            style={[
              styles.footer,
              { borderTopColor: colors.border },
              compact && styles.footerCompact,
            ]}
          >
            <Text
              style={[styles.footerText, { color: colors.mutedForeground }]}
            >
              MenaFlow — مساحة عمل لتنظيم المحتوى والمحادثات والطلبات.
            </Text>
            <View style={styles.footerLinks}>
              <Link href="/(auth)/terms" asChild>
                <Pressable accessibilityRole="link">
                  <Text
                    style={[
                      styles.footerLink,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    الشروط والأحكام
                  </Text>
                </Pressable>
              </Link>
              <Link href="/(auth)/privacy" asChild>
                <Pressable accessibilityRole="link">
                  <Text
                    style={[
                      styles.footerLink,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    سياسة الخصوصية
                  </Text>
                </Pressable>
              </Link>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.sectionHeading}>
      <Text style={[styles.sectionEyebrow, { color: colors.primary }]}>
        {eyebrow}
      </Text>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
        {title}
      </Text>
      <Text
        style={[styles.sectionDescription, { color: colors.mutedForeground }]}
      >
        {description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center" },
  scrollContent: { width: "100%", alignItems: "center", paddingBottom: 24 },
  content: { alignSelf: "center" },
  header: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    gap: 14,
  },
  headerCompact: { minHeight: 72, flexWrap: "wrap", paddingVertical: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 9 },
  brandIcon: { width: 35, height: 35, borderRadius: 10 },
  brandName: { fontSize: 20, fontWeight: "900" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  headerActionsCompact: { gap: 7 },
  headerLink: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
  },
  headerPrimary: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 15,
  },
  headerLinkText: { fontSize: 13, fontWeight: "700" },
  hero: {
    marginTop: 28,
    padding: 28,
    borderWidth: 1,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
  },
  heroCompact: {
    padding: 20,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 20,
  },
  heroCopy: { flex: 1, gap: 13 },
  eyebrow: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  eyebrowText: { fontSize: 12, fontWeight: "800" },
  heroTitle: { maxWidth: 650, fontSize: 38, lineHeight: 54, fontWeight: "900" },
  heroDescription: { maxWidth: 620, fontSize: 16, lineHeight: 28 },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  heroActionsCompact: { flexDirection: "column", alignItems: "stretch" },
  primaryCta: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryCta: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 14, fontWeight: "800" },
  heroNote: { fontSize: 12, lineHeight: 20 },
  heroVisual: {
    width: 300,
    maxWidth: "100%",
    borderRadius: 22,
    borderWidth: 1,
    padding: 13,
    gap: 10,
  },
  visualTop: {
    minHeight: 42,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  visualDot: { width: 8, height: 8, borderRadius: 4 },
  visualLabel: { fontSize: 13, fontWeight: "800" },
  visualStats: { gap: 8 },
  visualStat: {
    minHeight: 58,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 2,
  },
  visualStatLabel: { fontSize: 11 },
  visualStatCaption: { fontSize: 13, fontWeight: "700" },
  section: { marginTop: 22, padding: 24, borderRadius: 24 },
  sectionHeading: { alignItems: "center", gap: 7, marginBottom: 18 },
  sectionEyebrow: { fontSize: 12, fontWeight: "800" },
  sectionTitle: {
    fontSize: 25,
    lineHeight: 36,
    fontWeight: "900",
    textAlign: "center",
  },
  sectionDescription: { fontSize: 14, lineHeight: 23, textAlign: "center" },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  column: { flexDirection: "column" },
  featureCard: {
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 17,
    gap: 9,
  },
  halfWidth: { width: "48%" },
  fullWidth: { width: "100%" },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  featureTitle: { fontSize: 16, fontWeight: "800" },
  featureDescription: { fontSize: 13, lineHeight: 22 },
  stepGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  stepCard: {
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  thirdWidth: { width: "31%" },
  stepNumber: { fontSize: 25, fontWeight: "900" },
  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  planCard: {
    flexGrow: 1,
    minWidth: 220,
    borderWidth: 1,
    borderRadius: 18,
    padding: 17,
    gap: 11,
  },
  planWidth: { width: "31%" },
  planName: { fontSize: 18, fontWeight: "900" },
  planDescription: { minHeight: 40, fontSize: 12, lineHeight: 20 },
  priceLine: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 7,
    flexWrap: "wrap",
  },
  price: { fontSize: 32, fontWeight: "900" },
  pricePeriod: { fontSize: 12 },
  planLimits: { gap: 9, flexGrow: 1, paddingVertical: 5 },
  limitRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  limitText: { flex: 1, fontSize: 12, lineHeight: 19 },
  planButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  planButtonText: { fontSize: 13, fontWeight: "800" },
  pricingNotice: {
    marginTop: 13,
    fontSize: 12,
    lineHeight: 21,
    textAlign: "center",
  },
  footer: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  footerCompact: { flexDirection: "column", alignItems: "stretch" },
  footerText: { fontSize: 12, lineHeight: 20 },
  footerLinks: {
    flexDirection: "row",
    alignItems: "center",
    gap: 15,
    flexWrap: "wrap",
  },
  footerLink: { fontSize: 12, textDecorationLine: "underline" },
});
