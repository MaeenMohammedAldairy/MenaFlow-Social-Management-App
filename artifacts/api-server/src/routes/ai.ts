import {
  GenerateAiContentBody,
  GenerateAiContentResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import {
  callMeteredAiProvider,
  SubscriptionAiQuotaError,
} from "../lib/metered-ai-provider.ts";

const router: IRouter = Router();
const requestTimes = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 8;

function allowRequest(userId: string): boolean {
  const now = Date.now();
  const recent = (requestTimes.get(userId) ?? []).filter(
    (time) => now - time < WINDOW_MS,
  );
  if (recent.length >= REQUESTS_PER_WINDOW) {
    requestTimes.set(userId, recent);
    return false;
  }
  recent.push(now);
  requestTimes.set(userId, recent);
  if (requestTimes.size > 2_000) {
    for (const [id, times] of requestTimes) {
      if (times.every((time) => now - time >= WINDOW_MS)) {
        requestTimes.delete(id);
      }
    }
  }
  return true;
}

function modelName(raw: string | undefined, defaultModel: string): string {
  const model = raw ?? defaultModel;
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) {
    throw new Error("AI model configuration is invalid.");
  }
  return model;
}

function channelLabel(channel: string): string {
  switch (channel) {
    case "instagram":
      return "إنستغرام";
    case "facebook":
      return "فيسبوك";
    default:
      return "واتساب";
  }
}

const toneLabels: Record<string, string> = {
  professional: "احترافي وواضح",
  friendly: "ودود وقريب من الجمهور",
  promotional: "تسويقي من دون مبالغة",
  concise: "مختصر ومباشر",
};

function buildPrompt(input: {
  idea: string;
  businessContext?: string;
  tone: string;
  channel: string;
}): string {
  const platformLimit =
    input.channel === "whatsapp"
      ? "اجعله مناسباً لرسالة واتساب قصيرة."
      : input.channel === "instagram"
        ? "اجعله مناسباً لمنشور إنستغرام مع افتتاحية جذابة."
        : "اجعله مناسباً لمنشور فيسبوك واضح ومفيد.";

  return [
    "اكتب مسودة منشور تسويقي بالعربية الفصحى السهلة، لجمهور عربي في منطقة الشرق الأوسط وشمال أفريقيا.",
    "اكتب نص المنشور فقط، من دون شرح أو علامات تنسيق أو ادعاءات غير مذكورة.",
    platformLimit,
    `النبرة: ${toneLabels[input.tone] ?? toneLabels.professional}.`,
    `الفكرة: ${input.idea.trim()}`,
    input.businessContext?.trim()
      ? `معلومات النشاط: ${input.businessContext.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}


router.post("/ai/content", requireWorkspace, async (req, res): Promise<void> => {
  const userId = requestOwnerId(req);
  if (!userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }

  const parsed = GenerateAiContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "تحقق من الفكرة والقناة والنبرة المختارة." });
    return;
  }

  if (!allowRequest(userId)) {
    res.status(429).json({ error: "وصلت إلى حد التوليد المؤقت. حاول بعد دقيقة." });
    return;
  }

  const workspaceId = requestWorkspaceId(req);
  const { idea, businessContext, provider, tone, channel } = parsed.data;
  const prompt = buildPrompt({ idea, businessContext, tone, channel });
  try {
    const generated = await callMeteredAiProvider(workspaceId, {
      preferredProvider: provider === "gemini" ? "gemini" : undefined,
      openAiMessages: [
        { role: "system", content: "أنت مساعد كتابة تسويقية. التزم بالتعليمات واكتب بالعربية فقط." },
        { role: "user", content: prompt },
      ],
      geminiContents: [{ parts: [{ text: prompt }] }],
      geminiSystemInstruction: "أنت مساعد كتابة تسويقية. التزم بالتعليمات واكتب بالعربية فقط.",
      temperature: 0.7,
      maxTokens: 700,
      timeoutMs: 30_000,
    });
    res.json(
      GenerateAiContentResponse.parse({
        content: generated.content,
        provider: generated.provider,
        model: generated.model,
      }),
    );
  } catch (error) {
    if (error instanceof SubscriptionAiQuotaError) {
      res.status(429).json({
        error: "بلغت الحد الشهري لتوليد المحتوى في خطتك الحالية.",
        code: "SUBSCRIPTION_LIMIT_REACHED",
        usage: error.used,
        limit: error.limit,
      });
      return;
    }
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("MISSING_")) {
      res.status(503).json({
        error: `خدمة ${provider === "gemini" ? "Gemini" : "OpenAI"} غير مهيأة.`,
      });
      return;
    }
    req.log.warn(
      { provider, reason: message.startsWith("AI model") ? "model_config" : "provider_error" },
      "AI content generation failed",
    );
    res.status(502).json({
      error: "تعذر إنشاء المحتوى الآن. تحقق من إعداد الخدمة ثم حاول مرة أخرى.",
    });
  }
});

export default router;
