CREATE TABLE public.mena_whatsapp_product_extraction_jobs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  message_id text NOT NULL REFERENCES public.mena_whatsapp_messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'waiting_media', 'waiting_association', 'complete', 'review', 'failed')),
  stage text NOT NULL DEFAULT 'received'
    CHECK (stage IN ('received', 'media', 'association', 'extraction', 'persistence')),
  attempts integer NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_product_extraction_job_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT mena_whatsapp_product_extraction_job_message_key UNIQUE (workspace_id, message_id)
);

CREATE INDEX mena_whatsapp_product_extraction_job_queue_idx
  ON public.mena_whatsapp_product_extraction_jobs (status, next_run_at, created_at);

CREATE TABLE public.mena_product_publication_jobs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  product_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('facebook', 'instagram')),
  account_id text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'published', 'failed', 'action_required')),
  attempts integer NOT NULL DEFAULT 0,
  post_id text REFERENCES public.mena_posts(id) ON DELETE SET NULL,
  permalink text,
  last_error text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_publication_job_id_workspace_key UNIQUE (workspace_id, id),
  CONSTRAINT mena_product_publication_job_request_product_channel_key
    UNIQUE (workspace_id, request_key, product_id, channel, account_id),
  CONSTRAINT mena_product_publication_job_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.mena_products(workspace_id, id)
    ON DELETE CASCADE
);

CREATE INDEX mena_product_publication_job_queue_idx
  ON public.mena_product_publication_jobs (status, next_run_at, created_at);
CREATE INDEX mena_product_publication_job_product_idx
  ON public.mena_product_publication_jobs (workspace_id, product_id, created_at);

ALTER TABLE public.mena_whatsapp_product_extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_product_publication_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_product_extraction_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_product_publication_jobs FROM anon, authenticated;
