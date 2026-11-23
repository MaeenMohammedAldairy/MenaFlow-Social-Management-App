-- Post scheduling (§4.7 of docs/audit/menaflow-recommendations-2026-11-22.md).
--
-- scheduled_at is nullable on purpose: only posts with status='scheduled'
-- carry a due time, and the writer validates that it is in the future. The
-- index leads with (status, scheduled_at) because the scheduled-posts worker
-- scans globally for due rows — `WHERE status='scheduled' AND scheduled_at <=
-- now() ... FOR UPDATE SKIP LOCKED` — not per workspace.
ALTER TABLE mena_posts
  ADD COLUMN scheduled_at TIMESTAMPTZ;

CREATE INDEX mena_posts_status_scheduled_at_idx
  ON mena_posts (status, scheduled_at);

-- Explicit per-workspace timezone (IANA name, UTC default). Scheduled times
-- travel as absolute ISO-8601 instants, so the server never guesses; the
-- column exists so clients can display and capture times in the merchant's
-- own zone (Riyadh/Dubai/Sanaa customers) instead of the device locale only.
ALTER TABLE mena_workspaces
  ADD COLUMN timezone text NOT NULL DEFAULT 'UTC';
