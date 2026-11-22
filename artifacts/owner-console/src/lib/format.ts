const numberFormatter = new Intl.NumberFormat("ar-EG-u-nu-latn");

const dateTimeFormatter = new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return numberFormatter.format(value);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return dateTimeFormatter.format(date);
}

export function formatAge(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `قبل ${formatNumber(minutes)} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${formatNumber(hours)} ساعة`;
  return `قبل ${formatNumber(Math.round(hours / 24))} يوم`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1_000) return `${formatNumber(ms)} مللي`;
  return `${formatNumber(Math.round(ms / 100) / 10)} ثانية`;
}

export function formatInterval(ms: number): string {
  if (ms % 60_000 === 0) return `كل ${formatNumber(ms / 60_000)} دقيقة`;
  if (ms % 1_000 === 0) return `كل ${formatNumber(ms / 1_000)} ثانية`;
  return `${formatNumber(ms)} مللي`;
}

const statusLabels: Record<string, string> = {
  queued: "في الانتظار",
  processing: "قيد المعالجة",
  sending: "جارٍ الإرسال",
  sent: "أُرسل",
  failed: "فشل",
  skipped: "متوقف",
  unknown: "غير مؤكد",
};

export function formatStatus(status: string): string {
  return statusLabels[status] ?? status;
}

const planLabels: Record<string, string> = {
  free: "مجاني",
  starter: "Starter",
  growth: "Growth",
};

export function formatPlan(planId: string | null): string {
  if (!planId) return "بلا خطة";
  return planLabels[planId] ?? planId;
}

const subscriptionStatusLabels: Record<string, string> = {
  trialing: "تجربة",
  active: "نشط",
  canceled: "ملغى",
  past_due: "متأخر",
};

export function formatSubscriptionStatus(status: string | null): string {
  if (!status) return "—";
  return subscriptionStatusLabels[status] ?? status;
}
