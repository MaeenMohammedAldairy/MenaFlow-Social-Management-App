-- One active WhatsApp phone owner across all workspaces.
--
-- The generated column gives every stored number one canonical digits-only
-- form; the partial unique index enforces ownership only for active
-- connections. Disconnected/failed rows are historical and may keep the number
-- for audit without blocking a legitimate re-pair elsewhere.
--
-- The guard below makes the migration fail loudly instead of creating a
-- half-applied ownership rule if an active duplicate ever appears before it.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mena_whatsapp_connections
    WHERE status IN ('connecting', 'connected')
      AND phone_number IS NOT NULL
    GROUP BY regexp_replace(
      regexp_replace(
        translate(phone_number, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
        '[^0-9]', '', 'g'
      ),
      '^00(?=[1-9])', '', 'g'
    )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Active duplicate WhatsApp phone numbers exist; resolve before applying the ownership constraint';
  END IF;
END $$;

ALTER TABLE public.mena_whatsapp_connections
  ADD COLUMN phone_digits text GENERATED ALWAYS AS (
    regexp_replace(
      regexp_replace(
        translate(coalesce(phone_number, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
        '[^0-9]', '', 'g'
      ),
      '^00(?=[1-9])', '', 'g'
    )
  ) STORED NOT NULL;

CREATE UNIQUE INDEX mena_whatsapp_connections_active_phone_key
  ON public.mena_whatsapp_connections USING btree (phone_digits)
  WHERE phone_digits <> ''
    AND status IN ('connecting', 'connected');
