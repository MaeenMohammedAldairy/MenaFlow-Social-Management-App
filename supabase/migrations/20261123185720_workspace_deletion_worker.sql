-- Workspace deletion worker (§3.4 of docs/audit/menaflow-recommendations-2026-11-22.md).
--
-- The request table only allowed status='pending' because nothing ever
-- processed the rows. The worker needs the full lifecycle:
-- pending → (30-day grace) → completed → the row is deleted together with
-- the workspace it belongs to; 'failed' keeps the row (with the reason) so a
-- permanently broken teardown is visible instead of silently retrying forever.
ALTER TABLE mena_workspace_deletion_requests
  DROP CONSTRAINT mena_workspace_deletion_requests_status_check;

ALTER TABLE mena_workspace_deletion_requests
  ADD CONSTRAINT mena_workspace_deletion_requests_status_check
  CHECK (status IN ('pending', 'completed', 'failed'));

-- Retry budget + failure reason, mirroring the mena_content_jobs pattern.
ALTER TABLE mena_workspace_deletion_requests
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_error text,
  ADD COLUMN completed_at TIMESTAMPTZ;

CREATE INDEX mena_workspace_deletion_requests_due_idx
  ON mena_workspace_deletion_requests (status, requested_at);
