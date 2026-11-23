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
import colors from "@/constants/colors";
import { channelNote, marketingPlans } from "@/constants/pricing";

/**
 * Marketing landing page.
 *
 * Fixed light palette derived from `constants/colors.ts` so the public landing
 * site uses the exact same MenaFlow color identity as the app and stays light
 * even when the user's device prefers dark mode.
 */
const palette = {
  ink: colors.light.foreground,
  inkSoft: colors.light.mutedForeground,
  green: colors.light.primary,
  greenDark: colors.light.accentForeground,
  greenSoft: colors.light.accent,
  mintArt: colors.light.accent,
  mintSoft: colors.light.background,
  border: colors.light.border,
  white: colors.light.card,
  shadow: colors.light.shadow,
  phoneSurface: colors.dark.background,
  phoneNotch: colors.dark.border,
  phoneRowSurface: colors.dark.card,
  phoneBadgeSurface: colors.dark.accent,
  phoneBadgeText: colors.dark.primary,
  phoneRowText: colors.dark.foreground,
  phoneRowMuted: colors.dark.mutedForeground,
  ctaGlow: colors.light.accentForeground,
  ctaSubtext: colors.light.accent,
};

const features: Array<{
  icon: LucideIconName;
  title: string;
  description: string;
}> = [
  {
    icon: "message-circle",
    title: "ردود ذكية\nوتفاعل أفضل",
    description: "ردود مقترحة بلغة عميلك من محادثات واتساب وMeta.",
  },
  {
    icon: "truck",
    title: "إدارة الطلبات\nوالتوصيل",
    description: "طلبات تُنشأ من المحادثات وتُتابع حتى التسليم.",
  },
  {
    icon: "bar-chart-2",
    title: "تحليلات\nمتقدمة",
    description: "أرقام النشر والمحادثات والطلبات في تقرير واحد.",
  },
  {
    icon: "shield",
    title: "أمان عالٍ\nوحماية لبياناتك",
    description: "تشفير للرموز والرسائل الخاصة وفصل كامل للمساحات.",
  },
  {
    icon: "share-2",
    title: "ربط جميع\nقنواتك",
    description: "فيسبوك وإنستغرام وواتساب في مساحة عمل واحدة.",
  },
  {
    icon: "clock",
    title: "جدولة المنشورات\nوإدارة المحتوى",
    description: "اعتماد بشري قبل كل نشر، وسجل لما نُشر فعلًا.",
  },
];

const dashboardPoints = [
  "إدارة متعددة الأنشطة داخل مساحة عمل واحدة",
  "متابعة المبيعات والأداء من شاشة واحدة",
  "تنبيهات فورية للمهام التي تحتاج إجراءً",
];

const trustItems: Array<{ icon: LucideIconName; title: string; note: string }> = [
  {
    icon: "message-circle",
    title: "دعم عبر واتساب",
    note: "فريق يرد على أسئلتك",
  },
  {
    icon: "globe",
    title: "مصمّم للمتاجر اليمنية",
    note: "بالعربية ومن اليمين لليسار",
  },
  {
    icon: "shield",
    title: "بيانات معزولة ومشفّرة",
    note: "لكل مساحة عمل مفاتيحها",
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

const dashboardActivity: Array<{
  icon: LucideIconName;
  label: string;
  time: string;
}> = [
  { icon: "message-circle", label: "رسالة واتساب جديدة", time: "الآن" },
  { icon: "file-text", label: "مسودة منشور جاهزة", time: "قبل ٥ د" },
];

/** Ascending heights: in RTL the first bar sits on the right, so the chart
 *  reads as growth towards the left, with the newest bars highlighted. */
const chartBars = [18, 24, 21, 30, 27, 38, 46, 58];

const navLinks = [
  { key: "features", label: "المزايا" },
  { key: "dashboard", label: "لوحة التحكم" },
  { key: "pricing", label: "الأسعار" },
  { key: "faq", label: "الأسئلة" },
];

export function MarketingLandingPage() {
  const [openFaq, setOpenFaq] = React.useState<string | null>(null);
  const scrollRef = React.useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sectionOffsets = React.useRef<Record<string, number>>({});
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const narrow = width < 420;
  const wide = width >= 980;
  const contentWidth = Math.min(width - (compact ? 32 : 56), 1120);

  const scrollToSection = (key: string) => {
    const offset = sectionOffsets.current[key];
    if (offset === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, offset - 16), animated: true });
  };
  const trackSection = (key: string) => (event: { nativeEvent: { layout: { y: number } } }) => {
    sectionOffsets.current[key] = event.nativeEvent.layout.y;
  };

  return (
    <View style={styles.page}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.content, { width: contentWidth, maxWidth: contentWidth }]}>
          {/* Top bar */}
          <View style={styles.header}>
            <View style={styles.languagePill}>
              <Icon name="globe" size={15} color={palette.green} />
              <Text style={styles.languageText}>العربية</Text>
            </View>
            <View style={styles.brand}>
              <Image
                source={require("../assets/images/icon.png")}
                style={styles.brandIcon}
                accessibilityLabel="شعار MenaFlow"
              />
              <Text style={styles.brandName}>MenaFlow</Text>
            </View>
          </View>

          {compact ? null : (
            <View style={styles.navRow}>
              {navLinks.map((link) => (
                <Pressable
                  key={link.key}
                  accessibilityRole="link"
                  onPress={() => scrollToSection(link.key)}
                  style={styles.navLink}
                >
                  <Text style={styles.navText}>{link.label}</Text>
                </Pressable>
              ))}
              <Link href="/(auth)/sign-in" asChild>
                <Pressable accessibilityRole="link" style={styles.navSignIn}>
                  <Text style={styles.navSignInText}>تسجيل الدخول</Text>
                </Pressable>
              </Link>
            </View>
          )}

          {/* Hero */}
          <View style={[styles.hero, wide && styles.heroWide]}>
            <View style={[styles.heroArt, wide ? styles.heroArtWide : null]}>
              <Image
                source={require("../assets/images/landing-mascot.png")}
                style={[
                  styles.mascot,
                  narrow ? styles.mascotNarrow : null,
                  wide ? styles.mascotWide : null,
                ]}
                resizeMode="contain"
                accessibilityLabel="شخصية MenaFlow مع أيقونات فيسبوك وإنستغرام وواتساب"
              />
            </View>
            <View style={styles.heroCopy}>
              <Text accessibilityRole="header" aria-level={1} style={styles.heroTitle}>
                إدارة نشاطك التجاري
              </Text>
              <Text accessibilityRole="header" aria-level={1} style={styles.heroTitleAccent}>
                بكامل من منصة واحدة
              </Text>
              <Text style={styles.heroBody}>
                MenaFlow منصة عربية ذكية تساعدك على نشر المحتوى، والتواصل مع
                عملائك، ومعالجة الطلبات وأتمتة أعمالك بكل سهولة.
              </Text>
              <View style={[styles.heroActions, narrow && styles.heroActionsNarrow]}>
                <Link href="/(auth)/sign-up" asChild>
                  <Pressable accessibilityRole="button" style={styles.primaryCta}>
                    <Text style={styles.primaryCtaText}>ابدأ مجانًا</Text>
                    <Icon name="chevron-left" size={17} color={palette.white} />
                  </Pressable>
                </Link>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => scrollToSection("features")}
                  style={styles.secondaryCta}
                >
                  <Icon name="play" size={15} color={palette.green} />
                  <Text style={styles.secondaryCtaText}>استعرض المزايا</Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Features */}
          <View
            style={styles.featuresPanel}
            nativeID="features"
            onLayout={trackSection("features")}
          >
            <View style={styles.sectionRuleRow}>
              <View style={styles.sectionRule} />
              <Text style={styles.sectionRuleTitle}>كل ما تحتاجه في مكان واحد</Text>
              <View style={styles.sectionRule} />
            </View>
            <View style={styles.featureGrid}>
              {features.map((feature) => (
                <View
                  key={feature.title}
                  style={[
                    styles.featureCard,
                    narrow ? styles.featureCardNarrow : null,
                    narrow ? styles.featureCardRow : null,
                  ]}
                >
                  <View
                    style={[styles.featureIcon, narrow && styles.featureIconNarrow]}
                  >
                    <Icon
                      name={feature.icon}
                      size={narrow ? 16 : 20}
                      color={palette.green}
                    />
                  </View>
                  <Text
                    style={[styles.featureTitle, narrow && styles.featureTitleRow]}
                  >
                    {feature.title}
                  </Text>
                  {narrow ? null : (
                    <Text style={styles.featureDescription}>{feature.description}</Text>
                  )}
                </View>
              ))}
            </View>
          </View>

          {/* Dashboard proof */}
          <View
            style={[styles.dashboard, wide && styles.dashboardWide]}
            nativeID="dashboard"
            onLayout={trackSection("dashboard")}
          >
            <View style={[styles.dashboardCopy, wide && styles.dashboardCopyWide]}>
              <Text style={styles.dashboardTitle}>
                لوحة تحكم ذكية{"\n"}تمنحك رؤية شاملة
              </Text>
              <Text style={styles.dashboardBody}>
                تابع أداء نشاطك في الوقت الحقيقي، واتخذ أفضل القرارات لتنمية
                عملك.
              </Text>
              <View style={styles.dashboardPoints}>
                {dashboardPoints.map((point) => (
                  <View key={point} style={styles.dashboardPoint}>
                    <Icon name="check-circle" size={17} color={palette.green} />
                    <Text style={styles.dashboardPointText}>{point}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={[styles.phoneWrap, wide && styles.phoneWrapWide]}>
              <View style={styles.phone}>
                <View style={styles.phoneNotch} />
                <View style={styles.phoneHeader}>
                  <View style={styles.phoneBrandGroup}>
                    <Image
                      source={require("../assets/images/icon.png")}
                      style={styles.phoneBrandIcon}
                      accessibilityLabel="شعار MenaFlow داخل لوحة التحكم"
                    />
                    <Text style={styles.phoneBrand}>MenaFlow</Text>
                  </View>
                  <View style={styles.phoneLive}>
                    <View style={styles.phoneLiveDot} />
                    <Text style={styles.phoneLiveText}>مباشر</Text>
                  </View>
                </View>

                <View style={styles.phoneStats}>
                  {[
                    { value: "24", label: "محادثة" },
                    { value: "8", label: "طلب" },
                    { value: "12", label: "منشور" },
                  ].map((stat) => (
                    <View key={stat.label} style={styles.phoneStat}>
                      <Text style={styles.phoneStatValue}>{stat.value}</Text>
                      <Text style={styles.phoneStatLabel}>{stat.label}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.phoneCard}>
                  <View style={styles.phoneCardHead}>
                    <View style={styles.phoneCardTitleGroup}>
                      <Text style={styles.phoneCardTitle}>أداء النشاط التجاري</Text>
                      <Text style={styles.phoneCardHint}>آخر ٨ أسابيع</Text>
                    </View>
                    <Text style={styles.phoneCardBadge}>‎+68%</Text>
                  </View>
                  <View style={styles.chart}>
                    {chartBars.map((height, index) => (
                      <View
                        key={`bar-${index}`}
                        style={[
                          styles.chartBar,
                          {
                            height,
                            backgroundColor:
                              index >= chartBars.length - 3
                                ? palette.green
                                : palette.greenSoft,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  <View style={styles.chartAxis}>
                    <Text style={styles.chartAxisLabel}>قبل</Text>
                    <View style={styles.chartAxisRule} />
                    <Text style={styles.chartAxisLabel}>الآن</Text>
                  </View>
                </View>

                <View style={styles.phoneActivity}>
                  {dashboardActivity.map((item) => (
                    <View key={item.label} style={styles.phoneRow}>
                      <View style={styles.phoneRowIcon}>
                        <Icon name={item.icon} size={11} color={palette.green} />
                      </View>
                      <Text numberOfLines={1} style={styles.phoneRowText}>
                        {item.label}
                      </Text>
                      <Text style={styles.phoneRowTime}>{item.time}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

          </View>

          {/* Trust bar */}
          <View style={[styles.trustBar, compact && styles.trustBarStacked]}>
            {trustItems.map((item, index) => (
              <React.Fragment key={item.title}>
                {index > 0 ? (
                  <View
                    style={[
                      styles.trustDivider,
                      compact && styles.trustDividerStacked,
                    ]}
                  />
                ) : null}
                <View style={[styles.trustItem, compact && styles.trustItemStacked]}>
                  <View style={styles.trustIcon}>
                    <Icon name={item.icon} size={17} color={palette.green} />
                  </View>
                  <View style={styles.trustCopy}>
                    <Text style={styles.trustTitle}>{item.title}</Text>
                    <Text style={styles.trustNote}>{item.note}</Text>
                  </View>
                </View>
              </React.Fragment>
            ))}
          </View>

          {/* Closing call to action */}
          <View style={styles.ctaBand}>
            <View style={styles.ctaGlow} />
            <View style={styles.ctaCopy}>
              <Text style={styles.ctaTitle}>مع MenaFlow … أعمالك تنمو أكثر</Text>
              <Text style={styles.ctaBody}>
                انضم إلى أصحاب المتاجر الذين ينظّمون نشرهم ومحادثاتهم وطلباتهم
                في مكان واحد.
              </Text>
            </View>
            <Link href="/(auth)/sign-up" asChild>
              <Pressable accessibilityRole="button" style={styles.ctaButton}>
                <Text style={styles.ctaButtonText}>ابدأ الآن</Text>
                <Icon name="chevron-left" size={17} color={palette.green} />
              </Pressable>
            </Link>
          </View>

          {/* Steps */}
          <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>طريقة البدء</Text>
            <Text style={styles.sectionTitle}>ثلاث خطوات للانطلاق</Text>
            <Text style={styles.sectionBody}>
              إعداد بسيط يعرّفك على مساحة العمل قبل البدء باستخدامها.
            </Text>
            <View style={styles.stepGrid}>
              {steps.map((step) => (
                <View key={step.number} style={styles.stepCard}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>{step.number}</Text>
                  </View>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <Text style={styles.stepBody}>{step.description}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Pricing */}
          <View
            style={styles.section}
            nativeID="pricing"
            onLayout={trackSection("pricing")}
          >
            <Text style={styles.sectionEyebrow}>الأسعار</Text>
            <Text style={styles.sectionTitle}>اختر حدود الاستخدام المناسبة لك</Text>
            <Text style={styles.sectionBody}>
              ابدأ مجانًا، وارتقِ حين تحتاج حدودًا أعلى للنشر والتوليد.
            </Text>
            <View style={styles.planGrid}>
              {marketingPlans.map((plan) => (
                <View
                  key={plan.id}
                  style={[
                    styles.planCard,
                    plan.id === "starter" && styles.planCardHighlight,
                  ]}
                >
                  <Text style={styles.planName}>{plan.name}</Text>
                  <View style={styles.planPriceRow}>
                    <Text style={styles.planPrice}>
                      {plan.monthlyPriceUsd === 0 ? "0" : `$${plan.monthlyPriceUsd}`}
                    </Text>
                    <Text style={styles.planPeriod}>/ شهريًا</Text>
                  </View>
                  <Text style={styles.planDescription}>{plan.description}</Text>
                  <View style={styles.planLimits}>
                    {plan.limits.map((limit) => (
                      <View key={limit} style={styles.planLimit}>
                        <Icon name="check" size={14} color={palette.green} />
                        <Text style={styles.planLimitText}>{limit}</Text>
                      </View>
                    ))}
                  </View>
                  <Link href="/(auth)/sign-up" asChild>
                    <Pressable
                      accessibilityRole="button"
                      // Must stay flat: <Link asChild> renders the child through
                      // Radix Slot, which merges styles with `{...style}`. An
                      // array becomes {0:…,1:…} and React writes style["0"],
                      // which WebKit refuses with MF-XHKY2.
                      style={StyleSheet.flatten([
                        styles.planButton,
                        plan.id === "starter"
                          ? styles.planButtonPrimary
                          : styles.planButtonSecondary,
                      ])}
                    >
                      <Text
                        style={
                          plan.id === "starter"
                            ? styles.planButtonPrimaryText
                            : styles.planButtonSecondaryText
                        }
                      >
                        ابدأ بهذه الخطة
                      </Text>
                    </Pressable>
                  </Link>
                </View>
              ))}
            </View>
            <Text style={styles.channelNote}>{channelNote}</Text>
          </View>

          {/* FAQ */}
          <View
            style={styles.section}
            nativeID="faq"
            onLayout={trackSection("faq")}
          >
            <Text style={styles.sectionEyebrow}>الأسئلة الشائعة</Text>
            <Text style={styles.sectionTitle}>ما يُسأل عنه قبل البدء</Text>
            <View style={styles.faqList}>
              {faqs.map((item) => {
                const open = openFaq === item.id;
                return (
                  <View key={item.id} style={styles.faqItem}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      onPress={() => setOpenFaq(open ? null : item.id)}
                      style={styles.faqHeading}
                    >
                      <Text style={styles.faqQuestion}>{item.question}</Text>
                      <Icon
                        name={open ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={palette.green}
                      />
                    </Pressable>
                    {open ? (
                      <Text style={styles.faqAnswer}>{item.answer}</Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.footerBrand}>
              <Image
                source={require("../assets/images/icon.png")}
                style={styles.footerIcon}
                accessibilityLabel="شعار MenaFlow"
              />
              <Text style={styles.footerName}>MenaFlow</Text>
            </View>
            <Text style={styles.footerText}>
              MenaFlow — مساحة عمل لتنظيم المحتوى والمحادثات والطلبات.
            </Text>
            <View style={styles.footerLinks}>
              <Link href="/(auth)/privacy" asChild>
                <Pressable accessibilityRole="link" style={styles.footerLinkButton}>
                  <Text style={styles.footerLink}>سياسة الخصوصية</Text>
                </Pressable>
              </Link>
              <Link href="/(auth)/terms" asChild>
                <Pressable accessibilityRole="link" style={styles.footerLinkButton}>
                  <Text style={styles.footerLink}>الشروط والأحكام</Text>
                </Pressable>
              </Link>
              <Link href="/(auth)/sign-in" asChild>
                <Pressable accessibilityRole="link" style={styles.footerLinkButton}>
                  <Text style={styles.footerLink}>تسجيل الدخول</Text>
                </Pressable>
              </Link>
            </View>
            <Text style={styles.footerCopyright}>
              © {new Date().getFullYear()} MenaFlow. جميع الحقوق محفوظة.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.mintSoft },
  scrollContent: { alignItems: "center", paddingBottom: 24 },
  content: { gap: 18, paddingTop: 10 },

  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  languagePill: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  languageText: { fontSize: 13, fontWeight: "700", color: palette.ink },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandIcon: { width: 34, height: 34, borderRadius: 11 },
  brandName: { fontSize: 20, fontWeight: "800", color: palette.ink, letterSpacing: -0.4 },

  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 18,
    paddingVertical: 4,
  },
  navLink: { minHeight: 44, justifyContent: "center", paddingVertical: 6 },
  navText: { fontSize: 14, fontWeight: "700", color: palette.inkSoft },
  navSignIn: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: palette.white,
  },
  navSignInText: { fontSize: 14, fontWeight: "800", color: palette.ink },

  hero: {
    backgroundColor: palette.mintArt,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 28,
    padding: 18,
    gap: 10,
  },
  heroWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    padding: 28,
  },
  heroArt: { alignItems: "center", justifyContent: "center" },
  heroArtWide: { width: "44%" },
  mascot: { width: "100%", height: 240 },
  mascotNarrow: { height: 200 },
  mascotWide: { height: 320 },
  heroCopy: { flex: 1, gap: 10 },
  heroTitle: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: "800",
    color: palette.ink,
    textAlign: "right",
  },
  heroTitleAccent: {
    fontSize: 28,
    lineHeight: 40,
    fontWeight: "800",
    color: palette.green,
    textAlign: "right",
  },
  heroBody: {
    fontSize: 15,
    lineHeight: 24,
    color: palette.inkSoft,
    textAlign: "right",
  },
  heroActions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  heroActionsNarrow: { flexDirection: "column", alignItems: "stretch" },
  primaryCta: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.green,
    borderRadius: 999,
    paddingHorizontal: 22,
  },
  primaryCtaText: { fontSize: 15, fontWeight: "800", color: palette.white },
  secondaryCta: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 20,
  },
  secondaryCtaText: { fontSize: 14, fontWeight: "800", color: palette.ink },

  featuresPanel: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 28,
    padding: 18,
    gap: 16,
  },
  sectionRuleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sectionRule: { flex: 1, height: 1, backgroundColor: palette.border },
  sectionRuleTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: palette.ink,
    textAlign: "center",
  },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  featureCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: palette.mintSoft,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 10,
  },
  featureCardNarrow: { flexBasis: "45%", minWidth: 130, minHeight: 72 },
  // Phones get a compact row card (icon beside the label): the stacked card ate
  // too much height and left the text floating in the middle of the tile.
  featureCardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    paddingHorizontal: 11,
    paddingVertical: 12,
    borderRadius: 16,
  },
  featureIconNarrow: { width: 32, height: 32, borderRadius: 10 },
  featureTitleRow: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "right",
  },
  featureIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.greenSoft,
    borderRadius: 13,
  },
  featureTitle: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "800",
    color: palette.ink,
    textAlign: "center",
  },
  featureDescription: {
    fontSize: 13,
    lineHeight: 19,
    color: palette.inkSoft,
    textAlign: "center",
  },

  dashboard: { gap: 20, paddingVertical: 14 },
  // Copy first in the DOM: stacked on phones (copy above the mockup) and on
  // wide screens the RTL row puts it on the right, the mockup on the left.
  dashboardWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 40,
    paddingVertical: 18,
  },
  phoneWrap: { alignItems: "center", justifyContent: "center" },
  phoneWrapWide: { flex: 1 },
  phone: {
    width: 258,
    backgroundColor: palette.phoneSurface,
    borderRadius: 32,
    paddingHorizontal: 11,
    paddingTop: 9,
    paddingBottom: 11,
    gap: 9,
    shadowColor: palette.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  phoneNotch: {
    alignSelf: "center",
    width: 54,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.phoneNotch,
    marginBottom: 1,
  },
  phoneHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  phoneBrandGroup: { flexDirection: "row", alignItems: "center", gap: 5 },
  phoneBrandIcon: { width: 15, height: 15, borderRadius: 4 },
  phoneBrand: {
    fontSize: 10.5,
    fontWeight: "800",
    color: palette.white,
    letterSpacing: 0.2,
  },
  phoneLive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.phoneBadgeSurface,
    borderRadius: 99,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  phoneLiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: palette.green,
  },
  phoneLiveText: { fontSize: 7.5, fontWeight: "700", color: palette.phoneBadgeText },
  phoneStats: { flexDirection: "row", gap: 6 },
  phoneStat: {
    flex: 1,
    backgroundColor: palette.white,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
    gap: 2,
  },
  phoneStatValue: { fontSize: 15, fontWeight: "800", color: palette.ink },
  phoneStatLabel: { fontSize: 8, fontWeight: "600", color: palette.inkSoft },
  phoneCard: {
    backgroundColor: palette.white,
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  phoneCardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 6,
  },
  phoneCardTitleGroup: { flexShrink: 1, gap: 1 },
  phoneCardTitle: { fontSize: 9.5, fontWeight: "800", color: palette.ink },
  phoneCardHint: { fontSize: 7, color: palette.inkSoft },
  phoneCardBadge: {
    fontSize: 8.5,
    fontWeight: "800",
    color: palette.greenDark,
    backgroundColor: palette.greenSoft,
    borderRadius: 7,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  chart: {
    height: 74,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 5,
  },
  chartBar: { flex: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  chartAxis: { flexDirection: "row", alignItems: "center", gap: 6 },
  chartAxisRule: { flex: 1, height: 1, backgroundColor: palette.border },
  chartAxisLabel: { fontSize: 6.5, color: palette.inkSoft },
  phoneActivity: { gap: 6 },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: palette.phoneRowSurface,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  phoneRowIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.phoneBadgeSurface,
  },
  phoneRowText: {
    flex: 1,
    fontSize: 8.5,
    fontWeight: "600",
    color: palette.phoneRowText,
  },
  phoneRowTime: { fontSize: 7, color: palette.phoneRowMuted },

  dashboardCopy: { gap: 12 },
  dashboardCopyWide: { flex: 1 },
  dashboardTitle: {
    fontSize: 22,
    lineHeight: 34,
    fontWeight: "800",
    color: palette.ink,
    textAlign: "right",
  },
  dashboardBody: {
    fontSize: 15,
    lineHeight: 24,
    color: palette.inkSoft,
    textAlign: "right",
  },
  dashboardPoints: {
    gap: 8,
    backgroundColor: palette.greenSoft,
    borderRadius: 18,
    padding: 14,
  },
  dashboardPoint: { flexDirection: "row", alignItems: "center", gap: 8 },
  dashboardPointText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    color: palette.ink,
    textAlign: "right",
  },

  trustBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  trustBarStacked: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 12,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  trustDivider: { width: 1, alignSelf: "stretch", backgroundColor: palette.border },
  trustDividerStacked: { width: "100%", height: 1 },
  trustItem: {
    // Longhands instead of `flex: 1`: on web the `flex` shorthand compiles to
    // `flex: 1 1 0%`, and the stacked override below has to reset that basis.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  trustItemStacked: {
    // A `0%` basis collapses the row to zero height whenever the card has a
    // definite height (web), which made the title/note overlap the divider.
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: "auto",
    justifyContent: "flex-start",
    paddingHorizontal: 0,
    gap: 10,
  },
  trustIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.mintSoft,
    borderRadius: 10,
  },
  trustCopy: { flexShrink: 1, gap: 2 },
  trustTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: palette.ink,
    textAlign: "right",
  },
  trustNote: { fontSize: 12, color: palette.inkSoft, textAlign: "right" },

  ctaBand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
    backgroundColor: palette.green,
    borderRadius: 26,
    padding: 20,
    overflow: "hidden",
  },
  ctaGlow: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: palette.ctaGlow,
    opacity: 0.35,
    top: -90,
    right: -60,
  },
  ctaCopy: { flex: 1, minWidth: 220, gap: 4 },
  ctaTitle: { fontSize: 19, fontWeight: "800", color: palette.white, textAlign: "right" },
  ctaBody: { fontSize: 14, lineHeight: 21, color: palette.ctaSubtext, textAlign: "right" },
  ctaButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: palette.white,
    borderRadius: 999,
    paddingHorizontal: 22,
  },
  ctaButtonText: { fontSize: 14, fontWeight: "800", color: palette.greenDark },

  section: { gap: 8, paddingVertical: 10 },
  sectionEyebrow: {
    fontSize: 13,
    fontWeight: "800",
    color: palette.green,
    textAlign: "right",
  },
  sectionTitle: {
    fontSize: 21,
    lineHeight: 32,
    fontWeight: "800",
    color: palette.ink,
    textAlign: "right",
  },
  sectionBody: {
    fontSize: 14,
    lineHeight: 22,
    color: palette.inkSoft,
    textAlign: "right",
    marginBottom: 6,
  },

  stepGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  stepCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 220,
    gap: 6,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 20,
    padding: 16,
  },
  stepBadge: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.greenSoft,
    borderRadius: 9,
  },
  stepBadgeText: { fontSize: 14, fontWeight: "800", color: palette.greenDark },
  stepTitle: { fontSize: 15, fontWeight: "800", color: palette.ink, textAlign: "right" },
  stepBody: { fontSize: 14, lineHeight: 21, color: palette.inkSoft, textAlign: "right" },

  planGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  planCard: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 240,
    gap: 8,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 22,
    padding: 16,
  },
  planCardHighlight: { borderColor: palette.green, borderWidth: 2 },
  planName: { fontSize: 15, fontWeight: "800", color: palette.ink, textAlign: "right" },
  planPriceRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  planPrice: { fontSize: 26, fontWeight: "800", color: palette.ink },
  planPeriod: { fontSize: 13, color: palette.inkSoft, marginBottom: 4 },
  planDescription: {
    fontSize: 14,
    lineHeight: 21,
    color: palette.inkSoft,
    textAlign: "right",
  },
  planLimits: { gap: 6, marginTop: 2 },
  planLimit: { flexDirection: "row", alignItems: "center", gap: 6 },
  planLimitText: { fontSize: 13, color: palette.ink, textAlign: "right", flex: 1 },
  planButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    marginTop: 4,
  },
  planButtonPrimary: { backgroundColor: palette.green },
  planButtonSecondary: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
  },
  planButtonPrimaryText: { fontSize: 14, fontWeight: "800", color: palette.white },
  planButtonSecondaryText: { fontSize: 14, fontWeight: "800", color: palette.ink },
  channelNote: {
    fontSize: 13,
    lineHeight: 20,
    color: palette.inkSoft,
    textAlign: "right",
    marginTop: 4,
  },

  faqList: { gap: 8 },
  faqItem: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  faqHeading: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  faqQuestion: { flex: 1, fontSize: 14, fontWeight: "800", color: palette.ink, textAlign: "right" },
  faqAnswer: { fontSize: 14, lineHeight: 22, color: palette.inkSoft, textAlign: "right" },

  footer: {
    gap: 8,
    alignItems: "center",
    paddingVertical: 20,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  footerBrand: { flexDirection: "row", alignItems: "center", gap: 6 },
  footerIcon: { width: 24, height: 24, borderRadius: 8 },
  footerName: { fontSize: 15, fontWeight: "800", color: palette.ink },
  footerText: { fontSize: 13, color: palette.inkSoft, textAlign: "center" },
  footerLinks: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center" },
  footerLinkButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  footerLink: { fontSize: 13, fontWeight: "700", color: palette.greenDark },
  footerCopyright: { fontSize: 12, color: palette.inkSoft, textAlign: "center" },
});
