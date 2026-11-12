CREATE TABLE public.mena_meta_order_intakes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  conversation_id text NOT NULL,
  actor_id text,
  status text NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'creating', 'created', 'cancelled')),
  awaiting_field text
    CHECK (
      awaiting_field IS NULL OR awaiting_field IN
        ('product', 'quantity', 'name', 'phone', 'address', 'delivery_time')
    ),
  product_id text,
  quantity integer CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 999),
  customer_name text,
  customer_phone text,
  delivery_address text,
  desired_delivery_time text,
  last_inbox_item_id text,
  draft_order_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_meta_order_intakes_conversation_key
    UNIQUE (workspace_id, platform, conversation_id)
);

CREATE INDEX mena_meta_order_intakes_workspace_status_idx
  ON public.mena_meta_order_intakes (workspace_id, status);

ALTER TABLE public.mena_meta_order_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_meta_order_intakes FROM anon, authenticated;
