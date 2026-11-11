CREATE TABLE public.mena_workspace_deletion_requests (
  id text PRIMARY KEY,
  workspace_id text NOT NULL UNIQUE
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  requested_by text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = 'pending'),
  requested_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mena_workspace_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_workspace_deletion_requests FROM anon, authenticated;
