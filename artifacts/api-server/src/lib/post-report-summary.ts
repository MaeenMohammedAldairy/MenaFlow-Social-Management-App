export type PostReportRange = "all" | "7" | "30";

export type PostReportSummary = {
  total: number;
  draft: number;
  review: number;
  scheduled: number;
  approved: number;
  publishing: number;
  published: number;
  failed: number;
  instagram: number;
  facebook: number;
  whatsapp: number;
};

export function parsePostReportRange(value: unknown): PostReportRange | null {
  return value === "all" || value === "7" || value === "30" ? value : null;
}

export function postReportCutoff(
  range: PostReportRange,
  now = new Date(),
): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - Number(range) * 24 * 60 * 60 * 1000);
}

export function normalizePostReportSummary(
  row: Partial<Record<keyof PostReportSummary, number | string>> | undefined,
): PostReportSummary {
  const count = (value: number | string | undefined) => {
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    total: count(row?.total),
    draft: count(row?.draft),
    review: count(row?.review),
    scheduled: count(row?.scheduled),
    approved: count(row?.approved),
    publishing: count(row?.publishing),
    published: count(row?.published),
    failed: count(row?.failed),
    instagram: count(row?.instagram),
    facebook: count(row?.facebook),
    whatsapp: count(row?.whatsapp),
  };
}
