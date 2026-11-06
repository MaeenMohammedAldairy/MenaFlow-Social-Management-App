import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  db,
  menaMetaAutoReplyJobs,
  menaMetaAutoReplySettings,
  menaMetaConnections,
  menaMetaInboxItems,
  productPosts,
  products,
  menaWhatsAppMessageMedia,
  posts,
} from "@workspace/db";
import {
  generateMetaAutoReply,
  matchMetaAutoReplyProduct,
  metaPostSearchTerms,
  metaAutoReplyEnabled,
  metaBusinessInfoRequested,
  metaPostSearchText,
  requestedMetaProductImages,
  formatMetaAutoReplyPrice,
  retryMetaAutoReplyGeneration,
  buildMetaAutoReplyConversationContext,
  hasPreviousMetaAutoReplyInteraction,
  type MetaAutoReplyConversationEvent,
} from "./meta-auto-reply";
import { signedWhatsAppMediaUrl } from "./meta-publishing";
import { workspaceMediaKey } from "./product-utils.ts";
import {
  getMetaPublishedPosts,
  metaPageAccessToken,
  MetaInboxGraphError,
  getMetaPageBusinessInfo,
  sendMetaInboxReply,
} from "./meta-inbox-graph";
import {
  metaAutoReplyPermission,
  missingMetaIntegrationPermissions,
} from "./meta-oauth";
import { logger } from "./logger";
import {
  completeMetaInboxReply,
  releaseMetaInboxReplyReservation,
  reserveMetaInboxReply,
} from "./meta-inbox-reply-reservation";

const leaseMs = 90_000;
const maxAttempts = 3;
const messageReplyWindowMs = 24 * 60 * 60 * 1000;
// Meta allows replying to a comment only within a limited time after it was
// created; attempting to reply later returns an error, so skip stale comments
// instead of burning AI calls and send attempts that can never succeed.
const commentReplyWindowMs = 24 * 60 * 60 * 1000;
let processing = false;

function isMetaCdnUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return (
    url.protocol === "https:" &&
    !url.port &&
    (host === "fbcdn.net" ||
      host.endsWith(".fbcdn.net") ||
      host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host === "fbsbx.com" ||
      host.endsWith(".fbsbx.com"))
  );
}

type RelevantPost = { title: string; body: string; mediaUrls: string[] };

async function findRelevantCatalogProduct(
  workspaceId: string,
  item: typeof menaMetaInboxItems.$inferSelect,
  conversationText: string,
): Promise<typeof products.$inferSelect | null> {
  if (item.kind === "comment" && item.parentId) {
    const linkedProducts = await db
      .select({ product: products })
      .from(productPosts)
      .innerJoin(
        posts,
        and(
          eq(posts.workspaceId, productPosts.workspaceId),
          eq(posts.id, productPosts.postId),
        ),
      )
      .innerJoin(
        products,
        and(
          eq(products.workspaceId, productPosts.workspaceId),
          eq(products.id, productPosts.productId),
        ),
      )
      .where(
        and(
          eq(productPosts.workspaceId, workspaceId),
          sql`${posts.publishResults}->${item.platform}->>'postId' = ${item.parentId}`,
          eq(products.status, "active"),
          isNotNull(products.verifiedAt),
        ),
      )
      .limit(50);
    if (linkedProducts.length === 1) return linkedProducts[0]?.product ?? null;
    return matchMetaAutoReplyProduct(
      linkedProducts.map(({ product }) => product),
      conversationText,
    );
  }
  if (item.kind !== "message") return null;
  const candidates = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        eq(products.status, "active"),
        isNotNull(products.verifiedAt),
      ),
    )
    .orderBy(desc(products.updatedAt))
    .limit(500);
  return matchMetaAutoReplyProduct(candidates, conversationText);
}

function rankRelevantPost(
  candidates: Array<{ title: string; body: string; mediaUrls: unknown }>,
  conversationText: string,
): RelevantPost | null {
  const terms = metaPostSearchTerms(conversationText);
  if (!terms.size) return null;
  const ranked = candidates
    .map((post) => {
      const titleTerms = metaPostSearchTerms(post.title);
      const bodyTerms = metaPostSearchTerms(post.body);
      const titleMatches = [...terms].filter((term) =>
        titleTerms.has(term),
      ).length;
      const bodyMatches = [...terms].filter((term) =>
        bodyTerms.has(term),
      ).length;
      return { post, score: titleMatches * 2 + bodyMatches };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (!ranked[0] || (ranked[1] && ranked[1].score === ranked[0].score)) {
    return null;
  }
  return {
    title: ranked[0].post.title.slice(0, 250),
    body: ranked[0].post.body.slice(0, 3000),
    mediaUrls: Array.isArray(ranked[0].post.mediaUrls)
      ? ranked[0].post.mediaUrls.filter(
          (url): url is string => typeof url === "string",
        )
      : [],
  };
}

async function findRelevantPost(
  workspaceId: string,
  item: typeof menaMetaInboxItems.$inferSelect,
  conversationText: string,
): Promise<RelevantPost | null> {
  const platformPostId = sql`${posts.publishResults}->${item.platform}->>'postId'`;
  if (item.kind === "comment" && item.parentId) {
    const [post] = await db
      .select({
        title: posts.title,
        body: posts.body,
        mediaUrls: posts.mediaUrls,
      })
      .from(posts)
      .where(
        and(
          eq(posts.workspaceId, workspaceId),
          sql`${platformPostId} = ${item.parentId}`,
          sql`${posts.publishResults}->${item.platform}->>'status' = 'published'`,
        ),
      )
      .limit(1);
    return post
      ? {
          title: post.title.slice(0, 250),
          body: post.body.slice(0, 3000),
          mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
        }
      : null;
  }

  if (item.kind !== "message") return null;
  const candidates = await db
    .select({
      title: posts.title,
      body: posts.body,
      mediaUrls: posts.mediaUrls,
    })
    .from(posts)
    .where(
      and(
        eq(posts.workspaceId, workspaceId),
        sql`${posts.publishResults}->${item.platform}->>'status' = 'published'`,
      ),
    )
    .orderBy(desc(posts.updatedAt))
    .limit(100);
  return rankRelevantPost(candidates, conversationText);
}

async function findRelevantMetaPost(
  connection: typeof menaMetaConnections.$inferSelect,
  item: typeof menaMetaInboxItems.$inferSelect,
  accessToken: string,
  conversationText: string,
): Promise<RelevantPost | null> {
  const posts = await getMetaPublishedPosts({
    platform: item.platform,
    pageId: connection.pageId,
    instagramUserId: connection.instagramUserId,
    accessToken,
    ...(item.kind === "comment" && item.parentId
      ? { postId: item.parentId }
      : {}),
  });
  if (item.kind === "comment" && item.parentId) {
    const post = posts.find(({ postId }) => postId === item.parentId);
    return post
      ? { title: post.title, body: post.body, mediaUrls: post.mediaUrls }
      : null;
  }
  if (item.kind !== "message") return null;
  return rankRelevantPost(posts, conversationText);
}

async function publishedPostImageUrls(
  workspaceId: string,
  mediaUrls: string[],
): Promise<string[]> {
  const mediaKey = workspaceMediaKey(workspaceId);
  const directUrls = mediaUrls.filter((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (/\.(?:jpe?g|png|gif|webp)$/i.test(url.pathname) || isMetaCdnUrl(url))
      );
    } catch {
      return false;
    }
  });
  const productMediaIds = mediaUrls.filter((value) => {
    const match =
      /^product-media-image-([a-f0-9]{16})-[a-f0-9-]{36}-(?:jpg|png|webp|heic|heif)$/.exec(
        value,
      );
    return match?.[1] === mediaKey;
  });
  const productImages = productMediaIds.flatMap((mediaId) => {
    try {
      const url = new URL(
        signedWhatsAppMediaUrl(mediaId, true, "thumbnail"),
      );
      url.pathname = `/api/social/products/public-media/${encodeURIComponent(mediaId)}`;
      return [url.toString()];
    } catch (error) {
      logger.warn(
        {
          workspaceId,
          mediaId,
          errorCode:
            error instanceof Error ? error.message : "MEDIA_URL_UNAVAILABLE",
        },
        "Unable to create product image URL for Meta reply",
      );
      return [];
    }
  });
  const mediaIds = mediaUrls.filter((value) => !/^https?:\/\//i.test(value));
  const storedMedia = mediaIds.length
    ? await db
        .select({
          id: menaWhatsAppMessageMedia.id,
          mimeType: menaWhatsAppMessageMedia.mimeType,
          mediaType: menaWhatsAppMessageMedia.mediaType,
        })
        .from(menaWhatsAppMessageMedia)
        .where(
          and(
            eq(menaWhatsAppMessageMedia.workspaceId, workspaceId),
            eq(menaWhatsAppMessageMedia.downloadStatus, "stored"),
            inArray(menaWhatsAppMessageMedia.id, mediaIds),
          ),
        )
    : [];
  const localImages = storedMedia
    .filter(
      (media) =>
        media.mediaType === "image" &&
        media.mimeType?.toLowerCase().startsWith("image/"),
    )
    .flatMap((media) => {
      try {
        return [signedWhatsAppMediaUrl(media.id)];
      } catch (error) {
        logger.warn(
          {
            workspaceId,
            mediaId: media.id,
            errorCode:
              error instanceof Error ? error.message : "MEDIA_URL_UNAVAILABLE",
          },
          "Unable to create product image URL for Meta reply",
        );
        return [];
      }
    });
  return [...new Set([...directUrls, ...productImages, ...localImages])].slice(
    0,
    3,
  );
}

function accountContactInfo(
  platform: "facebook" | "instagram",
  connection: typeof menaMetaConnections.$inferSelect,
): string {
  if (platform === "facebook") {
    return `${connection.pageName} — صفحة Facebook: https://www.facebook.com/${encodeURIComponent(connection.pageId)}`;
  }
  if (connection.instagramUsername) {
    const username = connection.instagramUsername.replace(/^@/, "");
    return `حساب Instagram @${username}: https://www.instagram.com/${encodeURIComponent(username)}/`;
  }
  return "يمكن التواصل عبر الرسائل الخاصة لحساب Instagram المرتبط.";
}

async function markJob(
  id: string,
  workspaceId: string,
  status: "sent" | "failed" | "skipped" | "unknown",
  errorCode: string | null = null,
): Promise<void> {
  const now = new Date();
  await db
    .update(menaMetaAutoReplyJobs)
    .set({
      status,
      errorCode,
      leaseExpiresAt: null,
      updatedAt: now,
      completedAt: now,
    })
    .where(
      and(
        eq(menaMetaAutoReplyJobs.id, id),
        eq(menaMetaAutoReplyJobs.workspaceId, workspaceId),
      ),
    );
}

async function claimNextJob() {
  const now = new Date();
  await db
    .update(menaMetaInboxItems)
    .set({ replyStatus: "unknown", replyAttemptStartedAt: null })
    .where(
      and(
        eq(menaMetaInboxItems.replyStatus, "sending"),
        lt(
          menaMetaInboxItems.replyAttemptStartedAt,
          new Date(now.getTime() - leaseMs),
        ),
      ),
    );
  await db
    .update(menaMetaAutoReplyJobs)
    .set({
      status: "unknown",
      errorCode: "WORKER_INTERRUPTED_DURING_SEND",
      leaseExpiresAt: null,
      updatedAt: now,
      completedAt: now,
    })
    .where(
      and(
        eq(menaMetaAutoReplyJobs.status, "sending"),
        lt(menaMetaAutoReplyJobs.leaseExpiresAt, now),
      ),
    );
  await db
    .update(menaMetaAutoReplyJobs)
    .set({
      status: "failed",
      errorCode: "WORKER_RETRY_LIMIT_REACHED",
      leaseExpiresAt: null,
      updatedAt: now,
      completedAt: now,
    })
    .where(
      and(
        eq(menaMetaAutoReplyJobs.status, "processing"),
        lt(menaMetaAutoReplyJobs.leaseExpiresAt, now),
        sql`${menaMetaAutoReplyJobs.attempts} >= ${maxAttempts}`,
      ),
    );

  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(menaMetaAutoReplyJobs)
      .where(
        or(
          and(
            eq(menaMetaAutoReplyJobs.status, "queued"),
            lte(menaMetaAutoReplyJobs.nextRunAt, now),
          ),
          and(
            eq(menaMetaAutoReplyJobs.status, "processing"),
            lt(menaMetaAutoReplyJobs.leaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(menaMetaAutoReplyJobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await transaction
      .update(menaMetaAutoReplyJobs)
      .set({
        status: "processing",
        attempts: sql`${menaMetaAutoReplyJobs.attempts} + 1`,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        updatedAt: now,
      })
      .where(eq(menaMetaAutoReplyJobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function retryOrFail(
  job: typeof menaMetaAutoReplyJobs.$inferSelect,
  error: unknown,
): Promise<void> {
  const reason =
    error instanceof Error ? error.message : "META_AUTO_REPLY_FAILED";
  const retryable =
    job.attempts < maxAttempts &&
    (retryMetaAutoReplyGeneration(error, job.attempts) ||
      (error instanceof MetaInboxGraphError && error.status === 429));
  if (retryable) {
    const delayMs = job.attempts === 1 ? 10_000 : 30_000;
    await db
      .update(menaMetaAutoReplyJobs)
      .set({
        status: "queued",
        errorCode: reason.slice(0, 80),
        nextRunAt: new Date(Date.now() + delayMs),
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(menaMetaAutoReplyJobs.id, job.id));
    return;
  }

  logger.warn(
    {
      workspaceId: job.workspaceId,
      jobId: job.id,
      errorCode: reason.slice(0, 80),
    },
    "Meta automatic reply failed",
  );
  await markJob(job.id, job.workspaceId, "failed", reason.slice(0, 80));
}

async function processJob(job: typeof menaMetaAutoReplyJobs.$inferSelect) {
  const [[item], [connection], [settings]] = await Promise.all([
    db
      .select()
      .from(menaMetaInboxItems)
      .where(
        and(
          eq(menaMetaInboxItems.id, job.inboxItemId),
          eq(menaMetaInboxItems.workspaceId, job.workspaceId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(menaMetaConnections)
      .where(eq(menaMetaConnections.workspaceId, job.workspaceId))
      .limit(1),
    db
      .select()
      .from(menaMetaAutoReplySettings)
      .where(eq(menaMetaAutoReplySettings.workspaceId, job.workspaceId))
      .limit(1),
  ]);
  if (!item || item.replyText) {
    await markJob(job.id, job.workspaceId, "skipped", "ITEM_ALREADY_REPLIED");
    return;
  }
  if (
    Date.now() - item.occurredAt.getTime() >
    (item.kind === "message" ? messageReplyWindowMs : commentReplyWindowMs)
  ) {
    await markJob(
      job.id,
      job.workspaceId,
      "skipped",
      item.kind === "message"
        ? "META_MESSAGE_WINDOW_EXPIRED"
        : "META_COMMENT_WINDOW_EXPIRED",
    );
    return;
  }
  if (
    !connection ||
    !settings ||
    !settings.enabled ||
    !metaAutoReplyEnabled(settings, item.platform, item.kind)
  ) {
    await markJob(job.id, job.workspaceId, "skipped", "AUTOMATION_DISABLED");
    return;
  }
  const permission = metaAutoReplyPermission(item.platform, item.kind);
  const missing = missingMetaIntegrationPermissions(
    item.platform,
    connection.grantedPermissions,
  );
  if (!connection.authorizationVerifiedAt || missing.includes(permission)) {
    await markJob(
      job.id,
      job.workspaceId,
      "skipped",
      "META_PERMISSION_REQUIRED",
    );
    return;
  }
  if (
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt <= new Date()
  ) {
    await markJob(job.id, job.workspaceId, "skipped", "META_TOKEN_EXPIRED");
    return;
  }
  const expectedAccount =
    item.platform === "facebook"
      ? connection.pageId
      : connection.instagramUserId;
  if (
    item.parentId &&
    item.kind === "message" &&
    item.parentId !== expectedAccount
  ) {
    await markJob(job.id, job.workspaceId, "skipped", "META_ACCOUNT_MISMATCH");
    return;
  }
  if (item.kind === "comment" && item.actorId === expectedAccount) {
    await markJob(job.id, job.workspaceId, "skipped", "OWN_COMMENT");
    return;
  }

  const contextConditions = [
    eq(menaMetaInboxItems.workspaceId, job.workspaceId),
    eq(menaMetaInboxItems.platform, item.platform),
    eq(menaMetaInboxItems.conversationId, item.conversationId),
  ];
  if (item.kind === "comment") {
    if (!item.actorId) {
      await markJob(
        job.id,
        job.workspaceId,
        "skipped",
        "COMMENT_ACTOR_UNAVAILABLE",
      );
      return;
    }
    contextConditions.push(eq(menaMetaInboxItems.actorId, item.actorId));
  }
  const eventBeforeCurrent = or(
    lt(menaMetaInboxItems.occurredAt, item.occurredAt),
    and(
      eq(menaMetaInboxItems.occurredAt, item.occurredAt),
      lt(menaMetaInboxItems.createdAt, item.createdAt),
    ),
    and(
      eq(menaMetaInboxItems.occurredAt, item.occurredAt),
      eq(menaMetaInboxItems.createdAt, item.createdAt),
      lt(menaMetaInboxItems.id, item.id),
    ),
  );
  const [previousInteraction] = await db
    .select()
    .from(menaMetaInboxItems)
    .where(
      and(
        ...contextConditions,
        eq(menaMetaInboxItems.kind, item.kind),
        eventBeforeCurrent,
      ),
    )
    .limit(1);
  const conversation = await db
    .select({
      id: menaMetaInboxItems.id,
      workspaceId: menaMetaInboxItems.workspaceId,
      platform: menaMetaInboxItems.platform,
      conversationId: menaMetaInboxItems.conversationId,
      kind: menaMetaInboxItems.kind,
      actorId: menaMetaInboxItems.actorId,
      text: menaMetaInboxItems.text,
      replyText: menaMetaInboxItems.replyText,
      occurredAt: menaMetaInboxItems.occurredAt,
      createdAt: menaMetaInboxItems.createdAt,
    })
    .from(menaMetaInboxItems)
    .where(
      and(
        ...contextConditions,
        eq(menaMetaInboxItems.kind, item.kind),
        or(
          lt(menaMetaInboxItems.occurredAt, item.occurredAt),
          and(
            eq(menaMetaInboxItems.occurredAt, item.occurredAt),
            lt(menaMetaInboxItems.createdAt, item.createdAt),
          ),
          and(
            eq(menaMetaInboxItems.occurredAt, item.occurredAt),
            eq(menaMetaInboxItems.createdAt, item.createdAt),
            lte(menaMetaInboxItems.id, item.id),
          ),
        ),
      ),
    )
    .orderBy(
      desc(menaMetaInboxItems.occurredAt),
      desc(menaMetaInboxItems.createdAt),
      desc(menaMetaInboxItems.id),
    )
    .limit(30);
  const currentEvent: MetaAutoReplyConversationEvent = {
    id: item.id,
    workspaceId: job.workspaceId,
    platform: item.platform,
    conversationId: item.conversationId,
    kind: item.kind,
    actorId: item.actorId,
    text: item.text,
    replyText: item.replyText,
    occurredAt: item.occurredAt,
    createdAt: item.createdAt,
  };
  const context = buildMetaAutoReplyConversationContext(
    currentEvent,
    conversation,
  );
  const isFirstCustomerMessage = !hasPreviousMetaAutoReplyInteraction(
    currentEvent,
    previousInteraction ? [previousInteraction] : [],
  );
  let accessToken: string | null = null;
  const getAccessToken = async (): Promise<string> => {
    if (accessToken) return accessToken;
    const token = await metaPageAccessToken(
      connection.encryptedPageAccessToken,
    );
    if (token.rotatedCiphertext) {
      await db
        .update(menaMetaConnections)
        .set({ encryptedPageAccessToken: token.rotatedCiphertext })
        .where(
          and(
            eq(menaMetaConnections.workspaceId, job.workspaceId),
            eq(
              menaMetaConnections.encryptedPageAccessToken,
              connection.encryptedPageAccessToken,
            ),
          ),
        );
    }
    accessToken = token.accessToken;
    return accessToken;
  };
  const searchText = metaPostSearchText(item.text, context);
  const matchingProduct = await findRelevantCatalogProduct(
    job.workspaceId,
    item,
    searchText,
  );
  let post = await findRelevantPost(job.workspaceId, item, searchText);
  if (!post) {
    const readPermission =
      item.platform === "facebook"
        ? "pages_read_engagement"
        : "instagram_basic";
    if (connection.grantedPermissions.includes(readPermission)) {
      try {
        post = await findRelevantMetaPost(
          connection,
          item,
          await getAccessToken(),
          searchText,
        );
      } catch (error) {
        logger.warn(
          {
            workspaceId: job.workspaceId,
            jobId: job.id,
            platform: item.platform,
            errorCode:
              error instanceof Error
                ? error.message
                : "META_POST_LOOKUP_FAILED",
            ...(error instanceof MetaInboxGraphError
              ? { graphStatus: error.status, graphCode: error.code }
              : {}),
          },
          "Unable to load published Meta posts for automatic reply",
        );
      }
    } else {
      logger.warn(
        {
          workspaceId: job.workspaceId,
          jobId: job.id,
          platform: item.platform,
          requiredPermission: readPermission,
        },
        "Meta post lookup skipped because its read permission is not granted",
      );
    }
  }
  const wantsProductImages =
    item.kind === "message" && requestedMetaProductImages(item.text, context);
  const productImageUrls =
    wantsProductImages && (matchingProduct?.mediaUrls.length || post)
      ? await publishedPostImageUrls(
          job.workspaceId,
          matchingProduct?.mediaUrls.length
            ? matchingProduct.mediaUrls
            : (post?.mediaUrls ?? []),
        )
      : [];
  let pageBusinessInfo: string | null = null;
  if (metaBusinessInfoRequested(item.text)) {
    const readPermission =
      item.platform === "facebook"
        ? "pages_read_engagement"
        : "instagram_basic";
    if (connection.grantedPermissions.includes(readPermission)) {
      try {
        pageBusinessInfo = await getMetaPageBusinessInfo({
          platform: item.platform,
          pageId: connection.pageId,
          instagramUserId: connection.instagramUserId,
          accessToken: await getAccessToken(),
        });
      } catch (error) {
        logger.warn(
          {
            workspaceId: job.workspaceId,
            jobId: job.id,
            platform: item.platform,
            errorCode:
              error instanceof Error
                ? error.name
                : "META_PROFILE_LOOKUP_FAILED",
            ...(error instanceof MetaInboxGraphError
              ? { graphStatus: error.status, graphCode: error.code }
              : {}),
          },
          "Unable to load Meta business profile information for automatic reply",
        );
      }
    } else {
      logger.warn(
        {
          workspaceId: job.workspaceId,
          jobId: job.id,
          platform: item.platform,
          requiredPermission: readPermission,
        },
        "Meta business profile lookup skipped because its read permission is not granted",
      );
    }
  }

  let externalSendStarted = false;
  let externalSendSucceeded = false;
  try {
    const reply = await generateMetaAutoReply({
      workspaceId: job.workspaceId,
      context,
      post,
      contactInfo: metaBusinessInfoRequested(item.text)
        ? accountContactInfo(item.platform, connection)
        : "",
      pageBusinessInfo,
      productImagesWillBeSent: productImageUrls.length > 0,
      isFirstCustomerMessage,
      platform: item.platform,
      kind: item.kind,
      settings: {
        language: settings.language,
        tone: settings.tone,
        instructions: settings.instructions,
      },
      matchingProduct: matchingProduct
        ? {
            sku: matchingProduct.sku,
            name: matchingProduct.name,
            aliases: matchingProduct.aliases,
            description: matchingProduct.description,
            price: formatMetaAutoReplyPrice(matchingProduct.price),
            currency: matchingProduct.currency,
            availability: matchingProduct.availability,
            verifiedAt: matchingProduct.verifiedAt?.toISOString() ?? "",
          }
        : null,
    });
    const [latestSettings] = await db
      .select()
      .from(menaMetaAutoReplySettings)
      .where(eq(menaMetaAutoReplySettings.workspaceId, job.workspaceId))
      .limit(1);
    if (
      !latestSettings ||
      !latestSettings.enabled ||
      !metaAutoReplyEnabled(latestSettings, item.platform, item.kind)
    ) {
      await markJob(job.id, job.workspaceId, "skipped", "AUTOMATION_DISABLED");
      return;
    }
    const [latestItem] = await db
      .select({ replyText: menaMetaInboxItems.replyText })
      .from(menaMetaInboxItems)
      .where(
        and(
          eq(menaMetaInboxItems.id, item.id),
          eq(menaMetaInboxItems.workspaceId, job.workspaceId),
        ),
      )
      .limit(1);
    if (!latestItem || latestItem.replyText) {
      await markJob(job.id, job.workspaceId, "skipped", "ITEM_ALREADY_REPLIED");
      return;
    }
    const reservation = await reserveMetaInboxReply(job.workspaceId, item.id);
    if (reservation !== "reserved") {
      if (reservation === "in_progress") {
        await markJob(
          job.id,
          job.workspaceId,
          "skipped",
          "MANUAL_REPLY_IN_PROGRESS",
        );
        return;
      }
      await markJob(
        job.id,
        job.workspaceId,
        reservation === "unknown" ? "unknown" : "skipped",
        reservation === "unknown"
          ? "META_SEND_RESULT_UNKNOWN"
          : "ITEM_ALREADY_REPLIED",
      );
      return;
    }
    const [sending] = await db
      .update(menaMetaAutoReplyJobs)
      .set({
        status: "sending",
        leaseExpiresAt: new Date(Date.now() + leaseMs),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(menaMetaAutoReplyJobs.id, job.id),
          eq(menaMetaAutoReplyJobs.status, "processing"),
        ),
      )
      .returning({ id: menaMetaAutoReplyJobs.id });
    if (!sending) {
      await releaseMetaInboxReplyReservation(
        job.workspaceId,
        item.id,
        "available",
      );
      return;
    }

    const pageAccessToken = await getAccessToken();
    externalSendStarted = true;
    const replyText = reply;
    const replyExternalIds: string[] = [];
    for (const imageUrl of productImageUrls) {
      externalSendStarted = true;
      const imageResult = await sendMetaInboxReply({
        platform: item.platform,
        kind: "message",
        pageId: connection.pageId,
        instagramUserId: connection.instagramUserId,
        recipientId: item.conversationId,
        externalId: item.externalId,
        accessToken: pageAccessToken,
        text: replyText,
        imageUrl,
      });
      const id =
        (typeof imageResult.message_id === "string" &&
          imageResult.message_id) ||
        (typeof imageResult.id === "string" && imageResult.id);
      if (id) replyExternalIds.push(id);
      externalSendSucceeded = true;
    }
    externalSendStarted = true;
    const result = await sendMetaInboxReply({
      platform: item.platform,
      kind: item.kind,
      pageId: connection.pageId,
      instagramUserId: connection.instagramUserId,
      recipientId: item.conversationId,
      externalId: item.externalId,
      accessToken: pageAccessToken,
      text: replyText,
    });
    const textReplyExternalId =
      (typeof result.message_id === "string" && result.message_id) ||
      (typeof result.id === "string" && result.id);
    if (textReplyExternalId) replyExternalIds.push(textReplyExternalId);
    externalSendSucceeded = true;
    const replyExternalId = replyExternalIds.join(",").slice(0, 1000) || null;
    const repliedAt = new Date();
    const saved = await completeMetaInboxReply(job.workspaceId, item.id, {
      text: replyText,
      externalId: replyExternalId,
      repliedAt,
    });
    if (!saved) {
      await releaseMetaInboxReplyReservation(
        job.workspaceId,
        item.id,
        "unknown",
      );
      await markJob(
        job.id,
        job.workspaceId,
        "unknown",
        "META_SEND_RESULT_UNKNOWN",
      );
      return;
    }
    await markJob(job.id, job.workspaceId, "sent");
  } catch (error) {
    if (
      externalSendStarted &&
      error instanceof MetaInboxGraphError &&
      (error.networkFailure ||
        (error.status !== undefined && error.status >= 500))
    ) {
      await releaseMetaInboxReplyReservation(
        job.workspaceId,
        item.id,
        "unknown",
      );
      await markJob(
        job.id,
        job.workspaceId,
        "unknown",
        "META_SEND_RESULT_UNKNOWN",
      );
      return;
    }
    if (
      externalSendStarted &&
      (externalSendSucceeded ||
        !(error instanceof MetaInboxGraphError && error.status === 429))
    ) {
      await releaseMetaInboxReplyReservation(
        job.workspaceId,
        item.id,
        "unknown",
      );
      await markJob(
        job.id,
        job.workspaceId,
        "unknown",
        "META_SEND_RESULT_UNKNOWN",
      );
      return;
    }
    await releaseMetaInboxReplyReservation(
      job.workspaceId,
      item.id,
      "available",
    );
    await retryOrFail(job, error);
  }
}

export async function processMetaAutoReplyQueue(limit = 5): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    for (let count = 0; count < limit; count += 1) {
      const job = await claimNextJob();
      if (!job) break;
      try {
        await processJob(job);
      } catch (error) {
        logger.error(
          { err: error, workspaceId: job.workspaceId, jobId: job.id },
          "Meta automatic reply worker failed",
        );
        await markJob(
          job.id,
          job.workspaceId,
          "failed",
          "WORKER_PROCESSING_FAILED",
        );
      }
    }
  } finally {
    processing = false;
  }
}

export function createMetaAutoReplyJobId(): string {
  return randomUUID();
}
