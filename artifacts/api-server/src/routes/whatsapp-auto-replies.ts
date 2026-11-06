import { and, eq } from "drizzle-orm";
import { autoReplySettingsHash } from "../lib/whatsapp-auto-reply-policy";
import {
  db,
  menaWhatsAppConnections,
} from "@workspace/db";
import { Router, type IRouter, type Response } from "express";
import { requestOwnerId } from "../lib/owner-access";
import { generateWhatsAppAutoReply } from "../lib/whatsapp-auto-reply";
import type {
  WhatsAppAutoReplyLanguage,
  WhatsAppAutoReplyTone,
} from "../lib/whatsapp-auto-reply-policy";
import {
  EvolutionApiError,
  evolutionConnectionState,
} from "../lib/whatsapp-evolution";
import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";
import { isRecord } from "../lib/value-utils.ts";
import { evolutionErrorResponse } from "./whatsapp-route-errors";

const router: IRouter = Router();
const testRequestTimes = new Map<string, number[]>();
const testWindowMs = 60_000;
const maxTestRequests = 5;

const languages = new Set<WhatsAppAutoReplyLanguage>(["ar", "match_customer"]);
const tones = new Set<WhatsAppAutoReplyTone>([
  "friendly_professional",
  "concise",
  "formal",
]);

function parseAutoReplySettings(value: unknown): {
  enabled: boolean;
  language: WhatsAppAutoReplyLanguage;
  tone: WhatsAppAutoReplyTone;
  instructions: string;
} | null {
  if (!isRecord(value)) return null;
  const { enabled, language, tone, instructions } = value;
  if (
    typeof enabled !== "boolean" ||
    typeof language !== "string" ||
    !languages.has(language as WhatsAppAutoReplyLanguage) ||
    typeof tone !== "string" ||
    !tones.has(tone as WhatsAppAutoReplyTone) ||
    typeof instructions !== "string" ||
    instructions.length > 2000
  ) {
    return null;
  }
  return {
    enabled,
    language: language as WhatsAppAutoReplyLanguage,
    tone: tone as WhatsAppAutoReplyTone,
    instructions: instructions.trim(),
  };
}

async function connectionForRequest(
  ownerId: string,
  workspaceId: string,
) {
  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(and(
      eq(menaWhatsAppConnections.ownerId, ownerId),
      eq(menaWhatsAppConnections.workspaceId, workspaceId),
    ))
    .limit(1);
  return connection ?? null;
}

async function liveConnectionState(
  res: Response,
  instanceName: string,
  operation: string,
): Promise<string | null> {
  try {
    return await evolutionConnectionState(instanceName);
  } catch (error) {
    evolutionErrorResponse(
      res,
      error instanceof EvolutionApiError
        ? error
        : new EvolutionApiError(502, "EVOLUTION_API_REQUEST_FAILED"),
      operation,
    );
    return null;
  }
}

function allowTestRequest(workspaceId: string): boolean {
  const now = Date.now();
  const recent = (testRequestTimes.get(workspaceId) ?? []).filter(
    (time) => now - time < testWindowMs,
  );
  if (recent.length >= maxTestRequests) {
    testRequestTimes.set(workspaceId, recent);
    return false;
  }
  recent.push(now);
  testRequestTimes.set(workspaceId, recent);
  if (testRequestTimes.size > 2_000) {
    for (const [key, times] of testRequestTimes) {
      if (times.every((time) => now - time >= testWindowMs)) {
        testRequestTimes.delete(key);
      }
    }
  }
  return true;
}

function aiErrorResponse(
  res: Response,
  error: unknown,
): void {
  const reason = error instanceof Error ? error.message : "AI_REQUEST_FAILED";
  if (reason.startsWith("MISSING_")) {
    res.status(503).json({
      error: "خدمة الذكاء الاصطناعي غير مهيأة. أضف مفتاح Gemini أو OpenAI إلى إعدادات الخادم.",
    });
    return;
  }
  console.error("WhatsApp auto-reply generation failed", {
    reason: reason.slice(0, 80),
  });
  if (/OPENAI_HTTP_401|OPENAI_HTTP_403/.test(reason) && /GEMINI_HTTP_5\d\d/.test(reason)) {
    res.status(502).json({
      error: "مفتاح OpenAI المهيأ مرفوض، وخدمة Gemini الاحتياطية غير متاحة مؤقتًا. صحّح مفتاح OpenAI في إعدادات الخادم ثم أعد المحاولة لاحقًا.",
    });
    return;
  }
  if (/GEMINI_HTTP_401|GEMINI_HTTP_403/.test(reason) && /OPENAI_HTTP_5\d\d/.test(reason)) {
    res.status(502).json({
      error: "مفتاح Gemini المهيأ مرفوض، وخدمة OpenAI الاحتياطية غير متاحة مؤقتًا. صحّح مفتاح Gemini في إعدادات الخادم ثم أعد المحاولة لاحقًا.",
    });
    return;
  }
  if (/HTTP_(401|403)/.test(reason)) {
    res.status(502).json({
      error: "رفض مزود الذكاء الاصطناعي مفتاح API أو صلاحية النموذج. تحقّق من مفاتيح OpenAI وGemini في إعدادات الخادم ثم أعد المحاولة.",
    });
    return;
  }
  if (/HTTP_429/.test(reason)) {
    res.status(502).json({
      error: "وصل مزود الذكاء الاصطناعي إلى حد الاستخدام أو الطلبات. تحقّق من الرصيد والحصة المسموحة ثم أعد المحاولة.",
    });
    return;
  }
  if (/HTTP_5\d\d/.test(reason)) {
    res.status(502).json({
      error: "مزود الذكاء الاصطناعي غير متاح مؤقتًا. أعد المحاولة بعد قليل؛ وإذا تكرر الخطأ فتحقّق من حالة مزود الخدمة.",
    });
    return;
  }
  if (/fetch failed|NETWORK|TIMEOUT/i.test(reason)) {
    res.status(502).json({
      error: "تعذّر اتصال الخادم بمزود الذكاء الاصطناعي. تحقّق من اتصال الإنترنت الصادر للخادم ثم أعد المحاولة.",
    });
    return;
  }
  if (/INCOMPLETE_RESPONSE/.test(reason)) {
    res.status(502).json({
      error: "أعاد مزود الذكاء الاصطناعي ردًا غير مكتمل، لذلك لم يُعتمد الاختبار. أعد المحاولة.",
    });
    return;
  }
  res.status(502).json({
    error: "تعذّر إنشاء الرد التجريبي. تحقق من إعدادات مزود الذكاء الاصطناعي في الخادم ثم أعد المحاولة.",
  });
}

router.get(
  "/social/whatsapp/auto-reply-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const connection = await connectionForRequest(ownerId, workspaceId);
    if (!connection) {
      res.status(404).json({ error: "لا يوجد حساب واتساب مربوط بهذه المساحة." });
      return;
    }
    const state = await liveConnectionState(
      res,
      connection.instanceName,
      "Error checking WhatsApp auto-reply settings",
    );
    if (state === null) return;
    res.json({
      connected: state === "open",
      phoneNumber: connection.phoneNumber,
      settings: {
        enabled: connection.autoReplyEnabled,
        language: connection.autoReplyLanguage,
        tone: connection.autoReplyTone,
        instructions: connection.autoReplyInstructions ?? "",
      },
    });
  },
);

router.put(
  "/social/whatsapp/auto-reply-settings",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const settings = parseAutoReplySettings(req.body);
    if (!settings) {
      res.status(400).json({
        error: "تحقق من حالة التفعيل واللغة والأسلوب، على ألا تتجاوز التعليمات 2000 حرف.",
      });
      return;
    }
    const connection = await connectionForRequest(ownerId, workspaceId);
    if (!connection) {
      res.status(404).json({ error: "لا يوجد حساب واتساب مربوط بهذه المساحة." });
      return;
    }
    const state = await liveConnectionState(
      res,
      connection.instanceName,
      "Error validating WhatsApp connection before saving auto replies",
    );
    if (state === null) return;
    if (state !== "open") {
      res.status(409).json({
        error: "حساب واتساب غير متصل الآن. أعد ربطه قبل حفظ إعدادات الردود.",
      });
      return;
    }
    if (
      settings.enabled &&
      !process.env.OPENAI_API_KEY?.trim() &&
      !process.env.GEMINI_API_KEY?.trim()
    ) {
      res.status(503).json({
        error: "خدمة الذكاء الاصطناعي غير مهيأة. لا يمكن تفعيل الردود الآلية الآن.",
      });
      return;
    }
    if (
      settings.enabled &&
      connection.autoReplyTestedHash !== autoReplySettingsHash(settings)
    ) {
      res.status(409).json({
        error: "اختبر الرد بهذه الإعدادات أولاً قبل تفعيل الإرسال الآلي.",
      });
      return;
    }
    const settingsChanged =
      connection.autoReplyLanguage !== settings.language ||
      connection.autoReplyTone !== settings.tone ||
      (connection.autoReplyInstructions ?? "") !== settings.instructions;
    const [updated] = await db
      .update(menaWhatsAppConnections)
      .set({
        autoReplyEnabled: settings.enabled,
        autoReplyLanguage: settings.language,
        autoReplyTone: settings.tone,
        autoReplyInstructions: settings.instructions || null,
        ...(settingsChanged && !settings.enabled
          ? { autoReplyTestedHash: null }
          : {}),
      })
      .where(and(
        eq(menaWhatsAppConnections.ownerId, ownerId),
        eq(menaWhatsAppConnections.workspaceId, workspaceId),
      ))
      .returning({
        autoReplyEnabled: menaWhatsAppConnections.autoReplyEnabled,
        autoReplyLanguage: menaWhatsAppConnections.autoReplyLanguage,
        autoReplyTone: menaWhatsAppConnections.autoReplyTone,
        autoReplyInstructions: menaWhatsAppConnections.autoReplyInstructions,
      });
    if (!updated) {
      res.status(409).json({ error: "تغيّر اتصال واتساب. حدّث الصفحة وحاول مرة أخرى." });
      return;
    }
    res.json({
      enabled: updated.autoReplyEnabled,
      language: updated.autoReplyLanguage,
      tone: updated.autoReplyTone,
      instructions: updated.autoReplyInstructions ?? "",
    });
  },
);

router.post(
  "/social/whatsapp/auto-reply-test",
  requireWorkspace,
  async (req, res) => {
    const ownerId = requestOwnerId(req);
    const workspaceId = requestWorkspaceId(req);
    if (!ownerId) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const settings = parseAutoReplySettings({
      ...req.body,
      enabled: false,
    });
    const customerMessage =
      typeof req.body?.customerMessage === "string"
        ? req.body.customerMessage.trim()
        : "";
    if (!settings || !customerMessage || customerMessage.length > 1000) {
      res.status(400).json({
        error: "أدخل رسالة اختبار صحيحة، مع إعدادات لا تتجاوز حدود الحقول.",
      });
      return;
    }
    if (!allowTestRequest(workspaceId)) {
      res.status(429).json({
        error: "وصلت إلى حد الاختبارات المؤقت. انتظر دقيقة ثم حاول مرة أخرى.",
      });
      return;
    }
    const connection = await connectionForRequest(ownerId, workspaceId);
    if (!connection) {
      res.status(404).json({ error: "لا يوجد حساب واتساب مربوط بهذه المساحة." });
      return;
    }
    const state = await liveConnectionState(
      res,
      connection.instanceName,
      "Error validating WhatsApp connection before testing auto replies",
    );
    if (state === null) return;
    if (state !== "open") {
      res.status(409).json({
        error: "حساب واتساب غير متصل الآن. أعد ربطه قبل اختبار الرد.",
      });
      return;
    }
    try {
      const reply = await generateWhatsAppAutoReply(
        workspaceId,
        customerMessage,
        settings,
      );
      await db
        .update(menaWhatsAppConnections)
        .set({ autoReplyTestedHash: autoReplySettingsHash(settings) })
        .where(and(
          eq(menaWhatsAppConnections.ownerId, ownerId),
          eq(menaWhatsAppConnections.workspaceId, workspaceId),
        ));
      res.json({ reply });
    } catch (error) {
      aiErrorResponse(res, error);
    }
  },
);

export default router;
