-- Persistent WhatsApp automation consent.
--
-- One row per workspace/customer. `opted_in_at` is non-null when the customer
-- re-subscribed; the row is kept for audit instead of being deleted. The unique
-- index is the hard guarantee against duplicate consent state.

CREATE TABLE public.mena_whatsapp_opt_outs (
  id text PRIMARY KEY NOT NULL,
  owner_id text NOT NULL,
  workspace_id text NOT NULL,
  customer_id text NOT NULL,
  opted_out_at timestamp with time zone NOT NULL,
  opted_in_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.mena_whatsapp_opt_outs
  ADD CONSTRAINT mena_whatsapp_opt_outs_workspace_id_mena_workspaces_id_fk
  FOREIGN KEY (workspace_id) REFERENCES public.mena_workspaces(id)
  ON DELETE restrict ON UPDATE no action;

CREATE UNIQUE INDEX mena_whatsapp_opt_outs_workspace_customer_key
  ON public.mena_whatsapp_opt_outs USING btree (workspace_id, customer_id);

CREATE INDEX mena_whatsapp_opt_outs_workspace_idx
  ON public.mena_whatsapp_opt_outs USING btree (workspace_id);

ALTER TABLE public.mena_whatsapp_opt_outs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.mena_whatsapp_opt_outs FROM anon, authenticated;
