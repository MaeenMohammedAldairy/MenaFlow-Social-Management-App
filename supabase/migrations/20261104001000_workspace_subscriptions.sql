CREATE TABLE public.mena_workspace_subscriptions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL UNIQUE
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  plan_id text NOT NULL
    CHECK (plan_id IN ('free', 'starter', 'growth')),
  status text NOT NULL
    CHECK (status IN ('trialing', 'active', 'canceled', 'past_due')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  payment_provider text,
  provider_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX mena_workspace_subscriptions_status_idx
  ON public.mena_workspace_subscriptions (status);

CREATE TABLE public.mena_workspace_subscription_usage (
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  ai_generations integer NOT NULL DEFAULT 0 CHECK (ai_generations >= 0),
  posts_created integer NOT NULL DEFAULT 0 CHECK (posts_created >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_key)
);

INSERT INTO public.mena_workspace_subscriptions (
  id, workspace_id, plan_id, status, created_at, updated_at
)
SELECT
  'subscription:' || workspace.id,
  workspace.id,
  'free',
  'active',
  now(),
  now()
FROM public.mena_workspaces AS workspace
ON CONFLICT (workspace_id) DO NOTHING;

INSERT INTO public.mena_workspace_subscription_usage (
  workspace_id, period_key, posts_created
)
SELECT
  post.workspace_id,
  to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM'),
  count(*)::integer
FROM public.mena_posts AS post
WHERE post.created_at >= (
  date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
)
AND post.created_at < (
  date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  + interval '1 month'
)
GROUP BY post.workspace_id
ON CONFLICT (workspace_id, period_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mena_enforce_post_subscription_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  subscription_plan text;
  subscription_status text;
  trial_ends_at timestamptz;
  v_period_key text := to_char(date_trunc('month', now() AT TIME ZONE 'UTC'), 'YYYY-MM');
  post_limit integer;
  current_usage integer;
BEGIN
  SELECT plan_id, status, mena_workspace_subscriptions.trial_ends_at
  INTO subscription_plan, subscription_status, trial_ends_at
  FROM public.mena_workspace_subscriptions
  WHERE workspace_id = NEW.workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_CONFIGURATION_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF subscription_status = 'trialing' AND trial_ends_at > now() THEN
    subscription_plan := 'growth';
  ELSIF subscription_status <> 'active' OR subscription_status = 'trialing' THEN
    subscription_plan := 'free';
  END IF;

  post_limit := CASE subscription_plan
    WHEN 'starter' THEN 100
    WHEN 'growth' THEN 500
    ELSE 10
  END;

  INSERT INTO public.mena_workspace_subscription_usage (
    workspace_id, period_key, posts_created
  ) VALUES (NEW.workspace_id, v_period_key, 0)
  ON CONFLICT (workspace_id, period_key) DO NOTHING;

  SELECT posts_created INTO current_usage
  FROM public.mena_workspace_subscription_usage
  WHERE workspace_id = NEW.workspace_id
    AND mena_workspace_subscription_usage.period_key = v_period_key
  FOR UPDATE;

  IF current_usage >= post_limit THEN
    RAISE EXCEPTION 'SUBSCRIPTION_LIMIT_REACHED:posts'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.mena_workspace_subscription_usage
  SET posts_created = posts_created + 1, updated_at = now()
  WHERE workspace_id = NEW.workspace_id
    AND mena_workspace_subscription_usage.period_key = v_period_key;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mena_posts_subscription_limit
AFTER INSERT ON public.mena_posts
FOR EACH ROW
EXECUTE FUNCTION public.mena_enforce_post_subscription_limit();

ALTER TABLE public.mena_workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_workspace_subscription_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_workspace_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_workspace_subscription_usage FROM anon, authenticated;
