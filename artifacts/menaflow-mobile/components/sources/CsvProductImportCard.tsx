import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useQueryClient } from "@tanstack/react-query";
import { CairoText as Text } from "@/components/CairoTypography";
import { LucideIcon as Icon } from "@/components/LucideIcon";
import { ActionButton, Panel } from "@/components/Ui";
import { useColors } from "@/hooks/useColors";
import { createCatalogProduct } from "@/lib/product-catalog-api";
import {
  parseProductRows,
  type ImportRow,
} from "./csv-product-import-parser";

type ImportReport = {
  imported: number;
  failed: Array<{ rowNumber: number; reason: string }>;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function CsvProductImportCard({ userId }: { userId: string | null }) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const chooseFile = async () => {
    setError("");
    setReport(null);
    try {
      const selection = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (selection.canceled) return;
      const file = selection.assets[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        throw new Error("اختر ملفًا بامتداد CSV.");
      }
      if (file.size !== undefined && file.size > MAX_FILE_BYTES) {
        throw new Error("حجم الملف يتجاوز الحد المسموح (2 ميغابايت).");
      }
      const response = await fetch(file.uri);
      if (!response.ok) throw new Error("تعذر قراءة الملف المحدد.");
      const content = await response.text();
      if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) {
        throw new Error("حجم الملف يتجاوز الحد المسموح (2 ميغابايت).");
      }
      setRows(parseProductRows(content));
      setFileName(file.name);
    } catch (cause) {
      setRows(null);
      setFileName("");
      setError(
        cause instanceof Error ? cause.message : "تعذر قراءة ملف CSV المحدد.",
      );
    }
  };

  const importRows = async () => {
    if (!rows) return;
    const failed = rows
      .filter((row) => row.error)
      .map((row) => ({ rowNumber: row.rowNumber, reason: row.error! }));
    let imported = 0;
    setBusy(true);
    setError("");
    setReport(null);
    try {
      for (const row of rows) {
        if (row.error) continue;
        try {
          await createCatalogProduct(row.product);
          imported += 1;
        } catch (cause) {
          failed.push({
            rowNumber: row.rowNumber,
            reason:
              cause instanceof Error
                ? cause.message
                : "تعذر حفظ المنتج.",
          });
        }
      }
      if (imported > 0) {
        await queryClient.invalidateQueries({
          queryKey: ["product-catalog", userId ?? "local"],
        });
      }
      setReport({ imported, failed });
      setRows(null);
      setFileName("");
    } finally {
      setBusy(false);
    }
  };

  const validCount = rows?.filter((row) => !row.error).length ?? 0;
  const invalidRows = rows?.filter((row) => row.error) ?? [];

  return (
    <Panel style={styles.panel}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: colors.accent }]}>
          <Icon name="file-text" size={18} color={colors.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            استيراد المنتجات من CSV
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            أضف ملفًا جدوليًا إلى كتالوج المنتجات. تُنشأ المنتجات كمسودات للمراجعة.
          </Text>
        </View>
      </View>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        الأعمدة: name (مطلوب)، sku، description، price، currency، availability، aliases.
        يمكن استخدام أسماء الأعمدة العربية أيضًا. افصل الأسماء البديلة بعلامة |.
      </Text>
      <ActionButton
        label={busy ? "جارٍ الاستيراد…" : "اختيار ملف CSV"}
        icon="file-plus"
        onPress={() => void chooseFile()}
        disabled={busy}
      />
      {fileName ? (
        <Text style={[styles.fileName, { color: colors.foreground }]}>
          الملف المحدد: {fileName}
        </Text>
      ) : null}
      {busy ? (
        <View style={styles.progress}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            جارٍ حفظ المنتجات الصالحة…
          </Text>
        </View>
      ) : null}
      {rows ? (
        <View style={[styles.preview, { borderColor: colors.border }]}>
          <Text style={[styles.previewTitle, { color: colors.foreground }]}>
            {validCount} منتج صالح
            {invalidRows.length ? `، ${invalidRows.length} صف غير صالح` : ""}
          </Text>
          {invalidRows.slice(0, 5).map((row) => (
            <Text
              key={row.rowNumber}
              style={[styles.issue, { color: colors.destructive }]}
            >
              الصف {row.rowNumber}: {row.error}
            </Text>
          ))}
          {invalidRows.length > 5 ? (
            <Text style={[styles.help, { color: colors.mutedForeground }]}>
              وهناك {invalidRows.length - 5} صفوف أخرى غير صالحة.
            </Text>
          ) : null}
          <ActionButton
            label={`استيراد ${validCount} منتج`}
            icon="check"
            onPress={() => void importRows()}
            disabled={busy || validCount === 0}
          />
        </View>
      ) : null}
      {report ? (
        <View
          accessibilityRole="alert"
          style={[styles.preview, { borderColor: colors.border }]}
        >
          <Text style={[styles.previewTitle, { color: colors.foreground }]}>
            تم استيراد {report.imported} منتج
            {report.failed.length
              ? `، وتعذر استيراد ${report.failed.length} صف`
              : " بنجاح"}
          </Text>
          {report.failed.slice(0, 5).map((row) => (
            <Text
              key={row.rowNumber}
              style={[styles.issue, { color: colors.destructive }]}
            >
              الصف {row.rowNumber}: {row.reason}
            </Text>
          ))}
          {report.failed.length > 5 ? (
            <Text style={[styles.help, { color: colors.mutedForeground }]}>
              وهناك {report.failed.length - 5} أخطاء أخرى.
            </Text>
          ) : null}
        </View>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.issue, { color: colors.destructive }]}
        >
          {error}
        </Text>
      ) : null}
    </Panel>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  headingCopy: { flex: 1, gap: 4 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "700" },
  body: { fontSize: 13, lineHeight: 20 },
  help: { fontSize: 12, lineHeight: 19 },
  fileName: { fontSize: 13 },
  progress: { flexDirection: "row", alignItems: "center", gap: 8 },
  preview: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  previewTitle: { fontSize: 14, fontWeight: "700" },
  issue: { fontSize: 12, lineHeight: 18 },
});
