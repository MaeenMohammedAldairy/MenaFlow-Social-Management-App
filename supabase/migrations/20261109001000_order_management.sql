CREATE TABLE public.mena_orders (
  id text PRIMARY KEY,
  order_number text NOT NULL,
  owner_id text NOT NULL,
  client_request_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  customer_name text NOT NULL,
  customer_phone text,
  delivery_address text,
  notes text NOT NULL DEFAULT '',
  source_meta_inbox_item_id text,
  source_platform text
    CHECK (source_platform IS NULL OR source_platform IN ('facebook', 'instagram')),
  source_conversation_id text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total numeric(12, 2) NOT NULL CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_orders_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT mena_orders_workspace_number_key UNIQUE (workspace_id, order_number),
  CONSTRAINT mena_orders_workspace_request_key UNIQUE (workspace_id, client_request_id)
);

CREATE INDEX mena_orders_workspace_status_created_idx
  ON public.mena_orders (workspace_id, status, created_at DESC);

CREATE TABLE public.mena_order_items (
  id text PRIMARY KEY,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  product_id text,
  product_name text NOT NULL,
  product_sku text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_order_items_order_fk
    FOREIGN KEY (workspace_id, order_id)
    REFERENCES public.mena_orders(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mena_order_items_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.mena_products(workspace_id, id)
);

CREATE INDEX mena_order_items_workspace_order_idx
  ON public.mena_order_items (workspace_id, order_id);

CREATE TABLE public.mena_order_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  actor_id text NOT NULL,
  from_status text
    CHECK (from_status IS NULL OR from_status IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')),
  to_status text NOT NULL
    CHECK (to_status IN ('draft', 'confirmed', 'preparing', 'shipped', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_order_events_order_fk
    FOREIGN KEY (workspace_id, order_id)
    REFERENCES public.mena_orders(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX mena_order_events_workspace_order_created_idx
  ON public.mena_order_events (workspace_id, order_id, created_at);

ALTER TABLE public.mena_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_orders FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_order_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_order_events FROM anon, authenticated;
