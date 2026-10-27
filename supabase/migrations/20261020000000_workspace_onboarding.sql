CREATE TABLE public.mena_workspace_onboarding (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  current_step integer NOT NULL DEFAULT 3,
  completed boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_workspace_onboarding_step_check CHECK (current_step BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX mena_workspace_onboarding_workspace_user_key
  ON public.mena_workspace_onboarding (workspace_id, user_id);

CREATE INDEX mena_workspace_onboarding_user_idx
  ON public.mena_workspace_onboarding (user_id);

ALTER TABLE public.mena_workspace_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_workspace_onboarding FROM anon, authenticated;
