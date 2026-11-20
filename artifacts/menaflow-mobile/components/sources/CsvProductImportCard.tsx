import React, { useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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
  cancelled: boolean;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

export function CsvProductImportCard({
  userId,
  onImported,
}: {
  userId: string | null;
  onImported?: (imported: number) => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const cancelRequestedRef = useRef(false);

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
    if (!rows || busy) return;
    const pendingRows = rows.filter((row) => !row.error);
    const failed = rows
      .filter((row) => row.error)
      .map((row) => ({ rowNumber: row.rowNumber, reason: row.error! }));
    let imported = 0;
    let processed = 0;
    cancelRequestedRef.current = false;
    setBusy(true);
    setError("");
    setReport(null);
    setProgress({ done: 0, total: pendingRows.length });
    try {
      for (const row of pendingRows) {
        if (cancelRequestedRef.current) break;
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
        processed += 1;
        setProgress({ done: processed, total: pendingRows.length });
      }
      const cancelled = cancelRequestedRef.current;
      if (imported > 0) {
        await queryClient.invalidateQueries({
          queryKey: ["product-catalog", userId ?? "local"],
        });
      }
      setReport({ imported, failed, cancelled });
      setRows(null);
      setFileName("");
      if (imported > 0) onImported?.(imported);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const validCount = rows?.filter((row) => !row.error).length ?? 0;
  const invalidRows = rows?.filter((row) => row.error) ?? [];
  const previewRows = (rows ?? []).filter((row) => !row.error).slice(0, 3);
  const progressPercent = progress
    ? Math.round((progress.done / Math.max(progress.total, 1)) * 100)
    : 0;

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
      <View
        style={[
          styles.guide,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.guideTitle, { color: colors.foreground }]}>
          الأعمدة المدعومة
        </Text>
        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          الاسم (مطلوب) · الرمز · الوصف · السعر · العملة · التوفر · الأسماء
          البديلة (افصل بينها بـ |)
        </Text>
        <Text style={[styles.help, { color: colors.mutedForeground }]}>
          يمكن استخدام الأسماء الإنجليزية أيضًا: name, sku, description, price,
          currency, availability, aliases. يوضع كل عمود في الصف الأول، وبحد
          أقصى 200 منتج في الملف.
        </Text>
      </View>
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
      {progress ? (
        <View style={styles.progressBlock}>
          <View
            style={[styles.progressTrack, { backgroundColor: colors.secondary }]}
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: progress.total,
              now: progress.done,
            }}
          >
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: colors.primary,
                  width: `${progressPercent}%` as `${number}%`,
                },
              ]}
            />
          </View>
          <View style={styles.progressRow}>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {`جارٍ حفظ المنتجات… ${progress.done} من ${progress.total}`}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="إلغاء الاستيراد"
              hitSlop={10}
              onPress={() => {
                cancelRequestedRef.current = true;
              }}
              style={styles.cancelButton}
            >
              <Text style={[styles.cancelLabel, { color: colors.destructive }]}>
                إلغاء
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {rows ? (
        <View style={[styles.preview, { borderColor: colors.border }]}>
          <Text style={[styles.previewTitle, { color: colors.foreground }]}>
            {validCount} منتج صالح
            {invalidRows.length ? `، ${invalidRows.length} صف غير صالح` : ""}
          </Text>
          {previewRows.length ? (
            <View style={[styles.table, { borderColor: colors.border }]}>
              <View
                style={[
                  styles.tableRow,
                  styles.tableHeaderRow,
                  { backgroundColor: colors.secondary },
                ]}
              >
                {["الاسم", "الرمز", "السعر"].map((heading) => (
                  <Text
                    key={heading}
                    style={[
                      styles.tableCell,
                      styles.tableHeaderCell,
                      { color: colors.foreground },
                    ]}
                  >
                    {heading}
                  </Text>
                ))}
              </View>
              {previewRows.map((row) => (
                <View key={row.rowNumber} style={styles.tableRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.tableCell, { color: colors.foreground }]}
                  >
                    {row.product.name}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.tableCell,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {row.product.sku || "—"}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.tableCell,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {row.product.price
                      ? `${row.product.price} ${row.product.currency ?? ""}`.trim()
                      : "—"}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
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
            {report.imported > 0
              ? `تم استيراد ${report.imported} منتج`
              : "لم يتم استيراد أي منتج"}
            {report.failed.length
              ? `، وتعذر استيراد ${report.failed.length} صف`
              : report.imported > 0
                ? " بنجاح"
                : ""}
          </Text>
          {report.cancelled ? (
            <Text style={[styles.help, { color: colors.warning }]}>
              أُوقف الاستيراد قبل إكمال بقية الصفوف. راجع المنتجات المحفوظة قبل
              إعادة المحاولة لتجنّب التكرار.
            </Text>
          ) : null}
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
  guide: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },
  guideTitle: { fontSize: 12, fontWeight: "800", textAlign: "right" },
  progressBlock: { gap: 6 },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 999 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cancelButton: { paddingVertical: 4, paddingHorizontal: 2 },
  cancelLabel: { fontSize: 12, fontWeight: "800" },
  table: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  tableHeaderRow: { paddingVertical: 5 },
  tableCell: { flex: 1, fontSize: 11, textAlign: "right" },
  tableHeaderCell: { fontWeight: "800" },
  preview: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  previewTitle: { fontSize: 14, fontWeight: "700" },
  issue: { fontSize: 12, lineHeight: 18 },
});
