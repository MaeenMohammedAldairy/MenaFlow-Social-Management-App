import { useEffect, useState } from "react";
import { useApi } from "../lib/api";
import {
  formatDateTime,
  formatNumber,
  formatPlan,
  formatStatus,
  formatSubscriptionStatus,
} from "../lib/format";
import type { WorkspaceDetailResponse, WorkspacesResponse } from "../lib/types";
import { Badge, Card, Empty, StateNote } from "../components/ui";

export function Workspaces({ token }: { token: string }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, error, loading } = useApi<WorkspacesResponse>(
    `/workspaces?limit=25${query ? `&search=${encodeURIComponent(query)}` : ""}`,
    token,
    60_000,
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card
        title="المساحات"
        hint="الأحدث أولًا • بلا أرقام عملاء أو نصوص محادثات"
        action={
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ابحث بالاسم"
            className="w-40 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-500/50"
          />
        }
      >
        {!data ? (
          <StateNote loading={loading} error={error} />
        ) : data.items.length === 0 ? (
          <Empty>لا مساحات مطابقة</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="pb-2 font-normal">الاسم</th>
                  <th className="pb-2 font-normal">الخطة</th>
                  <th className="pb-2 font-normal">AI</th>
                  <th className="pb-2 font-normal">واتساب</th>
                  <th className="pb-2 font-normal">أُنشئت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.items.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row.id)}
                    className={`cursor-pointer transition hover:bg-white/[0.04] ${
                      selected === row.id ? "bg-emerald-500/5" : ""
                    }`}
                  >
                    <td className="py-2.5 text-slate-200">{row.name}</td>
                    <td className="py-2.5">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-slate-300">
                          {formatPlan(row.planId)}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {formatSubscriptionStatus(row.subscriptionStatus)}
                        </span>
                      </div>
                    </td>
                    <td className="tabular py-2.5 text-xs text-slate-300">
                      {formatNumber(row.aiGenerations)}
                    </td>
                    <td className="py-2.5">
                      {row.whatsapp ? (
                        <Badge
                          tone={row.whatsapp.autoReplyEnabled ? "good" : "neutral"}
                        >
                          {row.whatsapp.autoReplyEnabled
                            ? "رد آلي مفعّل"
                            : "رد آلي متوقف"}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-500">غير مربوط</span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-slate-500">
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.hasMore ? (
              <p className="mt-3 text-xs text-slate-500">
                تظهر أول 25 مساحة فقط. استخدم البحث لتضييق النتيجة.
              </p>
            ) : null}
          </div>
        )}
      </Card>

      {selected ? (
        <WorkspaceDetail token={token} workspaceId={selected} />
      ) : (
        <Card title="تفاصيل مساحة">
          <Empty>اختر مساحة من الجدول لعرض تفاصيلها.</Empty>
        </Card>
      )}
    </div>
  );
}

function WorkspaceDetail({
  token,
  workspaceId,
}: {
  token: string;
  workspaceId: string;
}) {
  const { data, error, loading } = useApi<WorkspaceDetailResponse>(
    `/workspaces/${encodeURIComponent(workspaceId)}`,
    token,
    60_000,
  );

  if (!data) return <Card title="تفاصيل مساحة"><StateNote loading={loading} error={error} /></Card>;

  const statuses = (rows: { status: string; total: number }[]) =>
    rows.length === 0 ? (
      <Empty>لا نشاط</Empty>
    ) : (
      <ul className="flex flex-wrap gap-2">
        {rows.map((row) => (
          <li key={row.status}>
            <Badge tone={row.status === "sent" ? "good" : row.status === "failed" ? "bad" : "neutral"}>
              {formatStatus(row.status)}: {formatNumber(row.total)}
            </Badge>
          </li>
        ))}
      </ul>
    );

  return (
    <div className="space-y-5">
      <Card title={data.workspace.name} hint={`المعرّف: ${data.workspace.id}`}>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-400">الخطة</dt>
            <dd className="mt-1 text-slate-200">
              {formatPlan(data.subscription?.planId ?? null)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">حالة الاشتراك</dt>
            <dd className="mt-1 text-slate-200">
              {formatSubscriptionStatus(data.subscription?.status ?? null)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">توليدات AI (الفترة)</dt>
            <dd className="tabular mt-1 text-slate-200">
              {formatNumber(data.usage.aiGenerations)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">منشورات (الفترة)</dt>
            <dd className="tabular mt-1 text-slate-200">
              {formatNumber(data.usage.postsCreated)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">الأعضاء</dt>
            <dd className="tabular mt-1 text-slate-200">
              {formatNumber(data.members)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">الطلبات</dt>
            <dd className="tabular mt-1 text-slate-200">
              {formatNumber(data.orders)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">أُنشئت</dt>
            <dd className="mt-1 text-xs text-slate-300">
              {formatDateTime(data.workspace.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">آخر تحديث</dt>
            <dd className="mt-1 text-xs text-slate-300">
              {formatDateTime(data.workspace.updatedAt)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="القنوات">
        <div className="space-y-3 text-sm">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="mb-1 text-xs text-slate-400">واتساب</p>
            {data.whatsapp ? (
              <p className="text-slate-200">
                <span className="font-mono text-xs">{data.whatsapp.instanceName}</span>
                <span className="mx-2 text-slate-500">•</span>
                {data.whatsapp.status}
                <span className="mx-2 text-slate-500">•</span>
                {data.whatsapp.autoReplyEnabled ? "رد آلي مفعّل" : "رد آلي متوقف"}
                {data.whatsapp.autoReplyTested ? null : (
                  <span className="text-amber-300"> • لم يُختبر</span>
                )}
              </p>
            ) : (
              <Empty>غير مربوط</Empty>
            )}
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <p className="mb-1 text-xs text-slate-400">ميتا</p>
            {data.meta.length === 0 ? (
              <Empty>لا صفحات مربوطة</Empty>
            ) : (
              <ul className="space-y-1">
                {data.meta.map((entry) => {
                  const expired =
                    entry.accessTokenExpiresAt !== null &&
                    new Date(entry.accessTokenExpiresAt).getTime() <= Date.now();
                  return (
                    <li key={entry.pageName} className="text-slate-200">
                      {entry.pageName}
                      {entry.instagramUsername ? ` / @${entry.instagramUsername}` : ""}
                      {expired ? (
                        <Badge tone="bad">التوكن منتهٍ</Badge>
                      ) : (
                        <span className="ml-2 text-xs text-slate-500">
                          ينتهي {formatDateTime(entry.accessTokenExpiresAt)}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card title="الردود الآلية (7 أيام)">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs text-slate-400">واتساب</p>
            {statuses(data.autoReplies7d.whatsapp)}
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-400">ميتا</p>
            {statuses(data.autoReplies7d.meta)}
          </div>
        </div>
      </Card>
    </div>
  );
}
