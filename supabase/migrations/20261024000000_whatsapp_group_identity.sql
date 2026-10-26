CREATE UNIQUE INDEX IF NOT EXISTS mena_whatsapp_connections_workspace_instance_key
  ON public.mena_whatsapp_connections (workspace_id, instance_name);

CREATE TABLE public.mena_whatsapp_groups (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  owner_id text NOT NULL,
  instance_name text NOT NULL,
  kind text NOT NULL DEFAULT 'unknown',
  name text NOT NULL,
  parent_group_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_groups_kind_check
    CHECK (kind IN ('community', 'announcement', 'group', 'unknown')),
  CONSTRAINT mena_whatsapp_groups_connection_fk
    FOREIGN KEY (workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_connections (workspace_id, instance_name)
    ON DELETE RESTRICT,
  CONSTRAINT mena_whatsapp_groups_id_workspace_instance_key
    UNIQUE (id, workspace_id, instance_name),
  CONSTRAINT mena_whatsapp_groups_parent_fk
    FOREIGN KEY (parent_group_id, workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_groups (id, workspace_id, instance_name)
    ON DELETE RESTRICT,
  CONSTRAINT mena_whatsapp_groups_not_self_parent_check
    CHECK (parent_group_id IS NULL OR parent_group_id <> id)
);

CREATE INDEX mena_whatsapp_groups_workspace_instance_parent_idx
  ON public.mena_whatsapp_groups (workspace_id, instance_name, parent_group_id);

CREATE TABLE public.mena_whatsapp_group_jids (
  workspace_id text NOT NULL,
  instance_name text NOT NULL,
  group_jid text NOT NULL,
  group_id text NOT NULL,
  kind text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_group_jids_workspace_instance_jid_key
    PRIMARY KEY (workspace_id, instance_name, group_jid),
  CONSTRAINT mena_whatsapp_group_jids_kind_check
    CHECK (kind IN ('community', 'announcement', 'group', 'unknown')),
  CONSTRAINT mena_whatsapp_group_jids_group_fk
    FOREIGN KEY (group_id, workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_groups (id, workspace_id, instance_name)
    ON DELETE RESTRICT
);

CREATE INDEX mena_whatsapp_group_jids_group_idx
  ON public.mena_whatsapp_group_jids (workspace_id, instance_name, group_id);

CREATE TABLE public.mena_whatsapp_group_identity_migration_issues (
  source_table text NOT NULL,
  source_row_id text NOT NULL,
  workspace_id text,
  owner_id text,
  instance_name text,
  group_jid text,
  reason text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_group_identity_migration_issues_pkey
    PRIMARY KEY (source_table, source_row_id)
);

ALTER TABLE public.mena_whatsapp_group_selections
  ADD COLUMN group_id text;
ALTER TABLE public.mena_whatsapp_sync_states
  ADD COLUMN group_id text;
ALTER TABLE public.mena_whatsapp_messages
  ADD COLUMN group_id text;
ALTER TABLE public.mena_whatsapp_messages
  ADD COLUMN provider_remote_jid text;
ALTER TABLE public.mena_whatsapp_messages
  ADD COLUMN provider_remote_jid_alt text;
ALTER TABLE public.mena_whatsapp_message_media
  ADD COLUMN group_id text;

ALTER TABLE public.mena_whatsapp_group_selections
  ADD CONSTRAINT mena_whatsapp_group_selections_group_fk
  FOREIGN KEY (group_id, workspace_id, instance_name)
  REFERENCES public.mena_whatsapp_groups (id, workspace_id, instance_name)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.mena_whatsapp_sync_states
  ADD CONSTRAINT mena_whatsapp_sync_states_group_fk
  FOREIGN KEY (group_id, workspace_id, instance_name)
  REFERENCES public.mena_whatsapp_groups (id, workspace_id, instance_name)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.mena_whatsapp_messages
  ADD CONSTRAINT mena_whatsapp_messages_group_fk
  FOREIGN KEY (group_id, workspace_id, instance_name)
  REFERENCES public.mena_whatsapp_groups (id, workspace_id, instance_name)
  ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.mena_whatsapp_message_media
  ADD CONSTRAINT mena_whatsapp_message_media_group_fk
  FOREIGN KEY (group_id, workspace_id, instance_name)
  REFERENCES public.mena_whatsapp_groups (id, workspace_id, instance_name)
  ON DELETE RESTRICT NOT VALID;

CREATE UNIQUE INDEX mena_whatsapp_group_selections_workspace_instance_group_id_key
  ON public.mena_whatsapp_group_selections (workspace_id, instance_name, group_id);
CREATE UNIQUE INDEX mena_whatsapp_sync_states_workspace_instance_group_id_key
  ON public.mena_whatsapp_sync_states (workspace_id, instance_name, group_id);
CREATE UNIQUE INDEX mena_whatsapp_messages_owner_instance_group_id_remote_id_key
  ON public.mena_whatsapp_messages (owner_id, instance_name, group_id, remote_message_id);
CREATE UNIQUE INDEX mena_whatsapp_message_media_group_id_unique_key
  ON public.mena_whatsapp_message_media (
    owner_id, instance_name, group_id, message_id, media_index, media_type
  );

ALTER TABLE public.mena_whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_group_jids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_group_identity_migration_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mena_whatsapp_groups FROM anon, authenticated;
REVOKE ALL ON public.mena_whatsapp_group_jids FROM anon, authenticated;
REVOKE ALL ON public.mena_whatsapp_group_identity_migration_issues FROM anon, authenticated;
