import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { Router } from "express";
import { db, posts, productPosts, products } from "@workspace/db";

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
  res.json({
    products: await Promise.all(
      [...grouped.values()].map(({ product, postIds }) =>
        catalogProductResponse(product, workspaceId, postIds, requestOrigin),
      ),
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
