import { useCallback, useEffect, useState } from "react";

const tokenKey = "menaflow.owner.token";
const apiBase = "/api/owner";

export function readToken(): string {
  try {
    return sessionStorage.getItem(tokenKey) ?? "";
  } catch {
    return "";
  }
}

export function writeToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(tokenKey, token);
    else sessionStorage.removeItem(tokenKey);
  } catch {
    /* storage can be blocked; the console then simply asks again */
  }
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    credentials: "same-origin",
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

/**
 * Polls one read-only endpoint. The console shows operational health, so data
 * is refreshed in the background instead of requiring a manual reload.
 */
export function useApi<T>(
  path: string,
  token: string,
  intervalMs = 30_000,
): {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const result = await apiGet<T>(path, token);
        if (!alive) return;
        setData(result);
        setError(null);
      } catch (caught) {
        if (!alive) return;
        setError(
          caught instanceof ApiError
            ? caught
            : new ApiError(0, "تعذّر الاتصال بالخادم."),
        );
      } finally {
        if (alive) {
          setLoading(false);
          if (intervalMs > 0) timer = setTimeout(load, intervalMs);
        }
      }
    };

    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [path, token, intervalMs, nonce]);

  return { data, error, loading, reload };
}
