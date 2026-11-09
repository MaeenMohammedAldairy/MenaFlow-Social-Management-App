ALTER TABLE public.mena_products
  ADD COLUMN inventory_tracked boolean NOT NULL DEFAULT false,
  ADD COLUMN stock_on_hand integer NOT NULL DEFAULT 0,
  ADD COLUMN stock_reserved integer NOT NULL DEFAULT 0,
  ADD COLUMN low_stock_threshold integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT mena_products_inventory_check
    CHECK (
      stock_on_hand >= 0
      AND stock_reserved >= 0
      AND stock_reserved <= stock_on_hand
      AND low_stock_threshold >= 0
    );

CREATE TABLE public.mena_inventory_movements (
  id text PRIMARY KEY,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  order_id text,
  actor_id text NOT NULL,
  type text NOT NULL
    CHECK (type IN ('opening_balance', 'adjustment', 'reservation', 'release', 'shipment')),
  stock_delta integer NOT NULL DEFAULT 0,
  reserved_delta integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_inventory_movements_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.mena_products(workspace_id, id),
  CONSTRAINT mena_inventory_movements_delta_check
    CHECK (stock_delta <> 0 OR reserved_delta <> 0)
);

CREATE INDEX mena_inventory_movements_workspace_product_created_idx
  ON public.mena_inventory_movements (workspace_id, product_id, created_at);

ALTER TABLE public.mena_orders
  ADD COLUMN inventory_reserved boolean NOT NULL DEFAULT false,
  ADD COLUMN delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')),
  ADD COLUMN delivery_provider text,
  ADD COLUMN tracking_number text,
  ADD COLUMN delivery_fee numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (delivery_fee >= 0),
  ADD COLUMN collection_status text NOT NULL DEFAULT 'not_collected'
    CHECK (collection_status IN ('not_collected', 'collected', 'remitted')),
  ADD COLUMN collected_amount numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (collected_amount >= 0),
  ADD COLUMN delivered_at timestamptz;

CREATE TABLE public.mena_order_delivery_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL
    REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  actor_id text NOT NULL,
  from_status text
    CHECK (from_status IS NULL OR from_status IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')),
  to_status text NOT NULL
    CHECK (to_status IN ('pending', 'ready', 'picked_up', 'in_transit', 'delivered', 'failed', 'returned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_order_delivery_events_order_fk
    FOREIGN KEY (workspace_id, order_id)
    REFERENCES public.mena_orders(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX mena_order_delivery_events_workspace_order_created_idx
  ON public.mena_order_delivery_events (workspace_id, order_id, created_at);

ALTER TABLE public.mena_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_order_delivery_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_inventory_movements FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_order_delivery_events FROM anon, authenticated;
