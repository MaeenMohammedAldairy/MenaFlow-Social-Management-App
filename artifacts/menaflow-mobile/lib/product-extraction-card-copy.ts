/**
 * product-extraction-card-copy.ts
 *
 * The three derivations the extraction review card and the reprocess action need
 * for what the run *did*, as opposed to what the model found.
 *
 * Both used to be improvised at the call site. A card said nothing about the
 * group's photos, so a price read from text alone looked identical to a price
 * read from text and three pictures — and an "أُعيد التحليل" notice was shown
 * whether or not anything had been armed, which is how a re-extraction that the
 * server refused as already-covered read as success for days.
 *
 * The wording comes from the server (`mediaStateMessage`, and the fact records
 * with their quotes); this module only decides when a line has to be shown. Pure
 * and separate from `product-catalog-api.ts` because that one imports the
 * generated client, so a node test cannot read it.
 */

/** The part of a suggestion row this module needs; the card passes the row. */
export type ProductExtractionMediaSignals = {
  /** What happened to the group's photos, as the extraction recorded it. */
  mediaState?: string | null;
  /** The server's sentence for that state, in the merchant's language. */
  mediaStateMessage?: string | null;
};

/**
 * States worth a line on the card.
 *
 * `included` needs none — nothing went wrong — and `not_applicable` would put a
 * warning about missing photos on a message that never had any, which is the
 * mistake the field was added to fix rather than to repeat.
 */
const INCOMPLETE_MEDIA_STATES: readonly string[] = ["partial", "lost", "pending"];

/**
 * The one line saying what the reading could not see, or `null` when the card
 * should stay quiet about images.
 */
export function productExtractionMediaNote(
  signals: ProductExtractionMediaSignals,
): string | null {
  if (!signals.mediaState) return null;
  if (!INCOMPLETE_MEDIA_STATES.includes(signals.mediaState)) return null;
  // No invented fallback text: a state without its sentence is a contract gap,
  // and a silent card is truer here than a sentence about the wrong problem.
  return signals.mediaStateMessage ?? null;
}

/** The reprocess endpoint's answer for one suggestion. */
export type ReprocessResult = {
  /** Whether any job of the group was armed for a new run. */
  queued?: boolean;
  /** Members that had a job and got it back. */
  reopened?: number;
  /** Members that had no job at all and got one. */
  created?: number;
  /** Whether the extraction worker is running at all. */
  workerEnabled?: boolean;
};

export type ReprocessNotice = {
  title: string;
  message: string;
  tone: "info" | "success" | "error";
};

/**
 * What to tell the merchant after re-arming one or more groups.
 *
 * Three outcomes, and the difference between them is the whole point: a job
 * that was armed, a group that was already covered at this ruleset version, and
 * a job that is armed but will not run because the worker is switched off. Only
 * the first deserves a green check.
 */
export function productExtractionReprocessNotice(
  results: readonly ReprocessResult[],
): ReprocessNotice {
  const armed = results.reduce(
    (total, result) => total + (result.reopened ?? 0) + (result.created ?? 0),
    0,
  );
  const queuedCount = results.filter((result) => result.queued).length;
  if (results.some((result) => result.workerEnabled === false)) {
    return {
      title: "أُعيد الإدخال إلى الطابور، لكن خادم التحليل متوقف",
      message:
        "لن تبدأ نسخة جديدة حتى يُشغَّل عامل الاستخراج (WHATSAPP_PRODUCT_EXTRACTION_WORKER_ENABLED).",
      tone: "info",
    };
  }
  if (queuedCount === 0 || armed === 0) {
    return {
      title: "لم تبدأ نسخة جديدة",
      message:
        "مجموعة هذه الرسائل حُلِّلت سابقًا بنفس القواعد، فلا شيء يُعاد قراءته. أضف رسالة أو صورة إلى المجموعة، أو اختر إعادة التحليل من نسخة أقدم.",
      tone: "info",
    };
  }
  return {
    // Singular for one message, plural for a selection: the same string for both
    // is how a bulk action and a single row become indistinguishable at a glance.
    title: armed === 1 ? "أُعيدت الرسالة إلى التحليل" : "أُعيدت الرسائل إلى التحليل",
    message:
      armed === 1
        ? "سُجِّلت هذه الرسالة في الطابور، وستظهر نسخة جديدة من اقتراحها بعد اكتمال التحليل."
        : `سُجِّلت ${armed} رسالة في الطابور، وستظهر نسخة جديدة من اقتراح كل مجموعة بعد اكتمال التحليل.`,
    tone: "success",
  };
}

/** One fact as the extraction stored it: a value plus the words that prove it. */
export type ProductExtractionFactSignal = {
  value?: string | null;
  /** The literal phrase in the source message the value was taken from. */
  quote?: string | null;
  /** False when the value appeared in no quote: a lead, not a fact. */
  verified?: boolean;
};

const FACT_GROUPS: ReadonlyArray<readonly [string, string]> = [
  ["features", "مزايا"],
  ["specifications", "مواصفات"],
  ["accessories", "ملحقات"],
];

export type ProductExtractionFactLine = {
  key: string;
  /** The group label and the value, e.g. «مزايا: 12 رأس تدليك». */
  text: string;
  /** False when nothing in the message backs the value. */
  verified: boolean;
};

/**
 * The structured parts of the offer, one line each, unverified ones marked.
 *
 * A fact is worth a line because it is the merchant's own wording with a
 * location in the message; it is worth marking because a value the model produced
 * without a quote is exactly the kind of line a publication should not repeat.
 */
export function productExtractionFactLines(extractedData: unknown): ProductExtractionFactLine[] {
  const data = (extractedData ?? {}) as Record<string, unknown>;
  const lines: ProductExtractionFactLine[] = [];
  for (const [field, label] of FACT_GROUPS) {
    const facts = data[field];
    if (!Array.isArray(facts)) continue;
    for (const [index, fact] of facts.entries()) {
      const record = (fact ?? {}) as ProductExtractionFactSignal;
      const value = typeof record.value === "string" ? record.value.trim() : "";
      if (!value) continue;
      lines.push({
        key: `${field}-${index}`,
        text: `${label}: ${value}`,
        verified: record.verified !== false,
      });
    }
  }
  return lines;
}
