import { useApi } from "../lib/api";
import { formatNumber, formatPlan, formatStatus } from "../lib/format";
import type { OverviewResponse } from "../lib/types";
import { Badge, BarList, Card, Empty, StateNote, Stat } from "../components/ui";

export function Overview({ token }: { token: string }) {
  const { data, error, loading } = useApi<OverviewResponse>(
    "/overview",
    token,
    30_000,
  );

  if (!data) {
    return <StateNote loading={loading} error={error} />;
  }

  const failedWhatsApp = data.autoReplies.whatsapp24h
    .filter((row) => row.status === "failed" || row.status === "unknown")
    .reduce((sum, row) => sum + row.total, 0);
  const failedMeta = data.autoReplies.meta24h
    .filter((row) => row.status === "failed" || row.status === "unknown")
    .reduce((sum, row) => sum + row.total, 0);
  const backlog = data.autoReplies.backlog.whatsapp + data.autoReplies.backlog.meta;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="المساحات"
          value={formatNumber(data.workspaces.total)}
          hint={`+${formatNumber(data.workspaces.last30Days)} خلال 30 يومًا`}
        />
        <Stat
          label="توليدات الذكاء الاصطناعي (الفترة)"
          value={formatNumber(data.usage.aiGenerations)}
          hint={`الفترة ${data.period}`}
        />
        <Stat
          label="الردود الآلية المتعثرة (24 ساعة)"
          value={formatNumber(failedWhatsApp + failedMeta)}
          tone={failedWhatsApp + failedMeta > 0 ? "bad" : "good"}
          hint={`واتساب ${formatNumber(failedWhatsApp)} • ميتا ${formatNumber(failedMeta)}`}
        />
        <Stat
          label="طابور مستحق الآن"
          value={formatNumber(backlog)}
          tone={backlog > 0 ? "warn" : "good"}
          hint={backlog > 0 ? "يفترض ألا يبقى عمل مستحق" : "لا تراكم"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="توزيع الخطط" hint="من جدول الاشتراكات">
          <BarList
            items={data.workspaces.byPlan.map((row) => ({
              label: formatPlan(row.planId),
              value: row.total,
            }))}
            emptyLabel="لا اشتراكات مسجّلة"
          />
        </Card>

        <Card title="حالة الاشتراكات">
          <BarList
            items={data.workspaces.byStatus.map((row) => ({
              label: formatStatus(row.status),
              value: row.total,
            }))}
            emptyLabel="لا اشتراكات مسجّلة"
          />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="القنوات المتصلة">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">واتساب</dt>
              <dd className="text-slate-200">
                {formatNumber(data.channels.whatsapp.total)} حساب
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">الرد الآلي مفعّل</dt>
              <dd className="text-slate-200">
                {formatNumber(data.channels.whatsapp.autoReplyEnabled)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">صفحات ميتا</dt>
              <dd className="text-slate-200">
                {formatNumber(data.channels.meta.total)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">توكنات منتهية</dt>
              <dd>
                {data.channels.meta.expiredTokens > 0 ? (
                  <Badge tone="bad">
                    {formatNumber(data.channels.meta.expiredTokens)}
                  </Badge>
                ) : (
                  <Badge tone="good">لا شيء</Badge>
                )}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="الوارد (24 ساعة)">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">رسائل وتعليقات ميتا</dt>
              <dd className="text-slate-200">
                {formatNumber(data.inbox.metaItems24h)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">رسائل واتساب واردة</dt>
              <dd className="text-slate-200">
                {formatNumber(data.inbox.whatsappInbound24h)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="الطلبات">
          <dl className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">إجمالي الطلبات</dt>
              <dd className="text-slate-200">
                {formatNumber(data.orders.total)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-slate-400">آخر 30 يومًا</dt>
              <dd className="text-slate-200">
                {formatNumber(data.orders.last30Days)}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card
        title="الردود الآلية (24 ساعة)"
        hint="حالات الطابور كما هي مسجّلة في قاعدة البيانات"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-3 text-xs text-slate-400">واتساب</p>
            {data.autoReplies.whatsapp24h.length === 0 ? (
              <Empty>لا أحداث</Empty>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.autoReplies.whatsapp24h.map((row) => (
                  <li key={row.status}>
                    <Badge
                      tone={
                        row.status === "sent"
                          ? "good"
                          : row.status === "failed"
                            ? "bad"
                            : row.status === "skipped"
                              ? "info"
                              : "neutral"
                      }
                    >
                      {formatStatus(row.status)}: {formatNumber(row.total)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-3 text-xs text-slate-400">فيسبوك / إنستغرام</p>
            {data.autoReplies.meta24h.length === 0 ? (
              <Empty>لا مهام</Empty>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.autoReplies.meta24h.map((row) => (
                  <li key={row.status}>
                    <Badge
                      tone={
                        row.status === "sent"
                          ? "good"
                          : row.status === "failed"
                            ? "bad"
                            : row.status === "skipped"
                              ? "info"
                              : "neutral"
                      }
                    >
                      {formatStatus(row.status)}: {formatNumber(row.total)}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
