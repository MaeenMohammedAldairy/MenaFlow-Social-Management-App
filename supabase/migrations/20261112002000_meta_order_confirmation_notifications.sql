ALTER TABLE public.mena_orders
  ADD COLUMN meta_confirmation_status text NOT NULL DEFAULT 'not_required'
    CHECK (meta_confirmation_status IN (
      'not_required',
      'queued',
      'processing',
      'sending',
      'sent',
      'manual_followup',
      'failed',
      'unknown'
    )),
  ADD COLUMN meta_confirmation_attempts integer NOT NULL DEFAULT 0
    CHECK (meta_confirmation_attempts >= 0),
  ADD COLUMN meta_confirmation_next_run_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN meta_confirmation_lease_expires_at timestamptz,
  ADD COLUMN meta_confirmation_sent_at timestamptz,
  ADD COLUMN meta_confirmation_error text;

CREATE INDEX mena_orders_meta_confirmation_queue_idx
  ON public.mena_orders (meta_confirmation_status, meta_confirmation_next_run_at)
  WHERE meta_confirmation_status IN ('queued', 'processing', 'sending');
