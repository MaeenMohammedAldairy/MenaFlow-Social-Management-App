UPDATE public.mena_whatsapp_auto_reply_events
SET status = 'unknown',
    error_code = 'DEPLOYMENT_QUEUE_MIGRATION',
    completed_at = COALESCE(completed_at, now())
WHERE status = 'processing';

ALTER TABLE public.mena_whatsapp_auto_reply_events
  ALTER COLUMN status SET DEFAULT 'queued',
  ADD COLUMN attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN next_run_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_expires_at timestamptz;

ALTER TABLE public.mena_whatsapp_auto_reply_events
  ADD CONSTRAINT mena_whatsapp_auto_reply_events_status_check
    CHECK (status IN ('queued', 'processing', 'sending', 'sent', 'failed', 'unknown')),
  ADD CONSTRAINT mena_whatsapp_auto_reply_events_attempts_check
    CHECK (attempts BETWEEN 0 AND 3);

CREATE INDEX mena_whatsapp_auto_reply_events_pending_idx
  ON public.mena_whatsapp_auto_reply_events (status, next_run_at);

CREATE INDEX mena_whatsapp_auto_reply_events_lease_idx
  ON public.mena_whatsapp_auto_reply_events (status, lease_expires_at);