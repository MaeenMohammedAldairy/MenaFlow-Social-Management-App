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
import { channelNote, marketingPlans } from "@/constants/pricing";

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

const faqs = [
  {
    id: "whatsapp",
    question: "هل يعمل مع واتساب أعمال؟",
    answer:
      "نعم. تربط واتساب أعمال بمساحة العمل من قسم المصادر، فتصل الرسائل الواردة وتظهر بجانب محادثات فيسبوك وإنستغرام.",
  },
  {
    id: "start",
    question: "هل أحتاج بطاقة بنكية للبدء؟",
    answer:
      "لا. الخطة المجانية تكفي لتجربة النشر وتنظيم الطلبات، والباقات المدفوعة اختيارية ومعروضة حاليًا للتعريف بحدودها.",
  },
  {
    id: "platforms",
    question: "أي المنصات مدعومة؟",
    answer:
      "فيسبوك وإنستغرام عبر Meta، وواتساب أعمال. يتم ربط الحسابات من قسم الحسابات داخل التطبيق.",
  },
  {
    id: "arabic",
    question: "هل الواجهة عربية بالكامل؟",
    answer:
      "نعم، على تطبيق الجوال ونسخة الويب من اليمين إلى اليسار. والأرقام تُعرض لاتينية لتطابق ما تكتبه في الأسعار وأرقام الطلبات.",
  },
  {
    id: "data",
    question: "أين تُخزَّن بياناتي؟",
    answer:
      "بيانات كل مساحة عمل معزولة عن غيرها، وتفاصيل المعالجة والحذف موضّحة في سياسة الخصوصية.",
  },
];

const steps = [
  {
    number: "1",
    title: "أنشئ حسابك",
    description: "سجّل بياناتك وأنشئ مساحة العمل الخاصة بنشاطك.",
  },
  {
    number: "2",
    title: "اربط قنواتك",
    description: "اختر الحسابات ومصادر الرسائل التي تريد إدارتها.",
  },
  {
    number: "3",
    title: "ابدأ التنظيم",
    description: "تابع المحتوى والمحادثات والمنتجات والطلبات من لوحة واحدة.",
  },
];

const sectionLinks = [
  { key: 'features', label: 'المزايا' },
  { key: 'pricing', label: 'الأسعار' },
  { key: 'faq', label: 'الأسئلة الشائعة' },
];

export function MarketingLandingPage() {
  const colors = useColors();
  const [openFaq, setOpenFaq] = React.useState<string | null>(null);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionOffsets = React.useRef<Record<string, number>>({});
  const scrollToSection = (key: string) => {
    const offset = sectionOffsets.current[key];
    if (offset === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, offset - 16), animated: true });
  };
  const { width } = useWindowDimensions();
  const compact = width < 720;
  const showThreeColumns = width >= 980;
  const contentWidth = Math.min(width - (compact ? 28 : 48), 1120);

  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
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
                accessibilityLabel="شعار MenaFlow"
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

          {compact ? null : (
            <View style={styles.sectionNav}>
              {sectionLinks.map((link) => (
                <Pressable
                  key={link.key}
                  accessibilityRole="link"
                  onPress={() => scrollToSection(link.key)}
                  style={styles.sectionNavLink}
                >
                  <Text
                    style={[
                      styles.sectionNavText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {link.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

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
                  لمتاجر فيسبوك وإنستغرام وواتساب
                </Text>
              </View>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[
                  styles.heroTitle,
                  compact && styles.heroTitleCompact,
                  { color: colors.foreground },
                ]}
              >
                رسالة واتساب واحدة… تصبح منشورًا مجدولًا وطلبًا مُتابَعًا
              </Text>
              <Text
                style={[
                  styles.heroDescription,
                  compact && styles.heroDescriptionCompact,
                  { color: colors.mutedForeground },
                ]}
              >
                بدل التنقّل بين تطبيق النشر وجداول الطلبات ومحادثات واتساب،
                اجمع المحتوى والرسائل والطلبات في مساحة عمل عربية واحدة.
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
                      compact && styles.primaryCtaCompact,
                      { backgroundColor: colors.primary },
                    ])}
                  >
                    <Text
                      style={[
                        styles.ctaText,
                        compact && styles.ctaTextCompact,
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
                      compact && styles.secondaryCtaCompact,
                      { borderColor: colors.border },
                    ])}
                  >
                    <Text
                      style={[
                        styles.ctaText,
                        compact && styles.ctaTextCompact,
                        { color: colors.foreground },
                      ]}
                    >
                      {compact ? "تسجيل الدخول" : "لدي حساب بالفعل"}
                    </Text>
                  </Pressable>
                </Link>
              </View>
              <Text
                style={[
                  styles.heroNote,
                  compact && styles.heroNoteCompact,
                  { color: colors.mutedForeground },
                ]}
              >
                خطة مجانية للبدء؛ لا يلزم اختيار باقة مدفوعة.
              </Text>
            </View>
            <View
              style={[
                styles.heroVisual,
                compact && styles.heroVisualCompact,
                { backgroundColor: colors.accent, borderColor: colors.border },
              ]}
              accessible
              accessibilityRole="image"
              accessibilityLabel="معاينة مساحة عمل لإدارة المحتوى والمحادثات والطلبات"
            >
              <View
                style={[
                  styles.visualTop,
                  compact && styles.visualTopCompact,
                  { backgroundColor: colors.card },
                ]}
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
              <View
                style={[
                  styles.visualStats,
                  compact && styles.visualStatsCompact,
                ]}
              >
                {[
                  ["منشورات", "تنظيم المحتوى"],
                  ["محادثات", "متابعة الرسائل"],
                  ["طلبات", "سير عمل أوضح"],
                ].map(([label, caption]) => (
                  <View
                    key={label}
                    style={[
                      styles.visualStat,
                      compact && styles.visualStatCompact,
                      { backgroundColor: colors.card },
                    ]}
                  >
                    <Text
                      style={[
                        styles.visualStatLabel,
                        compact && styles.visualStatLabelCompact,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {label}
                    </Text>
                    <Text
                      style={[
                        styles.visualStatCaption,
                        compact && styles.visualStatCaptionCompact,
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

          <View
            style={[styles.section, compact && styles.sectionCompact]}
            nativeID="features"
            onLayout={(event) => {
              sectionOffsets.current["features"] = event.nativeEvent.layout.y;
            }}
          >
            <SectionHeading
              compact={compact}
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

          <View
            style={[
              styles.section,
              compact && styles.sectionCompact,
              { backgroundColor: colors.secondary },
            ]}
          >
            <SectionHeading
              compact={compact}
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
                    compact && styles.stepCardCompact,
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

          <View
            style={[styles.section, compact && styles.sectionCompact]}
            nativeID="pricing"
            onLayout={(event) => {
              sectionOffsets.current["pricing"] = event.nativeEvent.layout.y;
            }}
          >
            <SectionHeading
              compact={compact}
              eyebrow="الأسعار"
              title="اختر حدود الاستخدام المناسبة لك"
              description="الأسعار الشهرية وحدود الاستخدام المعروضة مبنية على إعدادات الباقات الحالية."
            />
            <View style={[styles.planGrid, compact && styles.column]}>
              {marketingPlans.map((plan, index) => (
                <View
                  key={plan.id}
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
                      {`$${plan.monthlyPriceUsd}`}
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
            <Text
              style={[styles.pricingNotice, { color: colors.mutedForeground }]}
            >
              {channelNote}
            </Text>
          </View>

          <View
            style={[styles.section, compact && styles.sectionCompact]}
            nativeID="faq"
            onLayout={(event) => {
              sectionOffsets.current["faq"] = event.nativeEvent.layout.y;
            }}
          >
            <SectionHeading
              compact={compact}
              eyebrow="الأسئلة الشائعة"
              title="ما يُسأل عنه قبل البدء"
              description="إجابات موجزة عن الربط والبيانات والبدء."
            />
            <View style={styles.faqList}>
              {faqs.map((item) => {
                const open = openFaq === item.id;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.faqItem,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={item.question}
                      onPress={() => setOpenFaq(open ? null : item.id)}
                      style={styles.faqQuestion}
                    >
                      <Text
                        style={[
                          styles.faqQuestionText,
                          { color: colors.foreground },
                        ]}
                      >
                        {item.question}
                      </Text>
                      <Icon
                        name={open ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                    {open ? (
                      <Text
                        style={[
                          styles.faqAnswer,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {item.answer}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
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
                <Pressable
                  accessibilityRole="link"
                  style={styles.footerLinkTapTarget}
                >
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
                <Pressable
                  accessibilityRole="link"
                  style={styles.footerLinkTapTarget}
                >
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
  compact = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  compact?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      style={[styles.sectionHeading, compact && styles.sectionHeadingCompact]}
    >
      <Text style={[styles.sectionEyebrow, { color: colors.primary }]}>
        {eyebrow}
      </Text>
      <Text
        accessibilityRole="header"
        aria-level={2}
        style={[
          styles.sectionTitle,
          compact && styles.sectionTitleCompact,
          { color: colors.foreground },
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.sectionDescription,
          compact && styles.sectionDescriptionCompact,
          { color: colors.mutedForeground },
        ]}
      >
        {description}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 10,
  },
  sectionNavLink: { paddingHorizontal: 8, paddingVertical: 6 },
  sectionNavText: { fontSize: 14, fontWeight: "600" },
  faqList: { gap: 10, width: "100%" },
  faqItem: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  faqQuestion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  faqQuestionText: { flex: 1, fontSize: 15, fontWeight: "700" },
  faqAnswer: { fontSize: 14, lineHeight: 24, textAlign: "right" },
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
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
  },
  headerPrimary: {
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 15,
  },
  headerLinkText: { fontSize: 13, fontWeight: "700" },
  hero: {
    marginTop: 24,
    padding: 28,
    borderWidth: 1,
    borderRadius: 26,
    flexDirection: "row",
    alignItems: "center",
    gap: 28,
  },
  heroCompact: {
    marginTop: 16,
    padding: 16,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 14,
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
  heroTitleCompact: { fontSize: 30, lineHeight: 43 },
  heroDescription: { maxWidth: 620, fontSize: 16, lineHeight: 28 },
  heroDescriptionCompact: { fontSize: 14, lineHeight: 23 },
  heroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  heroActionsCompact: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 8,
  },
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
  primaryCtaCompact: { flex: 1, minWidth: 0, paddingHorizontal: 10 },
  secondaryCtaCompact: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
  ctaText: { fontSize: 14, fontWeight: "800" },
  ctaTextCompact: { fontSize: 12 },
  heroNote: { fontSize: 12, lineHeight: 20 },
  heroNoteCompact: { fontSize: 12, lineHeight: 18 },
  heroVisual: {
    width: 300,
    maxWidth: "100%",
    borderRadius: 22,
    borderWidth: 1,
    padding: 13,
    gap: 10,
  },
  heroVisualCompact: { width: "100%", padding: 10, gap: 7 },
  visualTop: {
    minHeight: 42,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  visualTopCompact: { minHeight: 36 },
  visualDot: { width: 8, height: 8, borderRadius: 4 },
  visualLabel: { fontSize: 13, fontWeight: "800" },
  visualStats: { gap: 8 },
  visualStatsCompact: { flexDirection: "row", gap: 6 },
  visualStat: {
    minHeight: 58,
    borderRadius: 12,
    justifyContent: "center",
    paddingHorizontal: 12,
    gap: 2,
  },
  visualStatCompact: {
    flex: 1,
    minHeight: 62,
    alignItems: "center",
    paddingHorizontal: 3,
  },
  visualStatLabel: { fontSize: 12 },
  visualStatLabelCompact: { fontSize: 12, textAlign: "center" },
  visualStatCaption: { fontSize: 13, fontWeight: "700" },
  visualStatCaptionCompact: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  section: { marginTop: 22, padding: 24, borderRadius: 24 },
  sectionCompact: { marginTop: 16, padding: 18 },
  sectionHeading: { alignItems: "center", gap: 7, marginBottom: 18 },
  sectionHeadingCompact: { gap: 5, marginBottom: 14 },
  sectionEyebrow: { fontSize: 12, fontWeight: "800" },
  sectionTitle: {
    fontSize: 25,
    lineHeight: 36,
    fontWeight: "900",
    textAlign: "center",
  },
  sectionTitleCompact: { fontSize: 21, lineHeight: 30 },
  sectionDescription: { fontSize: 14, lineHeight: 23, textAlign: "center" },
  sectionDescriptionCompact: { fontSize: 13, lineHeight: 21 },
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
  stepCardCompact: { padding: 14 },
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
    minHeight: 44,
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
  footerLinkTapTarget: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  footerLink: { fontSize: 12, textDecorationLine: "underline" },
});
