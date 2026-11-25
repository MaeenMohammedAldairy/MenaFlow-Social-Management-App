import { Platform } from "react-native";
import { exportWorkspaceData } from "@workspace/api-client-react";

/**
 * Downloads the workspace data export (§3.4: `GET /workspaces/current/export`)
 * and hands it to the platform save/share sheet — the same pattern as the
 * product CSV template downloader. Returns a short Arabic message describing
 * the outcome.
 */
export async function downloadWorkspaceExport(
  workspaceId: string,
): Promise<string> {
  // Through the generated client: a refusal (401, a non-owner 403) arrives as
  // an ApiError with the server's message instead of WORKSPACE_EXPORT_HTTP_<n>.
  // The default read deadline is the same one fetchApiResponse applied.
  const payload = await exportWorkspaceData();
  const contents = JSON.stringify(payload, null, 2);
  const fileName = `menaflow-export-${workspaceId}.json`;

  if (Platform.OS === "web") {
    if (typeof document === "undefined") {
      throw new Error("تعذر تجهيز التصدير على هذا المتصفح.");
    }
    const blob = new Blob([contents], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = globalThis.document.createElement("a");
    link.href = url;
    link.download = fileName;
    globalThis.document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return "تم تنزيل نسخة من بياناتك.";
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);

  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  await file.write(contents);

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("المشاركة غير متاحة على هذا الجهاز لحفظ التصدير.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: "application/json",
    dialogTitle: "حفظ نسخة من بيانات مساحة العمل",
    UTI: "public.json",
  });
  return "تم تجهيز نسخة بياناتك للحفظ.";
}
