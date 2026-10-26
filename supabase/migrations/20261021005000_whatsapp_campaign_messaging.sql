CREATE TABLE public.mena_whatsapp_customer_consents (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  conversation_jid text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  evidence_reference text NOT NULL,
  source_message_id text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_customer_consents_status_check
    CHECK (status IN ('opted_in', 'opted_out')),
  CONSTRAINT mena_whatsapp_customer_consents_source_check
    CHECK (source IN ('in_person', 'website', 'email', 'import', 'whatsapp'))
);

CREATE INDEX mena_whatsapp_customer_consents_lookup_idx
  ON public.mena_whatsapp_customer_consents
    (workspace_id, instance_name, conversation_jid, recorded_at);

CREATE UNIQUE INDEX mena_whatsapp_customer_consents_source_message_key
  ON public.mena_whatsapp_customer_consents
    (workspace_id, instance_name, source_message_id);

CREATE TABLE public.mena_whatsapp_campaigns (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  name text NOT NULL,
  template text NOT NULL,
  variables jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_campaigns_status_check
    CHECK (status IN ('draft', 'sending', 'partial', 'completed'))
);

CREATE INDEX mena_whatsapp_campaigns_workspace_created_idx
  ON public.mena_whatsapp_campaigns (workspace_id, created_at);

CREATE TABLE public.mena_whatsapp_campaign_recipients (
  id text PRIMARY KEY,
  campaign_id text NOT NULL
    REFERENCES public.mena_whatsapp_campaigns(id) ON DELETE CASCADE,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  conversation_jid text NOT NULL,
  customer_name text,
  rendered_body text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  send_attempts integer NOT NULL DEFAULT 0,
  eligibility_reason text,
  external_message_id text,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_campaign_recipients_status_check
    CHECK (status IN ('pending', 'blocked', 'sending', 'accepted', 'failed', 'unknown')),
  CONSTRAINT mena_whatsapp_campaign_recipients_send_attempts_check
    CHECK (send_attempts >= 0),
  CONSTRAINT mena_whatsapp_campaign_recipients_campaign_jid_key
    UNIQUE (campaign_id, conversation_jid)
);

CREATE INDEX mena_whatsapp_campaign_recipients_workspace_idx
  ON public.mena_whatsapp_campaign_recipients
    (workspace_id, campaign_id, status);

ALTER TABLE public.mena_whatsapp_customer_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_campaign_recipients ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mena_whatsapp_customer_consents FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_whatsapp_campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_whatsapp_campaign_recipients FROM anon, authenticated;
