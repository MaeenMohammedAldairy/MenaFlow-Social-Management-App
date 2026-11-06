import { createHash } from "node:crypto";

export function normalizedProductName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function workspaceMediaKey(workspaceId: string): string {
  return createHash("sha256")
    .update(workspaceId)
    .digest("hex")
    .slice(0, 16);
}
