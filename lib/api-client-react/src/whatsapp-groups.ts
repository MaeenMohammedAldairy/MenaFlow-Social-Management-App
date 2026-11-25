/**
 * WhatsApp groups and sync.
 *
 * A thin adapter over the generated client, not a second implementation. Every
 * type and every transport function comes from `@workspace/api-spec` via
 * codegen, so the contract is the only place these shapes are written down.
 *
 * What stays here is ergonomics only:
 *   - `triggerWhatsAppSyncNow` / `getWhatsAppGroupMessages` keep the names and
 *     positional argument order the screens already use, instead of the
 *     generated `triggerWhatsAppSync` / `listWhatsAppGroupMessages`.
 *   - `WhatsAppSyncStatusEntry` keeps the name the sync panel imports, instead
 *     of the contract's `WhatsAppSyncStatusGroup`.
 *
 * Before this was a hand-written module with its own copies of the sync status,
 * message and media types, kept in sync with the server by hand — the drift the
 * contract exists to prevent.
 */
import {
  triggerWhatsAppSync,
  listWhatsAppGroupMessages,
} from "./generated/api";
import type {
  ListWhatsAppGroupMessagesParams,
  TriggerWhatsAppSyncBody,
  WhatsAppGroupMessagesResponse,
  WhatsAppSyncStatusGroup,
  WhatsAppSyncTriggerResponse,
} from "./generated/api.schemas";
import type { customFetch } from "./custom-fetch";

export {
  getWhatsAppGroupSelections,
  getWhatsAppGroups,
  getWhatsAppSyncStatus,
  saveWhatsAppGroupSelections,
  updateWhatsAppSyncSettings,
} from "./generated/api";

export type {
  WhatsAppGroup,
  WhatsAppGroupMessagesResponse,
  WhatsAppGroupOption,
  WhatsAppGroupsResponse,
  WhatsAppGroupSelectionsResponse,
  WhatsAppMessage,
  WhatsAppMessageMedia,
  WhatsAppSyncStatusGroup,
  WhatsAppSyncStatusResponse,
  WhatsAppSyncTriggerResponse,
} from "./generated/api.schemas";

/** The contract calls this a status *group*; the sync panel calls it an entry. */
export type WhatsAppSyncStatusEntry = WhatsAppSyncStatusGroup;

export async function triggerWhatsAppSyncNow(
  includeHistory = false,
  options?: Parameters<typeof customFetch>[1],
  historyLimit?: number,
): Promise<WhatsAppSyncTriggerResponse> {
  const body: TriggerWhatsAppSyncBody = { includeHistory };
  if (includeHistory && historyLimit !== undefined) {
    body.historyLimit = historyLimit;
  }
  return triggerWhatsAppSync(body, options);
}

export async function getWhatsAppGroupMessages(
  groupJid: string,
  params?: ListWhatsAppGroupMessagesParams,
  options?: Parameters<typeof customFetch>[1],
): Promise<WhatsAppGroupMessagesResponse> {
  return listWhatsAppGroupMessages(groupJid, params, options);
}
