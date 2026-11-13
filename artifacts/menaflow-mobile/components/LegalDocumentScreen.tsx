import React from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { CairoText as Text } from "@/components/CairoTypography";
import { navigateBack } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";

type LegalSection = {
  title: string;
  description: string;
};

const documents = {
  terms: {
    title: "الشروط والأحكام",
    sections: [
      {
        title: "الجهة المقدمة للخدمة",
        description:
          "أضف الاسم القانوني لمشغّل MenaFlow وعنوانه ووسائل التواصل الرسمية قبل نشر هذه الشروط.",
      },
      {
        title: "الخدمة والحساب",
        description:
          "وضّح الخدمات التي يقدمها MenaFlow، ومتطلبات إنشاء الحساب، ومسؤولية المستخدم عن بيانات الدخول ودقة معلوماته.",
      },
      {
        title: "الاستخدام المقبول والمحتوى",
        description:
          "حدد الاستخدامات المحظورة، وحقوق المستخدم على المحتوى الذي يقدمه، والتراخيص اللازمة لتشغيل الخدمة والتكاملات.",
      },
      {
        title: "الخطط والرسوم",
        description:
          "أكمل تفاصيل التجربة والخطط والأسعار والفوترة والإلغاء والتجديد قبل إتاحة أي اشتراك مدفوع.",
      },
      {
        title: "التعليق والإنهاء",
        description:
          "اشرح الحالات التي يمكن فيها تعليق الحساب أو إنهاؤه، وكيفية تنزيل بيانات المستخدم أو حذفها عند انتهاء الخدمة.",
      },
      {
        title: "المسؤولية والتغييرات",
        description:
          "أضف أحكام الضمان والمسؤولية والقانون المختص وآلية إخطار المستخدمين بالتغييرات بعد مراجعة قانونية.",
      },
    ],
  },
  privacy: {
    title: "سياسة الخصوصية",
    sections: [
      {
        title: "المتحكم وبيانات التواصل",
        description:
          "أضف اسم الجهة القانونية المسؤولة عن بيانات المستخدمين وعنوانها والبريد المخصص لطلبات الخصوصية.",
      },
      {
        title: "البيانات التي نجمعها",
        description:
          "وثّق بدقة بيانات الحساب ومساحات العمل والمحتوى وبيانات الاستخدام والتشخيص التي يجمعها MenaFlow.",
      },
      {
        title: "أغراض المعالجة",
        description:
          "اشرح سبب استخدام كل فئة من البيانات والأساس النظامي المعتمد لكل غرض وفق الأنظمة المنطبقة.",
      },
      {
        title: "المعالجون والمشاركة والنقل",
        description:
          "أدرج مزودي الاستضافة والمصادقة والتحليلات والتكاملات، وأوضح متى تُشارك البيانات أو تُنقل عبر الحدود.",
      },
      {
        title: "الاحتفاظ والأمان",
        description:
          "حدد مدد الاحتفاظ ومعايير الحذف والضمانات الأمنية المطبقة، دون ذكر ضمانات لا يطبقها النظام فعليًا.",
      },
      {
        title: "حقوق المستخدمين",
        description:
          "بيّن حقوق أصحاب البيانات وطريقة تقديم الطلبات والتحقق منها والرد عليها، وأي قيود نظامية ذات صلة.",
      },
    ],
  },
} satisfies Record<
  "terms" | "privacy",
  { title: string; sections: LegalSection[] }
>;

export function LegalDocumentScreen({
  document,
}: {
  document: keyof typeof documents;
}) {
  const colors = useColors();
  const content = documents[document];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="العودة إلى إنشاء الحساب"
          onPress={() => navigateBack("/(auth)/sign-up")}
          style={({ pressed }) => [
            styles.backButton,
            {
              backgroundColor: pressed ? colors.secondary : colors.card,
              borderColor: colors.border,
            },
          ]}
        >
          <ArrowRight size={18} color={colors.primary} />
          <Text style={[styles.backText, { color: colors.primary }]}>
            العودة إلى التسجيل
          </Text>
        </Pressable>

        <Text style={[styles.title, { color: colors.foreground }]}>
          {content.title}
        </Text>

        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.notice,
            { backgroundColor: colors.accent, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.noticeTitle, { color: colors.foreground }]}>
            مسودة غير معتمدة للنشر
          </Text>
          <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
            هذه مسودة هيكلية وليست سياسة قانونية مكتملة، ولا تصف بالضرورة
            ممارسات MenaFlow الحالية. يجب استكمالها بمعلومات دقيقة ومراجعتها
            قانونيًا قبل النشر أو الاعتماد عليها.
          </Text>
        </View>

        {content.sections.map((section) => (
          <View
            key={section.title}
            style={[
              styles.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              {section.title}
            </Text>
            <Text style={[styles.sectionText, { color: colors.mutedForeground }]}>
              {section.description}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 36,
    gap: 14,
  },
  backButton: {
    minHeight: 44,
    minWidth: 44,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  backText: { fontSize: 14, fontWeight: "700" },
  title: {
    fontSize: 24,
    lineHeight: 34,
    fontWeight: "900",
    textAlign: "right",
  },
  notice: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  noticeTitle: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  noticeText: { fontSize: 14, lineHeight: 22, textAlign: "right" },
  section: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "800", textAlign: "right" },
  sectionText: { fontSize: 14, lineHeight: 22, textAlign: "right" },
});
