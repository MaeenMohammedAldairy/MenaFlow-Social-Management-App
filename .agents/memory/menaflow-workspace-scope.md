---
name: MenaFlow workspace scope
description: Product scope for workspace access, member roles, and connected social accounts.
---

MenaFlow serves **one business owner plus a small staff (2–3 employees)** inside a single workspace. It is not a personal single-user tool, and it is not a multi-tenant SaaS where a visitor signs up into someone else's workspace.

**Why:** The user chose this scope explicitly on 2026-11-22, reversing the earlier single-owner-only decision. It matches the Yemeni/Gulf target market (shop owner + a few staff) and it justifies the multi-member structures already in the codebase (`mena_workspace_members`, `x-workspace-id`, per-workspace isolation, plans and quotas, owner console).

**Status — 2026-11-22: decided but deferred.** The user postponed the roles and
permissions work to focus on the product's core functions. Treat this file as
the agreed *direction*, not as a licence to build: **do not implement staff
access, invitations, member management, or the role guard yet.** Until it is
requested, the workspace holds exactly one real user (the owner), which is why
deferring the role guard is safe. Everything under "How to apply" below is what
to honour *when* the work resumes — and the ordering constraint in
`docs/audit/menaflow-recommendations-2026-11-22.md` §4.9 still stands: the
central role guard and the `CHECK` constraint on `role` must land before any
invitation flow, never after.

**How to apply:**

- **Role vocabulary is fixed at `owner` / `admin` / `member`.** This is not a new invention: the mobile settings screen already renders all three (`SettingsScreen.tsx:412-417` → «مالك» / «مسؤول» / «عضو») and `meta-oauth.test.mjs:19-21` already asserts all three. Do not add a fourth role, and do not rename these.
- **`mena_workspace_members.role` is plain `text` with no CHECK constraint and defaults to `"owner"`** (`lib/db/src/schema/workspaces.ts:70`). Any string is accepted today. Add a CHECK constraint or app-level validation before member management ships, or a typo silently grants the highest role.
- **Staff join by invitation only.** Never auto-provision membership from a signup flow, and never let a client assert its own role.
- **Guard the auto-create fallback before shipping staff access.** `workspace-resolution.ts:70-95` creates a *new* workspace plus an `owner` membership for any authenticated user with zero memberships. That is correct self-heal for a first-time owner, but once staff exist it means a de-provisioned employee silently lands in their own empty workspace instead of receiving 403 — and a bug in membership lookup would do the same. **Verified blocker:** the server cannot currently tell a new user from a de-provisioned one — it stores nothing about users outside their memberships and never calls the Clerk admin API (`clerkClient`/`users.getUser` appear nowhere in `api-server/src`). So restricting the fallback needs either a Clerk lookup or a stored marker; it cannot be done by a focused edit alone, and it is deferred together with the rest of the staff work.
- **Enforcement is currently near-absent; treat that as the work, not as a design.** Only two role checks exist server-side: `canManageMetaConnections(role)` → `role === "owner"` (`meta-oauth.ts:20`, used at `routes/meta.ts:70,459`) and `requireWorkspaceOwner` (`routes/workspaces.ts:18-28`). Everything else only checks workspace membership. Add a central role guard rather than sprinkling `if (role !== …)` per route.
- **Keep Meta and WhatsApp connection management owner-only** unless the user changes it. Connection credentials are workspace-scoped and powerful; re-auth flows and instance deletion should not be reachable by staff. This is the existing tested behavior — preserve it.
- **Plan limits stay per workspace, not per seat.** `plan-catalog.ts` counts posts/AI/channels for the workspace as a whole, so staff share the owner's quota. Do not move to per-seat pricing without an explicit decision from the user.
- **No admin action without an audit trail.** Before staff can change settings, add an audit log for privileged operations (role changes, connection changes, deletions, plan changes). Today there is none.
- **Do not introduce cross-workspace or organization-level concepts** (orgs, teams spanning workspaces, SSO groups). One owner, one workspace, a few members.

**Supersedes:** the previous guidance in `menaflow-single-owner.md` ("MenaFlow is for one business owner… Do not introduce team or member access"), which was deleted on 2026-11-22 because it contradicted both this decision and the code. Context and the full analysis: `docs/audit/menaflow-recommendations-2026-11-22.md` §2, القرار 1.
