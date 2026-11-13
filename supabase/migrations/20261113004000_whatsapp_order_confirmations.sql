ALTER TABLE public.mena_orders
  ADD COLUMN whatsapp_confirmation_status text NOT NULL DEFAULT 'not_required'
    CHECK (whatsapp_confirmation_status IN ('not_required', 'queued', 'processing', 'sending', 'sent', 'failed', 'unknown', 'manual_followup')),
  ADD COLUMN whatsapp_confirmation_attempts integer NOT NULL DEFAULT 0
    CHECK (whatsapp_confirmation_attempts BETWEEN 0 AND 3),
  ADD COLUMN whatsapp_confirmation_next_run_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN whatsapp_confirmation_lease_expires_at timestamptz,
  ADD COLUMN whatsapp_confirmation_sent_at timestamptz,
  ADD COLUMN whatsapp_confirmation_error text;

CREATE INDEX mena_orders_whatsapp_confirmation_queue_idx
  ON public.mena_orders (whatsapp_confirmation_status, whatsapp_confirmation_next_run_at)
  WHERE whatsapp_confirmation_status IN ('queued', 'processing', 'sending');