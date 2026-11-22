import { useCallback, useEffect, useState } from "react";
import { apiGet, ApiError, readToken, writeToken } from "./lib/api";
import type { SessionResponse } from "./lib/types";
import { Overview } from "./pages/Overview";
import { AutoReplies } from "./pages/AutoReplies";
import { Workers } from "./pages/Workers";
import { Workspaces } from "./pages/Workspaces";
import { Badge } from "./components/ui";

const tabs = [
  { key: "overview", label: "نظرة عامة" },
  { key: "auto-replies", label: "الردود الآلية" },
  { key: "workers", label: "العمال" },
  { key: "workspaces", label: "المساحات" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

export function App() {
  const [token, setToken] = useState(readToken);
  const [draftToken, setDraftToken] = useState("");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");

  const checkSession = useCallback(async (candidate: string) => {
    try {
      const result = await apiGet<SessionResponse>("/session", candidate);
      setSession(result);
      setAuthError(null);
      return true;
    } catch (caught) {
      setSession(null);
      setAuthError(
        caught instanceof ApiError && caught.status === 401
          ? "مفتاح اللوحة غير صحيح."
          : caught instanceof ApiError && caught.status === 404
            ? "لوحة المالك غير مفعّلة على هذا الخادم (لا يوجد MENA_OWNER_CONSOLE_TOKEN ولا MENA_OWNER_USER_IDS)."
            : caught instanceof ApiError && caught.status === 429
              ? "محاولات كثيرة. انتظر عشر دقائق ثم أعد المحاولة."
              : "تعذّر الاتصال بالخادم.",
      );
      return false;
    } finally {
      setSessionChecked(true);
    }
  }, []);

  useEffect(() => {
    void checkSession(token);
  }, [checkSession, token]);

  const submitToken = async () => {
    const candidate = draftToken.trim();
    if (!candidate) return;
    const ok = await checkSession(candidate);
    if (ok) {
      writeToken(candidate);
      setToken(candidate);
      setDraftToken("");
    }
  };

  if (!sessionChecked) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <p className="text-sm text-slate-400">جارٍ التحقق من الجلسة…</p>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid min-h-full place-items-center p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitToken();
          }}
          className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6"
        >
          <h1 className="text-lg font-semibold text-slate-100">
            لوحة مالك MenaFlow
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            مساحة داخلية للقراءة فقط. أدخل مفتاح اللوحة المُعرّف في الخادم باسم
            <code className="mx-1 rounded bg-white/10 px-1.5 py-0.5 text-xs">
              MENA_OWNER_CONSOLE_TOKEN
            </code>
            .
          </p>
          <input
            type="password"
            value={draftToken}
            onChange={(event) => setDraftToken(event.target.value)}
            placeholder="مفتاح اللوحة"
            autoComplete="off"
            dir="ltr"
            className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-emerald-500/60"
          />
          {authError ? (
            <p className="mt-3 text-xs leading-5 text-rose-300">{authError}</p>
          ) : null}
          <button
            type="submit"
            className="mt-4 w-full rounded-xl bg-emerald-500/90 px-4 py-2.5 text-sm font-medium text-emerald-950 transition hover:bg-emerald-400"
          >
            دخول
          </button>
          <button
            type="button"
            onClick={() => {
              writeToken("");
              setToken("");
              void checkSession("");
            }}
            className="mt-2 w-full rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-400 transition hover:text-slate-200"
          >
            إعادة المحاولة بدون مفتاح (وضع التطوير)
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-50">لوحة مالك MenaFlow</h1>
          <p className="mt-1 text-xs text-slate-500">
            قراءة فقط • تُخدَّم من نفس خادم الـAPI • آخر تحقق:{" "}
            {new Date(session.serverTime).toLocaleTimeString("ar-EG-u-nu-latn")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">{session.mode === "dev" ? "وضع التطوير" : "مالك"}</Badge>
          <Badge tone="neutral">{session.scope}</Badge>
          {token ? (
            <button
              type="button"
              onClick={() => {
                writeToken("");
                setToken("");
              }}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:text-slate-200"
            >
              خروج
            </button>
          ) : null}
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`rounded-xl px-4 py-2 text-sm transition ${
              tab === entry.key
                ? "bg-emerald-500/20 text-emerald-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 pb-8">
        {tab === "overview" ? <Overview token={token} /> : null}
        {tab === "auto-replies" ? <AutoReplies token={token} /> : null}
        {tab === "workers" ? <Workers token={token} /> : null}
        {tab === "workspaces" ? <Workspaces token={token} /> : null}
      </main>

      <footer className="border-t border-white/5 pt-4 text-center text-[11px] text-slate-600">
        لا تُعرض في هذه اللوحة نصوص العملاء ولا أرقام هواتفهم ولا بيانات اعتماد.
      </footer>
    </div>
  );
}
