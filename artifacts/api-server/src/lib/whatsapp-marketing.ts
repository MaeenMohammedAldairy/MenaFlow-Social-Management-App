import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, lte, lt, notExists, sql } from "drizzle-orm";
import {
  db,
  menaContentJobs,
  menaContentSettings,
  menaWhatsAppConnections,
  menaWhatsAppGroupSelections,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  posts,
} from "@workspace/db";
import {
  canAutoPublishMessage,
  canAnalyzeWhatsAppMessage,
  isBusinessAuthoredMessage,
  containsSensitivePersonalData,
} from "./whatsapp-marketing-safety";
import { publishPostToMeta } from "./meta-publishing";

const MEDIA_ROOT = path.resolve(
  process.cwd(),
  "..",
  "..",
  "artifacts",
  "api-server",
  "storage",
  "whatsapp",
);

type ProcessOptions = {
  allowAutoPublish?: boolean;
};

function isRetryableContentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (["AbortError", "TimeoutError", "TypeError"].includes(error.name)) return true;
  if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|57P01|40001|40P01|08[0-9A-Z]{3})$/.test(
    String((error as Error & { code?: unknown }).code ?? ""),
  )) return true;
  return /(?:_HTTP_(?:408|425|429|500|502|503|504)|^GEMINI_HTTP_(?:408|425|429|500|502|503|504)$)/.test(
    error.message,
  );
}

type AiDraft = {
  eligible: boolean;
  title: string;
  facebook: string;
  instagram: string;
  reason: string;
};

function settingsChannels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((channel): channel is string =>
    channel === "facebook" || channel === "instagram",
  ))];
}

async function generateDraft(
  text: string,
  media?: { mimeType: string; buffer: Buffer },
): Promise<{ draft: AiDraft; model: string }> {
  const prompt = [
    "قيّم رسالة من مجموعة واتساب تجارية وأنشئ منشورين عربيين ملائمين لفيسبوك وإنستغرام.",
    "أعد JSON فقط بالمفاتيح eligible (boolean), title, facebook, instagram, reason.",
    "eligible=true فقط إذا كان المحتوى عرضاً/منتجاً/خدمةً تجارية واضحة صالحة للنشر العام.",
    "لا تنشر محادثة أو طلب عميل أو بيانات شخصية أو أرقاماً أو رموز تحقق أو معلومة غير مؤكدة.",
    "لا تخترع سعراً أو خصماً أو ضماناً أو مواصفة أو رابطاً. استخدم الوقائع الصريحة فقط.",
    "إذا كان المحتوى غير مؤهل أو ملتبساً اجعل eligible=false واكتب سبباً قصيراً.",
    `نص الرسالة المصدر:\n${text || "(لا يوجد نص)"}`,
  ].join("\n");
  const openAiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  let content: string | null | undefined;
  let model: string;
  const generateWithGemini = async (): Promise<{ content: string; model: string }> => {
    if (!geminiKey) throw new Error("MISSING_GEMINI_KEY");
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    if (media) {
      parts.push({
        inlineData: {
          mimeType: media.mimeType,
          data: media.buffer.toString("base64"),
        },
      });
    }
    const preferredModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
    const models = [...new Set([preferredModel, "gemini-flash-lite-latest"])];
    let lastError: Error = new Error("GEMINI_EMPTY_RESPONSE");
    for (const geminiModel of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
          {
            method: "POST",
            headers: {
              "x-goog-api-key": geminiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: "حلّل بحذر. لا تستنتج من الصورة بيانات غير ظاهرة بوضوح." }] },
              contents: [{ parts }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: "OBJECT",
                  properties: {
                    eligible: { type: "BOOLEAN" },
                    title: { type: "STRING" },
                    facebook: { type: "STRING" },
                    instagram: { type: "STRING" },
                    reason: { type: "STRING" },
                  },
                  required: ["eligible", "title", "facebook", "instagram", "reason"],
                },
                temperature: 0.2,
                maxOutputTokens: 900,
              },
            }),
            signal: AbortSignal.timeout(45_000),
          },
        );
        if (!response.ok) {
          lastError = new Error(`GEMINI_HTTP_${response.status}`);
          if ([404, 429, 500, 502, 503, 504].includes(response.status) && geminiModel !== models.at(-1)) {
            console.warn("Configured Gemini model unavailable; trying fallback model", {
              reason: lastError.message,
            });
            continue;
          }
          throw lastError;
        }
        const payload = await response.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const generated = payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("");
        if (generated) return { content: generated, model: geminiModel };
        lastError = new Error("GEMINI_EMPTY_RESPONSE");
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("GEMINI_REQUEST_FAILED");
        if (
          geminiModel !== models.at(-1) &&
          (lastError.name === "TypeError" || lastError.name === "TimeoutError" || lastError.message === "GEMINI_EMPTY_RESPONSE")
        ) {
          console.warn("Configured Gemini model request failed; trying fallback model", {
            reason: lastError.name === "Error" ? lastError.message : lastError.name,
          });
          continue;
        }
        throw lastError;
      }
    }
    throw lastError;
  };

  const generateWithOpenAI = async (): Promise<{ content: string; model: string }> => {
    if (!openAiKey) throw new Error("MISSING_OPENAI_KEY");
    const openAiModel = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
    const userContent: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    if (media) {
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${media.mimeType};base64,${media.buffer.toString("base64")}`,
          detail: "low",
        },
      });
    }
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openAiModel,
        messages: [
          { role: "system", content: "حلّل بحذر. لا تستنتج من الصورة بيانات غير ظاهرة بوضوح." },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 900,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`OPENAI_HTTP_${response.status}`);
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const generated = payload.choices?.[0]?.message?.content;
    if (!generated) throw new Error("OPENAI_EMPTY_RESPONSE");
    return { content: generated, model: openAiModel };
  };

  if (openAiKey) {
    try {
      ({ content, model } = await generateWithOpenAI());
    } catch (error) {
      if (!geminiKey) throw error;
      const reason = error instanceof Error ? error.message : "OPENAI_REQUEST_FAILED";
      console.warn("WhatsApp content AI provider failed; trying configured fallback", {
        provider: "openai",
        reason,
      });
      ({ content, model } = await generateWithGemini());
    }
  } else if (geminiKey) {
    ({ content, model } = await generateWithGemini());
  } else {
    throw new Error("MISSING_AI_PROVIDER_KEY");
  }
  if (!content) throw new Error("AI_EMPTY_RESPONSE");
  const result = JSON.parse(content) as Partial<AiDraft>;
  if (typeof result.eligible !== "boolean") throw new Error("AI_INVALID_ASSESSMENT");
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

async function saveDraft(
  ownerId: string,
  message: typeof menaWhatsAppMessages.$inferSelect,
  draft: Partial<AiDraft>,
  reason: string,
  model: string | null,
  mediaUrl: string | null,
  safeSourceText: string | null,
) {
  const id = createHash("sha256")
    .update(`${ownerId}:${message.id}`)
    .digest("hex");
  const status = "review";
  const [inserted] = await db
    .insert(posts)
    .values({
      id,
      ownerId,
      title: draft.title || (reason ? "محتوى يحتاج إلى مراجعة" : "منشور تسويقي"),
      body: draft.facebook || draft.instagram || "",
      channels: [],
      status,
      sourceType: "whatsapp",
      sourceMessageId: message.id,
      sourceGroupJid: message.groupJid,
      sourceMessageDate: message.messageTimestamp,
      sourceText: safeSourceText,
      mediaUrls: mediaUrl ? [mediaUrl] : [],
      metadata: {
        instagramBody: draft.instagram ?? "",
        reviewReason: reason || draft.reason || null,
        aiModel: model,
      },
      autoPublish: false,
      autoPublishChannels: [],
      publishResults: {},
      error: reason || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { post: inserted, created: true };
  const [existing] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.ownerId, ownerId), eq(posts.id, id)))
    .limit(1);
  if (!existing) throw new Error("POST_DEDUPLICATION_CONFLICT");
  return { post: existing, created: false };
}

export async function processWhatsAppMessage(
  ownerId: string,
  messageId: string,
  options: ProcessOptions = {},
): Promise<{ outcome: "created" | "existing" | "skipped"; postId?: string; reason?: string }> {
  const [message] = await db
    .select()
    .from(menaWhatsAppMessages)
    .where(and(eq(menaWhatsAppMessages.ownerId, ownerId), eq(menaWhatsAppMessages.id, messageId)))
    .limit(1);
  if (!message || message.messageStatus === "deleted") return { outcome: "skipped", reason: "MESSAGE_NOT_AVAILABLE" };

  const [connection] = await db
    .select()
    .from(menaWhatsAppConnections)
    .where(eq(menaWhatsAppConnections.ownerId, ownerId))
    .limit(1);
  if (!connection) return { outcome: "skipped", reason: "WHATSAPP_CONNECTION_NOT_FOUND" };
  const [selection] = await db
    .select()
    .from(menaWhatsAppGroupSelections)
    .where(
      and(
        eq(menaWhatsAppGroupSelections.ownerId, ownerId),
        eq(menaWhatsAppGroupSelections.instanceName, message.instanceName),
        eq(menaWhatsAppGroupSelections.groupJid, message.groupJid),
        eq(menaWhatsAppGroupSelections.selected, true),
        eq(menaWhatsAppGroupSelections.canPublish, true),
      ),
    )
    .limit(1);
  if (!canAnalyzeWhatsAppMessage({
    isGroup: message.groupJid.endsWith("@g.us"),
    groupSelected: Boolean(selection?.selected),
    groupCanPublish: Boolean(selection?.canPublish),
    messageAvailable: message.messageStatus !== "deleted",
  })) {
    return { outcome: "skipped", reason: "GROUP_NOT_APPROVED" };
  }

  const [existingPost] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.ownerId, ownerId), eq(posts.sourceType, "whatsapp"), eq(posts.sourceMessageId, message.id)))
    .limit(1);
  if (existingPost) return { outcome: "existing", postId: existingPost.id };

  const [media] = await db
    .select()
    .from(menaWhatsAppMessageMedia)
    .where(and(
      eq(menaWhatsAppMessageMedia.ownerId, ownerId),
      eq(menaWhatsAppMessageMedia.messageId, message.id),
    ))
    .limit(1);
  const text = [message.textBody, message.caption].filter(Boolean).join("\n").trim();
  const mediaReady = !message.mediaAvailable || media?.downloadStatus === "stored";
  const safeText = containsSensitivePersonalData(text) ? null : text || null;
  const mediaUrl = media?.downloadStatus === "stored" ? media.id : null;
  if (message.messageType === "albumMessage" && !text && !media) {
    const saved = await saveDraft(
      ownerId,
      message,
      {},
      "ALBUM_CONTAINER_REQUIRES_REVIEW",
      null,
      null,
      null,
    );
    return { outcome: saved.created ? "created" : "existing", postId: saved.post.id, reason: "ALBUM_CONTAINER_REQUIRES_REVIEW" };
  }

  let draft: Partial<AiDraft> = {};
  let model: string | null = null;
  let reason = "";
  if (containsSensitivePersonalData(text)) {
    reason = "SENSITIVE_PERSONAL_DATA_REQUIRES_REVIEW";
  } else if (!mediaReady) {
    reason = "MEDIA_NOT_READY";
  } else if (media && media.mediaType === "video") {
    reason = "VIDEO_ANALYSIS_REQUIRES_MANUAL_REVIEW";
  } else if (media && !media.mimeType?.startsWith("image/")) {
    reason = "MEDIA_TYPE_REQUIRES_MANUAL_REVIEW";
  } else if (!safeText && !media) {
    reason = "EMPTY_MESSAGE";
  } else {
    try {
      let image: { mimeType: string; buffer: Buffer } | undefined;
      if (media) {
        const resolved = path.resolve(media.storagePath);
        if (!resolved.startsWith(`${MEDIA_ROOT}${path.sep}`)) throw new Error("INVALID_MEDIA_STORAGE_PATH");
        const fileStat = await stat(resolved);
        if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > 8 * 1024 * 1024) {
          throw new Error("IMAGE_SIZE_UNSUPPORTED");
        }
        image = { mimeType: media.mimeType || "image/jpeg", buffer: await readFile(resolved) };
      }
      const generated = await generateDraft(safeText ?? "", image);
      draft = generated.draft;
      model = generated.model;
      console.info("WhatsApp marketing analysis completed", {
        messageId: message.id,
        model,
        eligible: draft.eligible === true,
        imageIncluded: Boolean(image),
        mediaId: media?.id ?? null,
        mediaMimeType: image?.mimeType ?? null,
        mediaSizeBytes: image?.buffer.length ?? 0,
      });
      if (!draft.eligible || !draft.facebook || !draft.instagram) {
        reason = draft.reason || "CONTENT_NOT_ELIGIBLE_OR_INCOMPLETE";
      }
    } catch (error) {
      reason = error instanceof Error ? error.message : "AI_ANALYSIS_FAILED";
      console.error("WhatsApp marketing analysis failed", {
        messageId: message.id,
        mediaId: media?.id ?? null,
        reason,
        retryable: isRetryableContentError(error),
      });
      if (isRetryableContentError(error)) throw error;
    }
  }

  const saved = await saveDraft(ownerId, message, draft, reason, model, mediaUrl, safeText);
  if (!saved.created) return { outcome: "existing", postId: saved.post.id };

  const [settings] = await db
    .select()
    .from(menaContentSettings)
    .where(eq(menaContentSettings.ownerId, ownerId))
    .limit(1);
  const channels = settingsChannels(settings?.autoPublishChannels);
  const autoEligible =
    options.allowAutoPublish === true &&
    canAutoPublishMessage({
      isGroup: message.groupJid.endsWith("@g.us"),
      businessAuthored: isBusinessAuthoredMessage(message.senderId, connection.phoneNumber),
      text,
      mediaReady,
      hasUnsupportedVideo: media?.mediaType === "video",
    }) &&
    settings?.autoPublishEnabled === true &&
    Boolean(settings.enabledAt && message.messageTimestamp && message.messageTimestamp >= settings.enabledAt) &&
    !reason &&
    draft.eligible === true &&
    channels.length > 0 &&
    mediaReady;
  if (!autoEligible) return { outcome: "created", postId: saved.post.id, reason: reason || undefined };

  const [locked] = await db
    .update(posts)
    .set({
      status: "publishing",
      channels,
      autoPublish: true,
      autoPublishChannels: channels,
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, saved.post.id), eq(posts.ownerId, ownerId), eq(posts.status, "review")))
    .returning();
  if (!locked) return { outcome: "existing", postId: saved.post.id, reason: "PUBLISH_ALREADY_CLAIMED" };

  let completed: Record<string, { status: string; reason?: string }>;
  const persistedResults = safePublishResults(locked.publishResults);
  try {
    completed = await publishPostToMeta(
      { ...locked, body: draft.facebook || "", metadata: { ...locked.metadata, instagramBody: draft.instagram || "" } },
      channels,
      async (channel, result) => {
        persistedResults[channel] = result;
        await db
          .update(posts)
          .set({ publishResults: { ...persistedResults }, updatedAt: new Date() })
          .where(and(eq(posts.id, locked.id), eq(posts.ownerId, ownerId)));
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "META_PUBLISH_FAILED";
    await db
      .update(posts)
      .set({ status: "failed", error: reason, updatedAt: new Date() })
      .where(and(eq(posts.id, locked.id), eq(posts.ownerId, ownerId)));
    return { outcome: "created", postId: locked.id, reason };
  }
  const allPublished = channels.every((channel) => completed[channel]?.status === "published");
  await db
    .update(posts)
    .set({
      status: allPublished ? "published" : "failed",
      publishResults: completed,
      error: allPublished ? null : "AUTO_PUBLISH_INCOMPLETE",
      updatedAt: new Date(),
    })
    .where(and(eq(posts.id, locked.id), eq(posts.ownerId, ownerId)));
  return {
    outcome: "created",
    postId: locked.id,
    reason: allPublished ? undefined : "AUTO_PUBLISH_INCOMPLETE",
  };
}

function safePublishResults(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export async function processWhatsAppBacklog(
  ownerId: string,
  limit: number,
): Promise<{ scanned: number; created: number; existing: number; skipped: number }> {
  const messages = await db
    .select({ id: menaWhatsAppMessages.id })
    .from(menaWhatsAppMessages)
    .innerJoin(
      menaWhatsAppGroupSelections,
      and(
        eq(menaWhatsAppGroupSelections.ownerId, menaWhatsAppMessages.ownerId),
        eq(menaWhatsAppGroupSelections.instanceName, menaWhatsAppMessages.instanceName),
        eq(menaWhatsAppGroupSelections.groupJid, menaWhatsAppMessages.groupJid),
        eq(menaWhatsAppGroupSelections.selected, true),
        eq(menaWhatsAppGroupSelections.canPublish, true),
      ),
    )
    .where(and(
      eq(menaWhatsAppMessages.ownerId, ownerId),
      eq(menaWhatsAppMessages.messageStatus, "received"),
      notExists(
        db
          .select({ id: posts.id })
          .from(posts)
          .where(and(
            eq(posts.ownerId, menaWhatsAppMessages.ownerId),
            eq(posts.sourceType, "whatsapp"),
            eq(posts.sourceMessageId, menaWhatsAppMessages.id),
          )),
      ),
    ))
    .orderBy(asc(menaWhatsAppMessages.messageTimestamp))
    .limit(limit);
  const results = { scanned: messages.length, created: 0, existing: 0, skipped: 0 };
  for (const message of messages) {
    const result = await processWhatsAppMessage(ownerId, message.id, {
      allowAutoPublish: false,
    });
    results[result.outcome] += 1;
  }
  return results;
}

export async function enqueueWhatsAppMessage(ownerId: string, messageId: string): Promise<void> {
  const id = createHash("sha256").update(`${ownerId}:${messageId}`).digest("hex");
  await db
    .insert(menaContentJobs)
    .values({
      id,
      ownerId,
      messageId,
      status: "pending",
      attempts: 0,
      nextRunAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoNothing();
}

let queueWorkerRunning = false;

export async function processWhatsAppMarketingQueue(): Promise<void> {
  if (queueWorkerRunning) return;
  queueWorkerRunning = true;
  try {
    const staleBefore = new Date(Date.now() - 10 * 60_000);
    await db
      .update(menaContentJobs)
      .set({ status: "pending", updatedAt: new Date() })
      .where(and(
        eq(menaContentJobs.status, "processing"),
        lt(menaContentJobs.updatedAt, staleBefore),
      ));

    const claimed = await db.transaction(async (transaction) => {
      const batch = await transaction
        .select()
        .from(menaContentJobs)
        .where(and(
          eq(menaContentJobs.status, "pending"),
          lte(menaContentJobs.nextRunAt, new Date()),
        ))
        .orderBy(asc(menaContentJobs.createdAt))
        .limit(5)
        .for("update", { skipLocked: true });
      if (batch.length === 0) return [];
      const ids = batch.map((job) => job.id);
      return transaction
        .update(menaContentJobs)
        .set({
          status: "processing",
          attempts: sql`${menaContentJobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(inArray(menaContentJobs.id, ids))
        .returning();
    });

    for (const job of claimed) {
      try {
        const result = await processWhatsAppMessage(job.ownerId, job.messageId, { allowAutoPublish: true });
        await db
          .update(menaContentJobs)
          .set({
            status: result.outcome === "skipped" ? "skipped" : "done",
            lastError: result.reason ?? null,
            updatedAt: new Date(),
          })
          .where(eq(menaContentJobs.id, job.id));
        console.info("WhatsApp content job completed", {
          jobId: job.id,
          messageId: job.messageId,
          outcome: result.outcome,
          postId: result.postId ?? null,
          reason: result.reason ?? null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "WHATSAPP_CONTENT_PROCESSING_FAILED";
        const retry = job.attempts < 3 && isRetryableContentError(error);
        await db
          .update(menaContentJobs)
          .set({
            status: retry ? "pending" : "failed",
            lastError: message,
            nextRunAt: new Date(Date.now() + (retry ? job.attempts * 30_000 : 0)),
            updatedAt: new Date(),
          })
          .where(eq(menaContentJobs.id, job.id));
        console.error("WhatsApp content job failed", {
          jobId: job.id,
          messageId: job.messageId,
          attempt: job.attempts,
          retry,
          reason: message,
        });
      }
    }
  } finally {
    queueWorkerRunning = false;
  }
}
