import { getAuth } from "@clerk/express";
import {
  GenerateAiContentBody,
  GenerateAiContentResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type RequestHandler } from "express";

const router: IRouter = Router();
const requestTimes = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 8;

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  next();
};

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

async function generateWithOpenAI(
  prompt: string,
): Promise<{ content: string; model: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("MISSING_OPENAI_KEY");
  const model = modelName(process.env.OPENAI_MODEL, "gpt-4o-mini");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "أنت مساعد كتابة تسويقية. التزم بالتعليمات واكتب بالعربية فقط.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("OPENAI_EMPTY_RESPONSE");
  return { content, model };
}

async function generateWithGemini(
  prompt: string,
): Promise<{ content: string; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("MISSING_GEMINI_KEY");
  const model = modelName(process.env.GEMINI_MODEL, "gemini-2.5-flash");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 700 },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) throw new Error(`GEMINI_HTTP_${response.status}`);
  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("GEMINI_EMPTY_RESPONSE");
  return { content, model };
}

router.post("/ai/content", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
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

  const { idea, businessContext, provider, tone, channel } = parsed.data;
  const prompt = buildPrompt({ idea, businessContext, tone, channel });
  try {
    const generated =
      provider === "gemini"
        ? await generateWithGemini(prompt)
        : await generateWithOpenAI(prompt);
    res.json(
      GenerateAiContentResponse.parse({
        content: generated.content,
        provider,
        model: generated.model,
      }),
    );
  } catch (error) {
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
