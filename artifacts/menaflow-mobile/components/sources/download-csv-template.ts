import { Platform } from "react-native";

import {
  PRODUCT_CSV_TEMPLATE,
  PRODUCT_CSV_TEMPLATE_FILENAME,
} from "./csv-product-template";

/**
 * Writes the CSV template to a temporary file and hands it to the platform
 * share/save sheet. Returns a short Arabic message describing the outcome.
 */
export async function downloadProductCsvTemplate(): Promise<string> {
  if (Platform.OS === "web") {
    if (typeof document === "undefined") {
      throw new Error("تعذر تجهيز القالب على هذا المتصفح.");
    }
    const blob = new Blob([PRODUCT_CSV_TEMPLATE], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = PRODUCT_CSV_TEMPLATE_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return "تم تنزيل قالب CSV.";
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);

  const file = new File(Paths.cache, PRODUCT_CSV_TEMPLATE_FILENAME);
  if (file.exists) file.delete();
  await file.write(PRODUCT_CSV_TEMPLATE);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("المشاركة غير متاحة على هذا الجهاز لحفظ القالب.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "text/csv",
    dialogTitle: "حفظ قالب استيراد المنتجات",
    UTI: "public.comma-separated-values-text",
  });
  return "تم تجهيز القالب للحفظ.";
}
