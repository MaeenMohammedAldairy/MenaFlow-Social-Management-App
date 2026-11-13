ALTER TABLE public.mena_orders
  ADD COLUMN source_whatsapp_instance_name text;

ALTER TABLE public.mena_orders
  DROP CONSTRAINT mena_orders_source_platform_check;

ALTER TABLE public.mena_orders
  ADD CONSTRAINT mena_orders_source_platform_check
    CHECK (source_platform IS NULL OR source_platform IN ('facebook', 'instagram', 'whatsapp')),
  ADD CONSTRAINT mena_orders_whatsapp_source_check
    CHECK (
      source_platform <> 'whatsapp'
      OR (
        source_conversation_id IS NOT NULL
        AND source_whatsapp_instance_name IS NOT NULL
        AND source_meta_inbox_item_id IS NULL
      )
    );

CREATE TABLE public.mena_whatsapp_order_intakes (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  remote_jid_hash text NOT NULL CHECK (remote_jid_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'collecting'
    CHECK (status IN ('collecting', 'creating', 'created', 'cancelled')),
  awaiting_field text
    CHECK (awaiting_field IS NULL OR awaiting_field IN ('product', 'quantity', 'name', 'phone', 'address')),
  product_id text,
  quantity integer CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 999),
  encrypted_customer_data text NOT NULL,
  client_request_id text NOT NULL,
  last_provider_message_id text,
  draft_order_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_order_intakes_connection_fk
    FOREIGN KEY (workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_connections (workspace_id, instance_name)
    ON DELETE CASCADE,
  CONSTRAINT mena_whatsapp_order_intakes_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.mena_products (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX mena_whatsapp_order_intakes_conversation_key
  ON public.mena_whatsapp_order_intakes (workspace_id, instance_name, remote_jid_hash);

CREATE INDEX mena_whatsapp_order_intakes_workspace_status_idx
  ON public.mena_whatsapp_order_intakes (workspace_id, status);

CREATE INDEX mena_whatsapp_order_intakes_expiry_idx
  ON public.mena_whatsapp_order_intakes (expires_at);

ALTER TABLE public.mena_whatsapp_order_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_order_intakes FROM anon, authenticated;