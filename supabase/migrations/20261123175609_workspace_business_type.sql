-- Business type for a workspace, captured by the concise post-signup setup
-- (business name reuses mena_workspaces.name; the type had no home before).
-- Nullable on purpose: workspaces created before this column, and workspaces
-- whose owner deferred the question, simply have no answer yet. The dashboard
-- setup checklist treats "no answer" as an open step, so there is no need for a
-- placeholder value and no CHECK constraint freezing the vocabulary in SQL.
ALTER TABLE mena_workspaces
  ADD COLUMN business_type text;
