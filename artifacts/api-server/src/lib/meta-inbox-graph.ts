import { request as httpsRequest } from "node:https";
import { asRecord as record } from "./value-utils.ts";
import { decryptMetaTokenForRotation } from "./meta-token-crypto.ts";
import { getMetaGraphVersion } from "./meta-graph-config.ts";

type MetaGraphResult = Record<string, unknown>;

export type MetaPublishedPost = {
  postId: string;
  title: string;
  body: string;
  mediaUrls: string[];
};

export class MetaInboxGraphError extends Error {
  readonly status: number | undefined;
  readonly code: number | undefined;
  readonly networkFailure: boolean;

  constructor(
    status: number | undefined,
    code: number | undefined,
    networkFailure: boolean,
  ) {
    super("META_INBOX_GRAPH_REQUEST_FAILED");
    this.status = status;
    this.code = code;
    this.networkFailure = networkFailure;
  }
}

export async function metaPageAccessToken(
  encryptedToken: string,
): Promise<{ accessToken: string; rotatedCiphertext?: string }> {
  return decryptMetaTokenForRotation(encryptedToken);
}

export async function postMetaInboxGraph(
  edge: string,
  accessToken: string,
  fields: Record<string, string>,
): Promise<MetaGraphResult> {
  const params = new URLSearchParams({ ...fields, access_token: accessToken });
  const body = params.toString();
  const url = new URL(
    `https://graph.facebook.com/${getMetaGraphVersion()}/${edge.replace(/^\/+/, "")}`,
  );

  let response: { status: number; body: string };
  try {
    response = await new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: "POST",
          family: 4,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(body),
          },
          signal: AbortSignal.timeout(15_000),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end(body);
    });
  } catch {
    throw new MetaInboxGraphError(undefined, undefined, true);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new MetaInboxGraphError(response.status, undefined, false);
  }
  const result =
    payload && typeof payload === "object" ? (payload as MetaGraphResult) : {};
  const error =
    result.error && typeof result.error === "object"
      ? (result.error as Record<string, unknown>)
      : null;
  const code = typeof error?.code === "number" ? error.code : undefined;
  if (response.status < 200 || response.status >= 300 || error) {
    throw new MetaInboxGraphError(response.status, code, false);
  }
  return result;
}

function facebookAttachmentImageUrls(value: unknown): string[] {
  const attachment = record(value);
  if (!attachment) return [];
  const media = record(attachment.media);
  const image = record(media?.image);
  const type = typeof attachment.type === "string" ? attachment.type : "";
  const imageUrl =
    ["photo", "album", "image"].includes(type) && typeof image?.src === "string"
      ? [image.src]
      : [];
  const subattachments = record(attachment.subattachments);
  const children = Array.isArray(subattachments?.data)
    ? subattachments.data.flatMap(facebookAttachmentImageUrls)
    : [];
  return [...imageUrl, ...children];
}

export function normalizeMetaPublishedPosts(
  value: unknown,
  platform: "facebook" | "instagram",
): MetaPublishedPost[] {
  const response = record(value);
  const data = Array.isArray(response?.data)
    ? response.data
    : response?.id
      ? [response]
      : [];
  return data.flatMap((value) => {
    const post = record(value);
    if (!post || typeof post.id !== "string") return [];
    const body =
      platform === "facebook"
        ? typeof post.message === "string"
          ? post.message
          : ""
        : typeof post.caption === "string"
          ? post.caption
          : "";
    let mediaUrls: string[] = [];
    if (platform === "facebook") {
      const attachments = record(post.attachments);
      mediaUrls = Array.isArray(attachments?.data)
        ? attachments.data.flatMap(facebookAttachmentImageUrls)
        : [];
    } else {
      const mediaType =
        typeof post.media_type === "string" ? post.media_type : "";
      if (mediaType === "IMAGE" && typeof post.media_url === "string") {
        mediaUrls.push(post.media_url);
      }
      const children = record(post.children);
      if (Array.isArray(children?.data)) {
        mediaUrls.push(
          ...children.data.flatMap((child) => {
            const media = record(child);
            return media?.media_type === "IMAGE" &&
              typeof media.media_url === "string"
              ? [media.media_url]
              : [];
          }),
        );
      }
    }
    return [
      {
        postId: post.id,
        title: body.slice(0, 250),
        body: body.slice(0, 3000),
        mediaUrls: [...new Set(mediaUrls)].slice(0, 10),
      },
    ];
  });
}

export function normalizeMetaPageBusinessInfo(
  value: unknown,
  platform: "facebook" | "instagram",
): string | null {
  const profile = record(value);
  if (!profile) return null;
  const lines: string[] = [];
  const fields: Array<[string, string]> =
    platform === "facebook"
      ? [
          ["name", "اسم الصفحة"],
          ["category", "النشاط"],
          ["about", "نبذة"],
          ["description", "الوصف"],
          ["phone", "الهاتف"],
          ["website", "الموقع الإلكتروني"],
          ["link", "رابط الصفحة"],
        ]
      : [
          ["name", "اسم الحساب"],
          ["username", "اسم المستخدم"],
          ["biography", "النبذة"],
          ["website", "الموقع الإلكتروني"],
        ];
  for (const [field, label] of fields) {
    const text = profile[field];
    if (typeof text === "string" && text.trim()) {
      lines.push(`${label}: ${text.trim().slice(0, 500)}`);
    }
  }
  if (platform === "facebook") {
    const location = record(profile.location);
    const address = ["street", "city", "state", "zip", "country"]
      .flatMap((field) => {
        const text = location?.[field];
        return typeof text === "string" && text.trim() ? [text.trim()] : [];
      })
      .join("، ");
    if (address) lines.push(`العنوان: ${address.slice(0, 500)}`);
    const hours = profile.hours;
    if (hours && typeof hours === "object") {
      lines.push(`ساعات العمل: ${JSON.stringify(hours).slice(0, 1000)}`);
    }
  }
  return lines.length > 0 ? lines.join("\n").slice(0, 2000) : null;
}

export async function getMetaPageBusinessInfo(input: {
  platform: "facebook" | "instagram";
  pageId: string;
  instagramUserId: string | null;
  accessToken: string;
}): Promise<string | null> {
  const accountId =
    input.platform === "facebook" ? input.pageId : input.instagramUserId;
  if (!accountId) return null;
  const fields =
    input.platform === "facebook"
      ? "id,name,category,about,description,phone,website,link,location,hours"
      : "id,name,username,biography,website";
  const url = new URL(
    `https://graph.facebook.com/${getMetaGraphVersion()}/${encodeURIComponent(accountId)}`,
  );
  url.searchParams.set("fields", fields);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MetaInboxGraphError(undefined, undefined, true);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaInboxGraphError(response.status, undefined, false);
  }
  const result = record(payload);
  const error = record(result?.error);
  if (!response.ok || error) {
    throw new MetaInboxGraphError(
      response.status,
      typeof error?.code === "number" ? error.code : undefined,
      false,
    );
  }
  return normalizeMetaPageBusinessInfo(result, input.platform);
}

async function fetchMetaPublishedPostsPage(
  url: URL,
  accessToken: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MetaInboxGraphError(undefined, undefined, true);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaInboxGraphError(response.status, undefined, false);
  }
  const result = record(payload) ?? {};
  const error = record(result.error);
  if (!response.ok || error) {
    throw new MetaInboxGraphError(
      response.status,
      typeof error?.code === "number" ? error.code : undefined,
      false,
    );
  }
  return result;
}

export async function getMetaPublishedPosts(input: {
  platform: "facebook" | "instagram";
  pageId: string;
  instagramUserId: string | null;
  accessToken: string;
  postId?: string;
}): Promise<MetaPublishedPost[]> {
  const edge = input.postId
    ? encodeURIComponent(input.postId)
    : input.platform === "facebook"
      ? `${encodeURIComponent(input.pageId)}/published_posts`
      : `${encodeURIComponent(input.instagramUserId ?? "")}/media`;
  if (input.platform === "instagram" && !input.instagramUserId) {
    throw new Error("META_INSTAGRAM_ACCOUNT_UNAVAILABLE");
  }
  const fields =
    input.platform === "facebook"
      ? "id,message,attachments{media,type,subattachments{media,type}}"
      : "id,caption,media_type,media_url,children{media_type,media_url}";
  const url = new URL(
    `https://graph.facebook.com/${getMetaGraphVersion()}/${edge}`,
  );
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", "50");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new MetaInboxGraphError(undefined, undefined, true);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MetaInboxGraphError(response.status, undefined, false);
  }
  const result = record(payload) ?? {};
  const error = record(result.error);
  if (!response.ok || error) {
    throw new MetaInboxGraphError(
      response.status,
      typeof error?.code === "number" ? error.code : undefined,
      false,
    );
  }
  const posts = normalizeMetaPublishedPosts(result, input.platform);
  let currentPage = result;
  let after: string | undefined;
  for (let page = 1; page < 5 && !input.postId; page += 1) {
    const paging = record(currentPage.paging);
    const cursors = record(paging?.cursors);
    after = typeof cursors?.after === "string" ? cursors.after : undefined;
    if (!after) break;
    url.searchParams.set("after", after);
    currentPage = await fetchMetaPublishedPostsPage(url, input.accessToken);
    posts.push(...normalizeMetaPublishedPosts(currentPage, input.platform));
  }
  return posts;
}

export async function sendMetaInboxReply(input: {
  platform: "facebook" | "instagram";
  kind: "message" | "comment";
  pageId: string;
  instagramUserId: string | null;
  recipientId: string;
  externalId: string;
  accessToken: string;
  text: string;
  imageUrl?: string;
}): Promise<MetaGraphResult> {
  const request = buildMetaInboxReplyRequest(input);
  return postMetaInboxGraph(request.edge, input.accessToken, request.fields);
}

export function buildMetaInboxReplyRequest(input: {
  platform: "facebook" | "instagram";
  kind: "message" | "comment";
  pageId: string;
  instagramUserId: string | null;
  recipientId: string;
  externalId: string;
  text: string;
  imageUrl?: string;
}): { edge: string; fields: Record<string, string> } {
  const edge =
    input.kind === "comment"
      ? input.platform === "instagram"
        ? `${encodeURIComponent(input.externalId)}/replies`
        : `${encodeURIComponent(input.externalId)}/comments`
      : `${encodeURIComponent(
          input.platform === "instagram"
            ? (input.instagramUserId ?? input.pageId)
            : input.pageId,
        )}/messages`;
  const fields: Record<string, string> =
    input.kind === "message"
      ? {
          recipient: JSON.stringify({ id: input.recipientId }),
          message: JSON.stringify(
            input.imageUrl
              ? {
                  attachment: {
                    type: "image",
                    payload: { url: input.imageUrl, is_reusable: true },
                  },
                }
              : { text: input.text },
          ),
        }
      : { message: input.text };
  return { edge, fields };
}
