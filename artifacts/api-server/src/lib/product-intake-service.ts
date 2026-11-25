import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  menaProductChanges,
  menaProductExtractionEvents,
  menaWebhookIdempotency,
} from "@workspace/db";
import { requestWorkspaceContext } from "./workspace-context.ts";
import { canWriteProducts, isLocalAuthDisabled } from "./owner-access.ts";

/**
 * Product writes change what the auto-reply and order intake will tell
 * customers. Membership alone is too weak: `canWriteProducts` (owner, and the
 * as-yet unassigned `admin`) decides, while the existing local offline
 * development mode stays usable.
 */
export const requireProductWriter: RequestHandler = (req, res, next) => {
  const context = requestWorkspaceContext(req);
  if (!context) {
    res.status(401).json({ error: "WORKSPACE_CONTEXT_MISSING" });
    return;
  }
  if (isLocalAuthDisabled()) {
    next();
    return;
  }
  if (!canWriteProducts(context.role)) {
    res.status(403).json({ error: "يجب أن تكون مالك المساحة أو مديراً لتعديل المنتجات." });
    return;
  }
  next();
};

export function productWriterId(req: Request): string | null {
  return requestWorkspaceContext(req)?.userId ?? null;
}

export { evolutionWebhookEventKey } from "./product-intake-policy.ts";

export async function claimWebhookEvent(
  provider: string,
  eventKey: string,
  workspaceId: string | null = null,
): Promise<boolean> {
  const inserted = await db
    .insert(menaWebhookIdempotency)
    .values({ id: randomUUID(), provider, eventKey, workspaceId })
    .onConflictDoNothing()
    .returning({ id: menaWebhookIdempotency.id });
  return inserted.length > 0;
}

/** Releases a claim when processing failed, so a provider redelivery can retry. */
export async function releaseWebhookEvent(
  provider: string,
  eventKey: string,
): Promise<void> {
  await db
    .delete(menaWebhookIdempotency)
    .where(and(
      eq(menaWebhookIdempotency.provider, provider),
      eq(menaWebhookIdempotency.eventKey, eventKey),
    ));
}

export type RecordedChange = {
  workspaceId: string;
  productId: string;
  field: string;
  before: unknown;
  after: unknown;
  sourceType?: "manual" | "extraction" | "order" | "publication";
  sourceId?: string | null;
  actorId?: string | null;
};

export async function recordProductChanges(
  changes: readonly RecordedChange[],
): Promise<void> {
  if (!changes.length) return;
  await db.insert(menaProductChanges).values(
    changes.map((change) => ({
      id: randomUUID(),
      workspaceId: change.workspaceId,
      productId: change.productId,
      field: change.field,
      beforeValue: (change.before ?? null) as never,
      afterValue: (change.after ?? null) as never,
      sourceType: change.sourceType ?? "manual",
      sourceId: change.sourceId ?? null,
      actorId: change.actorId ?? null,
    })),
  );
}

export async function recordExtractionEvent(input: {
  workspaceId: string;
  event: string;
  jobId?: string | null;
  suggestionId?: string | null;
  context?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(menaProductExtractionEvents).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    jobId: input.jobId ?? null,
    suggestionId: input.suggestionId ?? null,
    event: input.event,
    context: (input.context ?? {}) as never,
  });
}

/** Shared error response for cross-workspace or missing records. */
export function notFound(res: Response, message = "غير موجود"): void {
  res.status(404).json({ error: message });
}
