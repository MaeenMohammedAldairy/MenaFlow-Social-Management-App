import { customFetch } from "./custom-fetch";
import type { MetaDisconnectResponse } from "./generated/api.schemas";

export type MetaPlatform = "facebook" | "instagram";

export function deleteMetaConnectionForPlatform(
  platform: MetaPlatform,
): Promise<MetaDisconnectResponse> {
  return customFetch<MetaDisconnectResponse>(
    `/api/social/meta?platform=${platform}`,
    { method: "DELETE" },
  );
}
