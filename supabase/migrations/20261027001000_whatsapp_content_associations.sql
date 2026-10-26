ALTER TABLE public.mena_whatsapp_messages
  ADD COLUMN media_group_source text,
  ADD CONSTRAINT mena_whatsapp_messages_media_group_source_check
    CHECK (
      media_group_source IS NULL OR
      media_group_source IN ('protocol_association', 'provider_album_container')
    );

CREATE TABLE public.mena_whatsapp_content_associations (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES public.mena_workspaces(id) ON DELETE RESTRICT,
  instance_name text NOT NULL,
  group_id text NOT NULL,
  left_message_id text NOT NULL REFERENCES public.mena_whatsapp_messages(id) ON DELETE RESTRICT,
  right_message_id text NOT NULL REFERENCES public.mena_whatsapp_messages(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  content_bundle_id text,
  decided_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mena_whatsapp_content_associations_pair_order_check
    CHECK (left_message_id < right_message_id),
  CONSTRAINT mena_whatsapp_content_associations_bundle_decision_check
    CHECK (
      (decision = 'accepted' AND content_bundle_id IS NOT NULL) OR
      (decision = 'rejected' AND content_bundle_id IS NULL)
    ),
  CONSTRAINT mena_whatsapp_content_associations_pair_key
    UNIQUE (workspace_id, instance_name, group_id, left_message_id, right_message_id),
  CONSTRAINT mena_whatsapp_content_associations_group_fk
    FOREIGN KEY (group_id, workspace_id, instance_name)
    REFERENCES public.mena_whatsapp_groups(id, workspace_id, instance_name)
    ON DELETE RESTRICT
);

CREATE INDEX mena_whatsapp_content_associations_bundle_idx
  ON public.mena_whatsapp_content_associations
  (workspace_id, instance_name, group_id, content_bundle_id);

ALTER TABLE public.mena_whatsapp_content_associations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mena_whatsapp_content_associations FROM anon, authenticated;
