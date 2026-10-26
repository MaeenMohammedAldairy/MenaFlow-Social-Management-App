import { createHash } from "node:crypto";

export function whatsappInstanceNameForWorkspace(workspaceId: string): string {
  const workspaceHash = createHash("sha256")
    .update(workspaceId)
    .digest("hex")
    .slice(0, 12);
  return `menaflow-${workspaceHash}`;
}
