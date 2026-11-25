/**
 * inbound-webhook-diagnostics.ts
 *
 * One vocabulary for "an inbound event did or did not become work".
 *
 * The WhatsApp and Meta webhook handlers used to return silently for most
 * outcomes: a rejected secret, an unknown instance, an ignored event and a
 * missing signature all looked identical in the logs — nothing. When inbound
 * delivery stops, that silence is indistinguishable from "the provider never
 * called us", which is a different fault with a different fix.
 *
 * Every outcome now maps to a stable event name, a log level, an Arabic hint for
 * the operator, and a flag saying whether the outcome proves the provider
 * reached the server at all. The mapping is pure so it can be tested, and the
 * emitter takes a logger-shaped object so a test can capture what was logged.
 */

export type InboundWebhookPlatform = "whatsapp" | "facebook" | "instagram";

export type InboundWebhookLevel = "debug" | "info" | "warn" | "error";

export type InboundWebhookOutcome = {
  /** Stable log event name, e.g. `WHATSAPP_WEBHOOK_REJECTED_SECRET`. */
  event: string;
  level: InboundWebhookLevel;
  /** True when this outcome proves the provider reached the API. */
  deliveryConfirmed: boolean;
  /** Arabic guidance for whoever reads the log. */
  hint: string;
};

export type WhatsAppInboundReason =
  | "PAYLOAD_NOT_OBJECT"
  | "REJECTED_SECRET"
  | "DUPLICATE"
  | "IGNORED_EVENT"
  | "MISSING_INSTANCE_OR_JID"
  | "UNKNOWN_INSTANCE"
  | "AMBIGUOUS_INSTANCE"
  | "INACTIVE_CONNECTION"
  | "PROCESSED";

export type MetaInboundReason =
  | "MISSING_APP_SECRET"
  | "REJECTED_SIGNATURE"
  | "INVALID_JSON"
  | "IGNORED_OBJECT"
  | "MISSING_ACCOUNT_ID"
  | "UNKNOWN_ACCOUNT"
  | "AMBIGUOUS_ACCOUNT"
  | "NO_EVENTS"
  | "AUTO_REPLY_DISABLED"
  | "AUTO_REPLY_CHANNEL_OFF"
  | "INBOX_STORED"
  | "AUTO_REPLY_QUEUED"
  | "PROCESSED";

const whatsAppOutcomes: Record<WhatsAppInboundReason, Omit<InboundWebhookOutcome, "event">> = {
  PAYLOAD_NOT_OBJECT: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "وصلت حمولة ليست كائنًا؛ تجاهلها المعالج دون إجراء.",
  },
  REJECTED_SECRET: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "رأس x-evolution-api-key لا يطابق WHATSAPP_EVOLUTION_WEBHOOK_SECRET. وحّد السر ثم أعد تسجيل رابط الويب هوك من شاشة واتساب.",
  },
  DUPLICATE: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "رسالة وصلت مرة أخرى بنفس مفتاح الحدث؛ تم تجاهل التكرار لمنع الازدواج.",
  },
  IGNORED_EVENT: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "الحدث ليس من أحداث الرسائل؛ لا يتطلب إجراءً.",
  },
  MISSING_INSTANCE_OR_JID: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "الحمولة لا تحمل instance أو remoteJid. تحقق من إعداد الويب هوك في Evolution (webhookByEvents والأحداث المفعّلة).",
  },
  UNKNOWN_INSTANCE: {
    // Not a typo in a config file: instance names are
    // `menaflow-` + sha256(workspaceId)[0:12], so a name no connection row
    // matches is a session left behind by a workspace that was deleted or
    // migrated away — and it can still be the session holding the phone's live
    // events, which is how an inbox stays empty while sync keeps working. The
    // re-register button now deletes those leftovers, so it is the first action
    // to offer rather than a full re-pair.
    level: "error",
    deliveryConfirmed: true,
    hint: "لا يوجد اتصال واتساب بهذا الاسم: الغالب جلسة واتساب تركتها مساحة عمل محذوفة وما زالت تستلم الرسائل فترفضها. اضغط «إعادة تسجيل الويب هوك» في شاشة واتساب ليزيلها الخادم ويعيد تسجيل رابطك، فإن بقيت فارغة أعد ربط الرقم.",
  },
  AMBIGUOUS_INSTANCE: {
    level: "error",
    deliveryConfirmed: true,
    hint: "أكثر من اتصال مسجل بنفس اسم المثيل. افصل الرقم من مساحة العمل غير المستخدمة.",
  },
  INACTIVE_CONNECTION: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "وصل حدث من جلسة غير نشطة؛ لم تُعالج الرسالة حمايةً لملكية الرقم.",
  },
  PROCESSED: {
    level: "info",
    deliveryConfirmed: true,
    hint: "تمت معالجة الحدث.",
  },
};

const metaOutcomes: Record<MetaInboundReason, Omit<InboundWebhookOutcome, "event">> = {
  MISSING_APP_SECRET: {
    level: "error",
    deliveryConfirmed: true,
    hint: "FACEBOOK_APP_SECRET غير مضبوط، لذا لا يمكن التحقق من التوقيع. أضفه إلى متغيرات البيئة ثم أعد النشر.",
  },
  REJECTED_SIGNATURE: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "توقيع x-hub-signature-256 لا يطابق FACEBOOK_APP_SECRET. تحقق من سر التطبيق في لوحة Meta.",
  },
  INVALID_JSON: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "تعذر تحليل جسم الويب هوك كـ JSON.",
  },
  IGNORED_OBJECT: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "كائن الويب هوك ليس page أو instagram؛ تم تجاهله.",
  },
  MISSING_ACCOUNT_ID: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "الدفعة لا تحمل معرّف صفحة أو حساب إنستغرام.",
  },
  UNKNOWN_ACCOUNT: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "لا يوجد اتصال Meta بهذا المعرّف. أعد ربط الصفحة أو حساب إنستغرام لتجديد الاشتراكات.",
  },
  AMBIGUOUS_ACCOUNT: {
    level: "error",
    deliveryConfirmed: true,
    hint: "أكثر من اتصال Meta لنفس المعرّف؛ أزل الاتصال المكرر.",
  },
  NO_EVENTS: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "لم تُستخرج أحداث من الدفعة (قد تكون إشعار قراءة أو حالة).",
  },
  AUTO_REPLY_DISABLED: {
    level: "info",
    deliveryConfirmed: true,
    hint: "وصل الحدث وحُفظ في الصندوق، لكن الرد الآلي متوقف في الإعدادات.",
  },
  AUTO_REPLY_CHANNEL_OFF: {
    level: "info",
    deliveryConfirmed: true,
    hint: "قناة الرد الآلي لهذه المنصة أو هذا النوع (رسالة/تعليق) غير مفعّلة.",
  },
  INBOX_STORED: {
    level: "info",
    deliveryConfirmed: true,
    hint: "حُفظت عناصر جديدة في صندوق الوارد.",
  },
  AUTO_REPLY_QUEUED: {
    level: "info",
    deliveryConfirmed: true,
    hint: "تم جدولة رد آلي.",
  },
  PROCESSED: {
    level: "info",
    deliveryConfirmed: true,
    hint: "تمت معالجة الويب هوك.",
  },
};

export function describeWhatsAppInboundOutcome(
  reason: WhatsAppInboundReason,
): InboundWebhookOutcome {
  return { event: `WHATSAPP_WEBHOOK_${reason}`, ...whatsAppOutcomes[reason] };
}

export function describeMetaInboundOutcome(
  reason: MetaInboundReason,
): InboundWebhookOutcome {
  return { event: `META_WEBHOOK_${reason}`, ...metaOutcomes[reason] };
}

export type WhatsAppAutoReplySkipReason =
  | "not_message_upsert"
  | "not_direct_incoming"
  | "not_phone_jid"
  | "no_message_candidate"
  | "message_too_old"
  | "customer_opted_out"
  | "auto_reply_disabled"
  | "no_message_text"
  | "no_remote_message_id";

const autoReplySkipOutcomes: Record<
  WhatsAppAutoReplySkipReason,
  Omit<InboundWebhookOutcome, "event">
> = {
  not_message_upsert: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "الحدث ليس إدراج رسالة.",
  },
  not_direct_incoming: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "الرسالة ليست فردية واردة (مجموعة أو صادرة منك).",
  },
  not_phone_jid: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "المعرّف ليس رقم هاتف؛ الرد الآلي يقتصر على المحادثات الفردية.",
  },
  no_message_candidate: {
    level: "debug",
    deliveryConfirmed: true,
    hint: "لا يوجد جسم رسالة في الحمولة.",
  },
  message_too_old: {
    level: "info",
    deliveryConfirmed: true,
    hint: "الرسالة أقدم من نافذة الرد الآلي؛ تُركت للبشري.",
  },
  customer_opted_out: {
    level: "info",
    deliveryConfirmed: true,
    hint: "العميل طلب التوقف عن الرد الآلي؛ تم تنبيهك للرد يدويًا.",
  },
  auto_reply_disabled: {
    level: "info",
    deliveryConfirmed: true,
    hint: "الرد الآلي متوقف لهذا الاتصال؛ تم تنبيهك بوجود رسالة عميل.",
  },
  no_message_text: {
    level: "info",
    deliveryConfirmed: true,
    hint: "الرسالة بلا نص قابل للرد (وسائط فقط).",
  },
  no_remote_message_id: {
    level: "warn",
    deliveryConfirmed: true,
    hint: "الحمولة بلا معرّف رسالة، لذا لا يمكن منع تكرار الرد.",
  },
};

export function describeWhatsAppAutoReplySkip(
  reason: WhatsAppAutoReplySkipReason,
): InboundWebhookOutcome {
  return {
    event: `WHATSAPP_AUTO_REPLY_SKIPPED_${reason.toUpperCase()}`,
    ...autoReplySkipOutcomes[reason],
  };
}

export type LoggerLike = {
  debug: (context: object, message: string) => void;
  info: (context: object, message: string) => void;
  warn: (context: object, message: string) => void;
  error: (context: object, message: string) => void;
};

/**
 * Emits one outcome line. `context` carries identifiers (instance, jid hash,
 * account id) — never message text, which is encrypted at rest for WhatsApp and
 * must not travel through the log aggregator in plaintext.
 */
export function logInboundWebhookOutcome(
  logger: LoggerLike,
  outcome: InboundWebhookOutcome,
  context: Record<string, unknown> = {},
): void {
  logger[outcome.level](
    { event: outcome.event, hint: outcome.hint, ...context },
    outcome.event,
  );
}

/**
 * Looks an emitted event name back up to its outcome.
 *
 * The delivery log stores the event name, and whoever reads it later — the
 * diagnostics endpoints, the merchant's screen — needs the Arabic hint and the
 * severity that went with it. Deriving the map from the same tables that emit
 * the events keeps a recorded name from ever becoming unreadable.
 */
function outcomesByEvent(): Map<string, InboundWebhookOutcome> {
  const map = new Map<string, InboundWebhookOutcome>();
  for (const reason of Object.keys(
    whatsAppOutcomes,
  ) as WhatsAppInboundReason[]) {
    const outcome = describeWhatsAppInboundOutcome(reason);
    map.set(outcome.event, outcome);
  }
  for (const reason of Object.keys(metaOutcomes) as MetaInboundReason[]) {
    const outcome = describeMetaInboundOutcome(reason);
    map.set(outcome.event, outcome);
  }
  for (const reason of Object.keys(
    autoReplySkipOutcomes,
  ) as WhatsAppAutoReplySkipReason[]) {
    const outcome = describeWhatsAppAutoReplySkip(reason);
    map.set(outcome.event, outcome);
  }
  return map;
}

export function inboundWebhookOutcomeForEvent(
  event: string | null | undefined,
): InboundWebhookOutcome | null {
  const name = event?.trim();
  if (!name) return null;
  return outcomesByEvent().get(name) ?? null;
}

/** Prefix of the auto-reply skip outcomes, which are not delivery refusals. */
const AUTO_REPLY_SKIP_PREFIX = "WHATSAPP_AUTO_REPLY_SKIPPED_";

/**
 * True when a recorded event means the attempt was refused or was unusable,
 * rather than accepted.
 *
 * Warn and error outcomes are exactly those — the accepted ones (`PROCESSED`,
 * `INBOX_STORED`, `AUTO_REPLY_QUEUED`) are info or debug, and so are the
 * deliberately ignored ones. Auto-reply skips are excluded by name even though
 * some are logged at warn: by the time a reply is skipped the message was
 * already stored, so counting it as a refusal would send the merchant to fix
 * their webhook when the setting that mattered was the reply policy.
 */
export function isInboundWebhookRejection(
  event: string | null | undefined,
): boolean {
  const name = event?.trim();
  if (!name) return false;
  if (name.startsWith(AUTO_REPLY_SKIP_PREFIX)) return false;
  const outcome = inboundWebhookOutcomeForEvent(name);
  if (!outcome) return false;
  return outcome.level === "warn" || outcome.level === "error";
}

/** Every event name this module can emit, for documentation and tests. */
export function inboundWebhookEventNames(): string[] {
  return [
    ...(Object.keys(whatsAppOutcomes) as WhatsAppInboundReason[]).map(
      (reason) => describeWhatsAppInboundOutcome(reason).event,
    ),
    ...(Object.keys(metaOutcomes) as MetaInboundReason[]).map((reason) =>
      describeMetaInboundOutcome(reason).event,
    ),
    ...(
      Object.keys(autoReplySkipOutcomes) as WhatsAppAutoReplySkipReason[]
    ).map((reason) => describeWhatsAppAutoReplySkip(reason).event),
  ];
}
