import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { Router } from "express";
import {
  db,
  posts,
  productPosts,
  productPublicationJobs,
  products,
} from "@workspace/db";

import { requestOwnerId } from "../lib/owner-access";

import { requireWorkspace, requestWorkspaceId } from "../lib/workspace-context";

const router = Router();
import {
  mediaUrls,
  mediaRequestOrigin,
  productMediaPreviews,
  catalogProductResponse,
} from "./product-route-helpers";

router.get("/social/products", requireWorkspace, async (req, res) => {
  if (!requestOwnerId(req)) {
    res.status(401).json({ error: "سجّل الدخول أولاً." });
    return;
  }
  const workspaceId = requestWorkspaceId(req);
  const requestOrigin = mediaRequestOrigin(req);
  const includeArchived = req.query.includeArchived === "true";
  const rows = await db
    .select({ product: products, postId: productPosts.postId })
    .from(products)
    .leftJoin(
      productPosts,
      and(
        eq(productPosts.workspaceId, products.workspaceId),
        eq(productPosts.productId, products.id),
      ),
    )
    .where(
      includeArchived
        ? eq(products.workspaceId, workspaceId)
        : and(
            eq(products.workspaceId, workspaceId),
            ne(products.status, "archived"),
          ),
    )
    .orderBy(desc(products.updatedAt));
  const grouped = new Map<
    string,
    { product: (typeof rows)[number]["product"]; postIds: string[] }
  >();
  for (const row of rows) {
    const current = grouped.get(row.product.id) ?? {
      product: row.product,
      postIds: [],
    };
    if (row.postId) current.postIds.push(row.postId);
    grouped.set(row.product.id, current);
  }
  const productIds = [...grouped.keys()];
  const publicationRows = productIds.length
    ? await db
        .selectDistinctOn(
          [
            productPublicationJobs.productId,
            productPublicationJobs.channel,
            productPublicationJobs.accountId,
          ],
          {
            productId: productPublicationJobs.productId,
            channel: productPublicationJobs.channel,
            accountId: productPublicationJobs.accountId,
            permalink: productPublicationJobs.permalink,
            createdAt: productPublicationJobs.createdAt,
            completedAt: productPublicationJobs.completedAt,
          },
        )
        .from(productPublicationJobs)
        .where(
          and(
            eq(productPublicationJobs.workspaceId, workspaceId),
            inArray(productPublicationJobs.productId, productIds),
            eq(productPublicationJobs.status, "published"),
          ),
        )
        .orderBy(
          productPublicationJobs.productId,
          productPublicationJobs.channel,
          productPublicationJobs.accountId,
          desc(productPublicationJobs.createdAt),
        )
    : [];
  const publicationHistoryByProduct = new Map<string, typeof publicationRows>();
  for (const publication of publicationRows) {
    const history =
      publicationHistoryByProduct.get(publication.productId) ?? [];
    history.push(publication);
    publicationHistoryByProduct.set(publication.productId, history);
  }
  for (const history of publicationHistoryByProduct.values()) {
    history.sort(
      (a, b) =>
        (b.completedAt ?? b.createdAt).getTime() -
        (a.completedAt ?? a.createdAt).getTime(),
    );
  }
  res.json({
    products: await Promise.all(
      [...grouped.values()].map(async ({ product, postIds }) => ({
        ...(await catalogProductResponse(
          product,
          workspaceId,
          postIds,
          requestOrigin,
        )),
        publicationHistory: publicationHistoryByProduct.get(product.id) ?? [],
      })),
    ),
  });
});

router.get(
  "/social/products/post-candidates",
  requireWorkspace,
  async (req, res) => {
    if (!requestOwnerId(req)) {
      res.status(401).json({ error: "سجّل الدخول أولاً." });
      return;
    }
    const workspaceId = requestWorkspaceId(req);
    const candidates = await db
      .select({
        id: posts.id,
        title: posts.title,
        body: posts.body,
        mediaUrls: posts.mediaUrls,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .leftJoin(
        productPosts,
        and(
          eq(productPosts.workspaceId, posts.workspaceId),
          eq(productPosts.postId, posts.id),
        ),
      )
      .where(
        and(
          eq(posts.workspaceId, workspaceId),
          or(
            eq(posts.status, "published"),
            sql`${posts.publishResults}->'facebook'->>'status' = 'published'`,
            sql`${posts.publishResults}->'instagram'->>'status' = 'published'`,
          ),
          isNull(productPosts.productId),
        ),
      )
      .orderBy(desc(posts.updatedAt))
      .limit(50);
    const requestOrigin = mediaRequestOrigin(req);
    res.json({
      candidates: await Promise.all(
        candidates
          .filter((post) => post.title.trim() || post.body.trim())
          .map(async (post) => {
            const postMediaUrls = mediaUrls(post.mediaUrls);
            return {
              ...post,
              mediaUrls: postMediaUrls,
              mediaPreviews: await productMediaPreviews(
                workspaceId,
                postMediaUrls,
                requestOrigin,
              ),
              updatedAt: post.updatedAt.toISOString(),
            };
          }),
      ),
    });
  },
);

export default router;
