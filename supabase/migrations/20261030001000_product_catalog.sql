CREATE TABLE public.mena_products (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  sku text,
  name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text NOT NULL DEFAULT '',
  price numeric(12, 2),
  currency text,
  availability text NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('unknown', 'in_stock', 'out_of_stock', 'preorder')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_products_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT mena_products_price_check CHECK (price IS NULL OR price >= 0),
  CONSTRAINT mena_products_currency_check CHECK (
    currency IS NULL OR currency ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT mena_products_price_currency_check CHECK (
    price IS NULL OR currency IS NOT NULL
  )
);

CREATE UNIQUE INDEX mena_products_workspace_sku_key
  ON public.mena_products (workspace_id, sku)
  WHERE sku IS NOT NULL;
CREATE INDEX mena_products_workspace_status_updated_idx
  ON public.mena_products (workspace_id, status, updated_at);

CREATE TABLE public.mena_product_posts (
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  post_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_product_posts_workspace_product_post_key
    UNIQUE (workspace_id, product_id, post_id),
  CONSTRAINT mena_product_posts_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.mena_products(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mena_product_posts_post_fk
    FOREIGN KEY (workspace_id, post_id)
    REFERENCES public.mena_posts(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX mena_product_posts_workspace_post_idx
  ON public.mena_product_posts (workspace_id, post_id);

ALTER TABLE public.mena_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_product_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_products FROM anon, authenticated;
REVOKE ALL ON TABLE public.mena_product_posts FROM anon, authenticated;
