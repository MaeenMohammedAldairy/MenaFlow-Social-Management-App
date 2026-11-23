import { asc, eq } from "drizzle-orm";
import {
  db,
  menaContentSettings,
  menaMetaConnections,
  menaMetaInboxItems,
  menaMetaOrderIntakes,
  menaOrderDeliveryEvents,
  menaOrderEvents,
  menaOrderItems,
  menaOrders,
  menaPostActivityEvents,
  menaWhatsAppConnections,
  menaWhatsAppDirectMessages,
  menaWhatsAppGroups,
  menaWhatsAppMessageMedia,
  menaWhatsAppMessages,
  menaWhatsAppOrderIntakes,
  posts,
  productPosts,
  products,
  workspaceDeletionRequests,
  workspaceMembers,
  workspaceSubscriptionUsage,
  workspaceSubscriptions,
  workspaces,
} from "@workspace/db";

/**
 * Builds the merchant's data export (§3.4: `GET /workspaces/current/export`).
 *
 * Content tables are exported whole; anything credential-bearing or purely
 * internal is either masked or left out on purpose:
 * - Meta connections export identity metadata only — the encrypted page
 *   access token never leaves the database.
 * - OAuth states, webhook subscription bookkeeping, push outbox, sync
 *   cursors and auto-reply event logs are internal machinery, not merchant
 *   data, and are omitted.
 *
 * The shape is intentionally loose in the contract (`WorkspaceExport`) so
 * sections can grow without regenerating typed clients.
 */
export async function buildWorkspaceExport(workspaceId: string) {
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      businessType: workspaces.businessType,
      timezone: workspaces.timezone,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return null;

  const [
    members,
    subscription,
    subscriptionUsage,
    contentSettings,
    workspacePosts,
    postActivityEvents,
    workspaceProducts,
    workspaceProductPosts,
    orders,
    orderItems,
    orderEvents,
    orderDeliveryEvents,
    metaOrderIntakes,
    whatsappOrderIntakes,
    metaInboxItems,
    metaConnections,
    whatsappConnections,
    whatsappGroups,
    whatsappMessages,
    whatsappMessageMedia,
    whatsappDirectMessages,
    deletionRequests,
  ] = await Promise.all([
    db
      .select({
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        createdAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId)),
    db
      .select()
      .from(workspaceSubscriptions)
      .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(workspaceSubscriptionUsage)
      .where(eq(workspaceSubscriptionUsage.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(menaContentSettings)
      .where(eq(menaContentSettings.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(posts)
      .where(eq(posts.workspaceId, workspaceId))
      .orderBy(asc(posts.createdAt)),
    db
      .select()
      .from(menaPostActivityEvents)
      .where(eq(menaPostActivityEvents.workspaceId, workspaceId))
      .orderBy(asc(menaPostActivityEvents.occurredAt)),
    db
      .select()
      .from(products)
      .where(eq(products.workspaceId, workspaceId)),
    db
      .select()
      .from(productPosts)
      .where(eq(productPosts.workspaceId, workspaceId)),
    db.select().from(menaOrders).where(eq(menaOrders.workspaceId, workspaceId)),
    db
      .select()
      .from(menaOrderItems)
      .where(eq(menaOrderItems.workspaceId, workspaceId)),
    db
      .select()
      .from(menaOrderEvents)
      .where(eq(menaOrderEvents.workspaceId, workspaceId)),
    db
      .select()
      .from(menaOrderDeliveryEvents)
      .where(eq(menaOrderDeliveryEvents.workspaceId, workspaceId)),
    db
      .select()
      .from(menaMetaOrderIntakes)
      .where(eq(menaMetaOrderIntakes.workspaceId, workspaceId)),
    db
      .select()
      .from(menaWhatsAppOrderIntakes)
      .where(eq(menaWhatsAppOrderIntakes.workspaceId, workspaceId)),
    db
      .select()
      .from(menaMetaInboxItems)
      .where(eq(menaMetaInboxItems.workspaceId, workspaceId)),
    // Masked: identity metadata only, never the encrypted token.
    db
      .select({
        pageId: menaMetaConnections.pageId,
        pageName: menaMetaConnections.pageName,
        instagramUserId: menaMetaConnections.instagramUserId,
        instagramUsername: menaMetaConnections.instagramUsername,
        grantedPermissions: menaMetaConnections.grantedPermissions,
        connectedAt: menaMetaConnections.connectedAt,
      })
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, workspaceId)),
    db
      .select()
      .from(menaWhatsAppConnections)
      .where(eq(menaWhatsAppConnections.workspaceId, workspaceId)),
    db
      .select()
      .from(menaWhatsAppGroups)
      .where(eq(menaWhatsAppGroups.workspaceId, workspaceId)),
    db
      .select()
      .from(menaWhatsAppMessages)
      .where(eq(menaWhatsAppMessages.workspaceId, workspaceId)),
    db
      .select()
      .from(menaWhatsAppMessageMedia)
      .where(eq(menaWhatsAppMessageMedia.workspaceId, workspaceId)),
    db
      .select()
      .from(menaWhatsAppDirectMessages)
      .where(eq(menaWhatsAppDirectMessages.workspaceId, workspaceId)),
    db
      .select()
      .from(workspaceDeletionRequests)
      .where(eq(workspaceDeletionRequests.workspaceId, workspaceId)),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    workspace,
    members,
    subscription: {
      current: subscription[0] ?? null,
      usage: subscriptionUsage[0] ?? null,
    },
    content: {
      settings: contentSettings[0] ?? null,
      posts: workspacePosts,
      activityEvents: postActivityEvents,
    },
    catalog: {
      products: workspaceProducts,
      productPosts: workspaceProductPosts,
    },
    orders: {
      orders,
      items: orderItems,
      events: orderEvents,
      deliveryEvents: orderDeliveryEvents,
      metaIntakes: metaOrderIntakes,
      whatsappIntakes: whatsappOrderIntakes,
    },
    conversations: {
      metaInboxItems,
      whatsappGroups,
      whatsappMessages,
      whatsappMessageMedia,
      whatsappDirectMessages,
    },
    connections: {
      meta: metaConnections,
      whatsapp: whatsappConnections,
    },
    deletionRequests,
  };
}
