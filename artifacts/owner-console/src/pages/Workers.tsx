import { useApi } from "../lib/api";
import { formatDuration, formatInterval, formatNumber } from "../lib/format";
import type { WorkersResponse } from "../lib/types";
import { Badge, Card, Empty, StateNote } from "../components/ui";

export function Workers({ token }: { token: string }) {
  const { data, error, loading } = useApi<WorkersResponse>(
    "/workers",
    token,
    15_000,
  );

  if (!data) return <StateNote loading={loading} error={error} />;

  return (
    <div className="space-y-5">
      <div
        className={`rounded-2xl border px-5 py-4 text-sm ${
          data.database.ok
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
            : "border-rose-500/40 bg-rose-500/10 text-rose-200"
        }`}
      >
        {data.database.ok
          ? `قاعدة البيانات متاحة (${formatDuration(data.database.latencyMs)}). `
          : "تعذّر الوصول إلى قاعدة البيانات. "}
        {data.attention > 0
          ? `${formatNumber(data.attention)} عامل يحتاج انتباهك.`
          : "كل العمال يعملون بلا أخطاء ظاهرة."}
      </div>

      {data.workers.length === 0 ? (
        <Card title="لا عمال مسجّلين">
          <Empty>
            لم يبدأ أي عامل في هذه العملية. إن كنت تشغّل الـAPI فقط فهذا خلل:
            العمال يجب أن يقلعوا معه.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.workers.map((worker) => (
            <Card
              key={worker.name}
              tone={
                worker.stale || worker.consecutiveErrors > 0 ? "alert" : "default"
              }
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="font-mono text-sm text-slate-100">{worker.name}</h3>
                {worker.stale ? (
                  <Badge tone="bad">متوقف</Badge>
                ) : worker.running ? (
                  <Badge tone="info">يعمل الآن</Badge>
                ) : (
                  <Badge tone="good">سليم</Badge>
                )}
              </div>
              <dl className="space-y-2 text-xs text-slate-400">
                <div className="flex justify-between gap-2">
                  <dt>الفاصل</dt>
                  <dd className="text-slate-300">
                    {formatInterval(worker.intervalMs)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>آخر دورة</dt>
                  <dd className="text-slate-300">
                    {worker.lastRunFinishedAt
                      ? new Date(worker.lastRunFinishedAt).toLocaleTimeString(
                          "ar-EG-u-nu-latn",
                        )
                      : "لم تكتمل بعد"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>مدة الدورة</dt>
                  <dd className="text-slate-300">
                    {formatDuration(worker.lastRunDurationMs)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>أخطاء متتالية</dt>
                  <dd
                    className={
                      worker.consecutiveErrors > 0
                        ? "text-rose-300"
                        : "text-slate-300"
                    }
                  >
                    {formatNumber(worker.consecutiveErrors)}
                  </dd>
                </div>
              </dl>
              {worker.lastError ? (
                <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs leading-5 text-rose-200">
                  {worker.lastError}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
