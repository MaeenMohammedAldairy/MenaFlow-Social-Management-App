-- ============================================================================
-- WhatsApp connections: scope the tenant key by workspace, not by user alone.
--
-- `mena_whatsapp_connections.owner_id` was declared UNIQUE in the initial
-- schema, when one user meant one tenant. The product now supports several
-- workspaces per user, and `mena_whatsapp_connections_workspace_key` (UNIQUE on
-- workspace_id) is the real key. The surviving owner_id uniqueness means a
-- merchant with two workspaces cannot connect WhatsApp in the second one: the
-- INSERT in `POST /social/whatsapp/connect` conflicts on owner_id while its
-- ON CONFLICT target is workspace_id, so PostgreSQL raises instead of upserting
-- and the route answers 500.
--
-- Meta had the same defect and was fixed in 20261101001000. This is the
-- WhatsApp half. `owner_id` is kept — it is still written and still used as a
-- tenant-equality filter — but uniqueness now spans (owner_id, workspace_id),
-- which is exactly one row per user per workspace.
-- ============================================================================

-- Pre-flight: the new key must already hold, or the migration would silently
-- merge rows that belong to different tenants.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mena_whatsapp_connections
    GROUP BY owner_id, workspace_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'mena_whatsapp_connections holds more than one row per (owner_id, workspace_id); resolve before migrating';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.mena_whatsapp_group_selections
    WHERE group_jid IS NOT NULL
    GROUP BY workspace_id, instance_name, group_jid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'mena_whatsapp_group_selections holds more than one row per (workspace_id, instance_name, group_jid); resolve before migrating';
  END IF;
END $$;

-- Order matters. The single-column foreign key on group selections depends on
-- the unique constraint being dropped, so it has to go first — PostgreSQL
-- answers 2BP01 "cannot drop constraint ... because other objects depend on it"
-- otherwise, and the migration rolls back.
--
-- The legacy key is dropped by lookup, not by the name the initial migration
-- declared: PostgreSQL truncates identifiers to 63 bytes, so
-- "mena_whatsapp_group_selections_owner_id_mena_whatsapp_connections_owner_id_fk"
-- (78 bytes) actually exists as
-- "mena_whatsapp_group_selections_owner_id_mena_whatsapp_connectio" — a DROP
-- CONSTRAINT naming the full string fails with "does not exist".
DO $$
DECLARE
  legacy_fk text;
BEGIN
  SELECT conname
    INTO legacy_fk
    FROM pg_constraint
   WHERE conrelid = 'public.mena_whatsapp_group_selections'::regclass
     AND contype = 'f'
     AND pg_get_constraintdef(oid) LIKE '%mena_whatsapp_connections(owner_id)%';
  IF legacy_fk IS NULL THEN
    RAISE EXCEPTION
      'expected the single-column owner_id foreign key on mena_whatsapp_group_selections; found none';
  END IF;
  EXECUTE format(
    'ALTER TABLE public.mena_whatsapp_group_selections DROP CONSTRAINT %I',
    legacy_fk
  );
END $$;

ALTER TABLE public.mena_whatsapp_connections
  DROP CONSTRAINT "mena_whatsapp_connections_owner_id_unique";

CREATE UNIQUE INDEX "mena_whatsapp_connections_owner_workspace_key"
  ON public."mena_whatsapp_connections" USING btree ("owner_id", "workspace_id");

-- Point group selections at the composite key so a deleted connection still
-- takes its selections with it.
ALTER TABLE public.mena_whatsapp_group_selections
  ADD CONSTRAINT "mena_whatsapp_group_selections_connection_fk"
  FOREIGN KEY ("owner_id", "workspace_id")
  REFERENCES "public"."mena_whatsapp_connections" ("owner_id", "workspace_id")
  ON DELETE cascade ON UPDATE no action;

-- A group is selected once per workspace+instance, not once per user. The old
-- key made the same group in a second workspace of the same user collide.
--
-- Schema-qualified like every statement here, and with the schema *outside* the
-- quotes: `"public.foo"` is one identifier named `public.foo`, which never
-- matches. A migration runner may also connect with a search_path that omits
-- `public`, so an unqualified DROP INDEX fails with 42704 even though
-- pg_indexes shows the index.
DROP INDEX public."mena_whatsapp_group_selections_owner_id_group_jid_key";

CREATE UNIQUE INDEX "mena_whatsapp_group_selections_workspace_instance_group_jid_key"
  ON public."mena_whatsapp_group_selections"
  USING btree ("workspace_id", "instance_name", "group_jid");
