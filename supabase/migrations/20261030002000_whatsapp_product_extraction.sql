CREATE TABLE public.mena_product_extraction_suggestions (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  classification text NOT NULL DEFAULT 'product'
    CHECK (classification IN ('product', 'not_product')),
  extracted_data jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_model text NOT NULL,
  status text NOT NULL DEFAULT 'review'
    CHECK (status IN ('review', 'draft_created', 'possible_duplicate', 'dismissed')),
  field_review jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  product_id text REFERENCES public.mena_products(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_extraction_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT mena_product_extraction_workspace_source_key UNIQUE (workspace_id, source_key)
);

CREATE INDEX mena_product_extraction_workspace_status_created_idx
  ON public.mena_product_extraction_suggestions (workspace_id, status, created_at);

CREATE TABLE public.mena_product_extraction_sources (
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  suggestion_id text,
  message_id text NOT NULL REFERENCES public.mena_whatsapp_messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_extraction_source_workspace_message_key
    UNIQUE (workspace_id, message_id),
  CONSTRAINT mena_product_extraction_source_suggestion_fk
    FOREIGN KEY (workspace_id, suggestion_id)
    REFERENCES public.mena_product_extraction_suggestions(workspace_id, id)
    ON DELETE CASCADE
);

CREATE INDEX mena_product_extraction_source_suggestion_idx
  ON public.mena_product_extraction_sources (workspace_id, suggestion_id);

ALTER TABLE public.mena_product_extraction_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_product_extraction_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_product_extraction_suggestions FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_product_extraction_sources FROM anon, authenticated;
