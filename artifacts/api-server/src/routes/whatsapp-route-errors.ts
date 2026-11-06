import type { Response } from "express";
import { EvolutionApiError } from "../lib/whatsapp-evolution";

export function evolutionErrorResponse(
  res: Response,
  error: unknown,
  operation: string,
): void {
  if (error instanceof EvolutionApiError) {
    if (error.statusCode >= 500) {
      console.error(`${operation}: ${error.message}`);
    }
    const message =
      error.message === "WHATSAPP_CONNECTED_DURING_CODE_REFRESH"
        ? "تم تأكيد اتصال واتساب أثناء طلب رمز جديد. حدّث حالة الاتصال قبل إعادة المحاولة."
        : error.statusCode === 503
          ? "خدمة Evolution API غير مهيأة. اضبط WHATSAPP_EVOLUTION_BASE_URL وWHATSAPP_EVOLUTION_API_KEY."
          : error.statusCode === 404
            ? "لم تعد نسخة واتساب موجودة في Evolution API. ابدأ الربط من جديد."
            : error.statusCode === 409
              ? "حساب واتساب غير متصل حالياً. أعد ربطه ثم حاول مجدداً."
              : error.statusCode === 422
                ? "لم تُصدر Evolution API رمز الربط النصي. تحقق من الرقم وحالة اتصال واتساب ثم حاول مجددًا."
                : error.statusCode === 504
                  ? "استغرق تحميل مجموعات واتساب وقتاً أطول من المتوقع. أعد المحاولة بعد قليل."
                  : "تعذّر التواصل مع Evolution API. تحقق من WHATSAPP_EVOLUTION_BASE_URL وWHATSAPP_EVOLUTION_API_KEY.";
    res.status(error.statusCode).json({ error: message });
    return;
  }
  console.error(`${operation}:`, error);
  res.status(500).json({ error: "تعذر إكمال ربط واتساب." });
}
