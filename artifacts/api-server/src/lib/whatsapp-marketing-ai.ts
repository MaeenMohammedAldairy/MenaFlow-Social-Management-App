import { callAiProvider } from "./ai-provider.ts";

export type AiDraft = {
  eligible: boolean;
  title: string;
  facebook: string;
  instagram: string;
  reason: string;
};

export async function generateDraft(
  text: string,
): Promise<{ draft: AiDraft; model: string }> {
  const prompt = [
    "قيّم رسالة من مجموعة واتساب تجارية وأنشئ منشورين عربيين ملائمين لفيسبوك وإنستغرام.",
    "أعد JSON فقط بالمفاتيح eligible (boolean), title, facebook, instagram, reason.",
    "eligible=true فقط إذا كان المحتوى عرضاً/منتجاً/خدمةً تجارية واضحة صالحة للنشر العام.",
    "لا تنشر محادثة أو طلب عميل أو بيانات شخصية أو أرقاماً أو رموز تحقق أو معلومة غير مؤكدة.",
    "لا تخترع سعراً أو خصماً أو ضماناً أو مواصفة أو رابطاً. استخدم الوقائع الصريحة فقط.",
    "استخدم النص فقط، ولا تحلل الصور أو الفيديوهات أو روابطها.",
    "إذا كان المحتوى غير مؤهل أو ملتبساً اجعل eligible=false واكتب سبباً قصيراً.",
    `نص الرسالة المصدر:\n${text || "(لا يوجد نص)"}`,
  ].join("\n");

  const systemInstruction = "حلّل النص بحذر ولا تستنتج معلومات غير مذكورة فيه.";
  let generatedResult = await callAiProvider({
    openAiMessages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    openAiResponseFormat: { type: "json_object" },
    geminiContents: [{ parts: [{ text: prompt }] }],
    geminiSystemInstruction: systemInstruction,
    geminiResponseFormat: {
      text: {
        mimeType: "application/json",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            eligible: { type: "boolean" },
            title: { type: "string" },
            facebook: { type: "string" },
            instagram: { type: "string" },
            reason: { type: "string" },
          },
          required: ["eligible", "title", "facebook", "instagram", "reason"],
        },
      },
    },
    temperature: 0.2,
    maxTokens: 900,
    timeoutMs: 45_000,
  });
  let content = generatedResult.content;
  let model = generatedResult.model;

  if (!content) throw new Error("AI_EMPTY_RESPONSE");
  // Log a short, safe excerpt of AI output for debugging JSON parsing issues (no secrets)
  try {
    console.debug("AI raw content excerpt:", String(content).slice(0, 1000));
  } catch {}
  const tryParseJsonWithSanitizer = (raw: string): Partial<AiDraft> => {
    // First attempt: strict parse
    try {
      return JSON.parse(raw) as Partial<AiDraft>;
    } catch (e) {
      // continue to tolerant attempts
    }
    // Try extracting the first JSON object in the response
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first !== -1) {
      // If there is a closing brace, extract between them; otherwise take to the end and attempt to close
      const hasClosing = last !== -1 && last > first;
      let sub = hasClosing ? raw.slice(first, last + 1) : raw.slice(first);
      // If JSON seems truncated (no closing brace), attempt to close open strings and object
      if (!hasClosing) {
        // balance double quotes
        const dqCount = (sub.match(/\"/g) || []).length;
        if (dqCount % 2 === 1) sub = sub + '"';
        // ensure there's a closing brace
        sub = sub + "}";
      }
      try {
        return JSON.parse(sub) as Partial<AiDraft>;
      } catch (e) {
        // try common fixes: single quotes -> double quotes
      }
      const dbl = sub.replace(/'/g, '"');
      try {
        return JSON.parse(dbl) as Partial<AiDraft>;
      } catch (e) {
        // try quoting unquoted keys: { key: -> { "key":
      }
      const quoted = dbl.replace(/([{,]\s*)([A-Za-z0-9_\-]+)\s*:/g, '$1"$2":');
      try {
        return JSON.parse(quoted) as Partial<AiDraft>;
      } catch (e) {
        // fall through
      }
    }
    // If nothing worked, throw a clear error for higher-level handling
    throw new Error("AI_INVALID_JSON_RESPONSE");
  };
  let result: Partial<AiDraft> | null = null;
  try {
    result = tryParseJsonWithSanitizer(content) as Partial<AiDraft>;
  } catch (e) {
    // Try to repair invalid JSON by re-requesting from Gemini if available
    if (process.env.GEMINI_API_KEY) {
      try {
        const repaired = await callAiProvider({
          preferredProvider: "gemini",
          geminiContents: [{ parts: [{ text: prompt }] }],
          geminiSystemInstruction: "حلّل النص بحذر ولا تستنتج معلومات غير مذكورة فيه.",
          geminiResponseFormat: {
            text: { mimeType: "application/json" },
          },
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 45_000,
        });
        content = repaired.content;
        model = repaired.model;
        result = tryParseJsonWithSanitizer(content) as Partial<AiDraft>;
        console.warn("AI response repaired via Gemini fallback for JSON validity");
      } catch (err) {
        throw new Error("AI_INVALID_JSON_RESPONSE");
      }
    } else {
      throw new Error("AI_INVALID_JSON_RESPONSE");
    }
  }
  if (!result || typeof result.eligible !== "boolean") throw new Error("AI_INVALID_ASSESSMENT");
  return {
    model,
    draft: {
      eligible: result.eligible,
      title: typeof result.title === "string" ? result.title.trim().slice(0, 120) : "",
      facebook: typeof result.facebook === "string" ? result.facebook.trim().slice(0, 5000) : "",
      instagram: typeof result.instagram === "string" ? result.instagram.trim().slice(0, 2200) : "",
      reason: typeof result.reason === "string" ? result.reason.trim().slice(0, 300) : "",
    },
  };
}
