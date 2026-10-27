export type ManageableFacebookPage = {
  id: string;
  name: string;
  access_token: string;
};

export type MetaPageListDiagnostics = {
  hasData: boolean;
  pageCount: number;
};

export type MetaUserToken = {
  kind: "long_lived" | "short_lived";
  value: string;
};

export function grantedFacebookPageIds(debugTokenPayload: unknown): string[] {
  const root = asRecord(debugTokenPayload);
  const data = asRecord(root?.data);
  const granularScopes = Array.isArray(data?.granular_scopes)
    ? data.granular_scopes
    : [];
  const pageIds = new Set<string>();

  for (const scopeValue of granularScopes) {
    const scope = asRecord(scopeValue);
    if (scope?.scope !== "pages_show_list" || !Array.isArray(scope.target_ids)) {
      continue;
    }
    for (const targetId of scope.target_ids) {
      if (typeof targetId === "string" && /^\d{1,32}$/.test(targetId)) {
        pageIds.add(targetId);
      }
    }
  }

  return [...pageIds];
}

export function buildFacebookPageByIdUrl(
  graphVersion: string,
  pageId: string,
  userAccessToken: string,
): URL {
  if (!/^\d{1,32}$/.test(pageId)) {
    throw new Error("INVALID_META_PAGE_ID");
  }
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}`,
  );
  url.search = new URLSearchParams({
    fields: "id,name,access_token",
    access_token: userAccessToken,
  }).toString();
  return url;
}

export function inspectFacebookPage(
  payload: unknown,
  expectedPageId: string,
): ManageableFacebookPage | undefined {
  const item = asRecord(payload);
  return item?.id === expectedPageId &&
    typeof item.name === "string" &&
    item.name.length > 0 &&
    typeof item.access_token === "string" &&
    item.access_token.length > 0
    ? {
        id: item.id,
        name: item.name,
        access_token: item.access_token,
      }
    : undefined;
}

export type MetaPageListAttempt = MetaPageListDiagnostics & {
  tokenKind: MetaUserToken["kind"];
  httpStatus?: number;
  error?: { code?: number; subcode?: number; type?: string; message?: string };
  networkFailure?: boolean;
};

export async function findFacebookPageWithUserTokens(
  tokens: MetaUserToken[],
  listPages: (userAccessToken: string) => Promise<{
    httpStatus: number;
    payload: unknown;
  }>,
): Promise<{
  page: ManageableFacebookPage | undefined;
  attempts: MetaPageListAttempt[];
  error?: unknown;
}> {
  const attempts: MetaPageListAttempt[] = [];
  let lastError: unknown;

  for (const token of tokens) {
    try {
      const { httpStatus, payload } = await listPages(token.value);
      const { diagnostics, page } = inspectMetaPageList(payload);
      lastError = undefined;
      attempts.push({ tokenKind: token.kind, httpStatus, ...diagnostics });
      if (page) return { page, attempts };
    } catch (error) {
      lastError = error;
      const errorRecord =
        typeof error === "object" && error !== null
          ? (error as {
              status?: unknown;
              details?: unknown;
              networkFailure?: unknown;
            })
          : undefined;
      const details =
        typeof errorRecord?.details === "object" &&
        errorRecord.details !== null
          ? (errorRecord.details as MetaPageListAttempt["error"])
          : undefined;
      attempts.push({
        tokenKind: token.kind,
        httpStatus:
          typeof errorRecord?.status === "number"
            ? errorRecord.status
            : undefined,
        hasData: false,
        pageCount: 0,
        error: details,
        networkFailure: errorRecord?.networkFailure === true,
      });
    }
  }

  return { page: undefined, attempts, error: lastError };
}

export function buildMetaPageListUrl(
  graphVersion: string,
  userAccessToken: string,
): URL {
  const url = new URL(
    `https://graph.facebook.com/${graphVersion}/me/accounts`,
  );
  url.search = new URLSearchParams({
    fields: "id,name,access_token",
    limit: "100",
    access_token: userAccessToken,
  }).toString();
  return url;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function inspectMetaPageList(payload: unknown): {
  diagnostics: MetaPageListDiagnostics;
  page: ManageableFacebookPage | undefined;
} {
  const record = asRecord(payload);
  const hasData = Boolean(record && Object.hasOwn(record, "data"));
  const data = Array.isArray(record?.data) ? record.data : [];
  const page = data.find((candidate): candidate is ManageableFacebookPage => {
    const item = asRecord(candidate);
    return Boolean(
      typeof item?.id === "string" &&
        item.id &&
        typeof item.name === "string" &&
        item.name &&
        typeof item.access_token === "string" &&
        item.access_token,
    );
  });

  return {
    diagnostics: { hasData, pageCount: data.length },
    page,
  };
}

export function metaPageListFailureDetail(
  status: number | undefined,
  details: { code?: number; subcode?: number; message?: string } | undefined,
): string | undefined {
  const parts = [
    status === undefined ? undefined : `HTTP ${status}`,
    details?.code === undefined ? undefined : `Meta ${details.code}`,
    details?.subcode === undefined ? undefined : `subcode ${details.subcode}`,
    details?.message,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" — ").slice(0, 500) : undefined;
}
