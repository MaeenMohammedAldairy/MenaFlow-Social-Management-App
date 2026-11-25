import { deleteMetaConnection } from "./generated/api";
import type { MetaDisconnectResponse } from "./generated/api.schemas";

export type MetaPlatform = "facebook" | "instagram";

/**
 * Positional form of the generated `deleteMetaConnection`, under the name and
 * signature the screens already call. The transport is the generated one, so a
 * refusal is the same `ApiError` as everywhere else.
 */
export function deleteMetaConnectionForPlatform(
  platform: MetaPlatform,
): Promise<MetaDisconnectResponse> {
  return deleteMetaConnection({ platform });
}
