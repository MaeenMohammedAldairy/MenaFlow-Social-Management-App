import type { ReactNode } from "react";

export function Card({
  title,
  hint,
  action,
  children,
  tone = "default",
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  tone?: "default" | "alert";
}) {
  return (
    <section
      className={[
        "rounded-2xl border p-5 backdrop-blur-sm",
        tone === "alert"
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-white/10 bg-white/[0.03]",
      ].join(" ")}
    >
      {title || action ? (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title ? (
              <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            ) : null}
            {hint ? (
              <p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const tones: Record<string, string> = {
    default: "text-slate-100",
    good: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-rose-300",
  };
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`tabular mt-2 text-2xl font-semibold ${tones[tone]}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
}) {
  const tones: Record<string, string> = {
    neutral: "border-white/15 bg-white/5 text-slate-300",
    good: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    bad: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    info: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function BarList({
  items,
  emptyLabel = "لا توجد بيانات",
  colors,
}: {
  items: { label: string; value: number }[];
  emptyLabel?: string;
  colors?: Record<string, string>;
}) {
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-300">{item.label}</span>
            <span className="tabular text-slate-400">{item.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className={`h-full rounded-full ${colors?.[item.label] ?? "bg-emerald-400/70"}`}
              style={{
                width: `${max === 0 ? 0 : Math.max(2, (item.value / max) * 100)}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>;
}

export function StateNote({
  loading,
  error,
}: {
  loading: boolean;
  error: { message: string } | null;
}) {
  if (loading) {
    return <p className="text-sm text-slate-400">جارٍ التحميل…</p>;
  }
  if (error) {
    return (
      <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        {error.message}
      </p>
    );
  }
  return null;
}
