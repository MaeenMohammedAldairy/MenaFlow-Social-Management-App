ALTER TABLE public.mena_meta_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_group_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_message_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_whatsapp_sync_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_content_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_post_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mena_workspaces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.mena_meta_connections,
  public.mena_oauth_states,
  public.mena_whatsapp_connections,
  public.mena_whatsapp_group_selections,
  public.mena_whatsapp_message_media,
  public.mena_whatsapp_messages,
  public.mena_whatsapp_sync_states,
  public.mena_content_jobs,
  public.mena_content_settings,
  public.mena_post_activity_events,
  public.mena_posts,
  public.mena_workspace_members,
  public.mena_workspaces
FROM anon, authenticated;
