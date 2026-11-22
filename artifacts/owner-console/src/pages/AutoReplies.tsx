import { useState } from "react";
import { useApi } from "../lib/api";
import { formatAge, formatNumber, formatStatus, formatDateTime } from "../lib/format";
import type { AutoRepliesResponse, AutoReplyFailure } from "../lib/types";
import { Badge, BarList, Card, Empty, StateNote } from "../components/ui";

const windows = [
  { key: "24h", label: "24 ساعة" },
  { key: "7d", label: "7 أيام" },
  { key: "30d", label: "30 يومًا" },
] as const;

function statusTone(status: string): "good" | "warn" | "bad" | "info" | "neutral" {
  if (status === "sent") return "good";
  if (status === "failed" || status === "unknown") return "bad";
  if (status === "skipped") return "info";
  if (status === "queued" || status === "processing" || status === "sending") {
    return "warn";
  }
  return "neutral";
}

function FailureTable({
  rows,
  emptyLabel,
}: {
  rows: AutoReplyFailure[];
  emptyLabel: string;
}) {
  if (rows.length === 0) return <Empty>{emptyLabel}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-right text-sm">
        <thead className="text-xs text-slate-400">
          <tr>
            <th className="pb-2 font-normal">المساحة</th>
            <th className="pb-2 font-normal">الحالة</th>
            <th className="pb-2 font-normal">الرمز</th>
            <th className="pb-2 font-normal">الوقت</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="py-2 text-slate-200">
                {row.workspaceName ?? row.workspaceId.slice(0, 8)}
              </td>
              <td className="py-2">
                <Badge tone={statusTone(row.status)}>
                  {formatStatus(row.status)}
                </Badge>
              </td>
              <td className="py-2 text-xs text-slate-400">
                {row.errorCode ?? "—"}
              </td>
              <td className="py-2 text-xs text-slate-500">
                {formatDateTime(row.completedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AutoReplies({ token }: { token: string }) {
  const [windowKey, setWindowKey] =
    useState<(typeof windows)[number]["key"]>("24h");
  const { data, error, loading } = useApi<AutoRepliesResponse>(
    `/auto-replies?window=${windowKey}`,
    token,
    30_000,
  );

  const backlog = (data?.whatsapp.backlog ?? 0) + (data?.meta.backlog ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-400">
          قراءة فقط • لا تُعرض نصوص العملاء أو أرقامهم في هذه اللوحة
        </p>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {windows.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setWindowKey(entry.key)}
              className={`rounded-lg px-3 py-1.5 text-xs transition ${
                windowKey === entry.key
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        <StateNote loading={loading} error={error} />
      ) : (
        <>
          <div
            className={`rounded-2xl border px-5 py-4 text-sm ${
              backlog > 0
                ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            }`}
          >
            {backlog > 0
              ? `يوجد ${formatNumber(backlog)} رد مستحق لم يُنفّذ بعد — تحقّق من صفحة العمال.`
              : "لا تراكم في الطوابير: العمال يستهلكون العمل المستحق."}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="واتساب" hint={`النافذة: ${windowKey}`}>
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <dt className="text-xs text-slate-400">مستحق الآن</dt>
                  <dd className="tabular mt-1 text-lg text-slate-100">
                    {formatNumber(data.whatsapp.backlog)}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <dt className="text-xs text-slate-400">أقدم انتظار</dt>
                  <dd className="mt-1 text-lg text-slate-100">
                    {formatAge(data.whatsapp.oldestPendingAt)}
                  </dd>
                </div>
              </dl>

              <p className="mb-2 text-xs text-slate-400">توزيع الحالات</p>
              <BarList
                items={data.whatsapp.byStatus.map((row) => ({
                  label: formatStatus(row.status),
                  value: row.total,
                }))}
                emptyLabel="لا أحداث في هذه النافذة"
                colors={{
                  أُرسل: "bg-emerald-400/70",
                  فشل: "bg-rose-400/70",
                  "غير مؤكد": "bg-amber-400/70",
                  "تم تجاوزه": "bg-sky-400/60",
                }}
              />

              <p className="mt-5 mb-2 text-xs text-slate-400">أكثر الرموز تكرارًا</p>
              <ul className="space-y-2 text-sm">
                {data.whatsapp.topErrors.length === 0 ? (
                  <Empty>لا أخطاء</Empty>
                ) : (
                  data.whatsapp.topErrors.map((row) => (
                    <li
                      key={row.errorCode}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                    >
                      <span className="text-xs text-slate-300">{row.errorCode}</span>
                      <span className="tabular text-xs text-slate-400">
                        {formatNumber(row.total)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>

            <Card title="فيسبوك / إنستغرام" hint={`النافذة: ${windowKey}`}>
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <dt className="text-xs text-slate-400">مستحق الآن</dt>
                  <dd className="tabular mt-1 text-lg text-slate-100">
                    {formatNumber(data.meta.backlog)}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <dt className="text-xs text-slate-400">أقدم انتظار</dt>
                  <dd className="mt-1 text-lg text-slate-100">
                    {formatAge(data.meta.oldestPendingAt)}
                  </dd>
                </div>
              </dl>

              <p className="mb-2 text-xs text-slate-400">توزيع الحالات</p>
              <BarList
                items={data.meta.byStatus.map((row) => ({
                  label: formatStatus(row.status),
                  value: row.total,
                }))}
                emptyLabel="لا مهام في هذه النافذة"
                colors={{
                  أُرسل: "bg-emerald-400/70",
                  فشل: "bg-rose-400/70",
                  "غير مؤكد": "bg-amber-400/70",
                  "تم تجاوزه": "bg-sky-400/60",
                }}
              />

              <p className="mt-5 mb-2 text-xs text-slate-400">أكثر الرموز تكرارًا</p>
              <ul className="space-y-2 text-sm">
                {data.meta.topErrors.length === 0 ? (
                  <Empty>لا أخطاء</Empty>
                ) : (
                  data.meta.topErrors.map((row) => (
                    <li
                      key={row.errorCode}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                    >
                      <span className="text-xs text-slate-300">{row.errorCode}</span>
                      <span className="tabular text-xs text-slate-400">
                        {formatNumber(row.total)}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="آخر إخفاقات واتساب">
              <FailureTable
                rows={data.whatsapp.recentFailures}
                emptyLabel="لا إخفاقات"
              />
            </Card>
            <Card title="آخر إخفاقات ميتا">
              <FailureTable rows={data.meta.recentFailures} emptyLabel="لا إخفاقات" />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
