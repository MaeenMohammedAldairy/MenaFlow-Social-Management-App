import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  createPost,
  fetchApiResponse,
  deletePost as apiDeletePost,
  getAutoPublishSettings,
  processWhatsAppBacklog,
  publishPostToChannels,
  saveAutoPublishSettings,
  updatePost,
  type AutoPublishSettings,
  type WhatsAppBacklogResult,
  type PostPublishResponse,
} from '@workspace/api-client-react';

export type Channel = 'instagram' | 'facebook' | 'whatsapp';
export type PostStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed';
type EditablePostStatus = 'draft' | 'review' | 'approved' | 'scheduled' | 'published';

function editableStatus(status: PostStatus): EditablePostStatus {
  if (status === 'publishing') return 'scheduled';
  if (status === 'failed') return 'review';
  return status;
}

function stableMediaUrl(mediaUrl: string): string {
  try {
    const url = new URL(mediaUrl);
    if (url.pathname.includes('/api/social/whatsapp/public-media/')) {
      url.searchParams.delete('expires');
      url.searchParams.delete('signature');
      return url.toString();
    }
  } catch {
    return mediaUrl;
  }
  return mediaUrl;
}

function postsHaveChanged(current: Post[], next: Post[]): boolean {
  if (current.length !== next.length) return true;
  return current.some((post, index) => {
    const nextPost = next[index];
    if (!nextPost) return true;
    return JSON.stringify({
      ...post,
      mediaUrls: post.mediaUrls?.map(stableMediaUrl),
      mediaPreviewUrls: post.mediaPreviewUrls?.map(stableMediaUrl),
    }) !== JSON.stringify({
      ...nextPost,
      mediaUrls: nextPost.mediaUrls?.map(stableMediaUrl),
      mediaPreviewUrls: nextPost.mediaPreviewUrls?.map(stableMediaUrl),
    });
  });
}

export interface Post {
  id: string;
  title: string;
  body: string;
  channels: Channel[];
  status: PostStatus;
  sourceType?: string;
  sourceMessageId?: string | null;
  sourceGroupJid?: string | null;
  sourceGroupName?: string | null;
  sourceMessageDate?: string | null;
  sourceText?: string | null;
  mediaUrls?: string[];
  mediaPreviewUrls?: string[];
  metadata?: Record<string, unknown>;
  autoPublish?: boolean;
  autoPublishChannels?: Channel[];
  publishResults?: Record<string, unknown>;
  error?: string | null;
  createdAt: string;
  updatedAt?: string;
}

function mapApiPost(post: Record<string, any>): Post {
  return {
    id: post.id,
    title: post.title,
    body: post.body,
    channels: (post.channels ?? []) as Channel[],
    status: (post.status ?? 'draft') as PostStatus,
    sourceType: typeof post.sourceType === 'string' ? post.sourceType : undefined,
    sourceMessageId: post.sourceMessageId ?? null,
    sourceGroupJid: post.sourceGroupJid ?? null,
    sourceGroupName: typeof post.sourceGroupName === 'string' ? post.sourceGroupName : null,
    sourceMessageDate: post.sourceMessageDate ?? null,
    sourceText: post.sourceText ?? null,
    mediaUrls: Array.isArray(post.mediaUrls) ? post.mediaUrls : [],
    mediaPreviewUrls: Array.isArray(post.mediaPreviewUrls) ? post.mediaPreviewUrls : [],
    metadata: post.metadata ?? {},
    autoPublish: Boolean(post.autoPublish),
    autoPublishChannels: Array.isArray(post.autoPublishChannels) ? post.autoPublishChannels as Channel[] : [],
    publishResults: post.publishResults ?? {},
    error: post.error ?? null,
    createdAt: typeof post.createdAt === 'string'
      ? post.createdAt
      : new Date(post.createdAt).toISOString(),
    updatedAt: post.updatedAt
      ? typeof post.updatedAt === 'string'
        ? post.updatedAt
        : new Date(post.updatedAt).toISOString()
      : undefined,
  };
}

export interface Preferences {
  inAppAlerts: boolean;
  reviewBeforePublishing: boolean;
}

interface StudioState {
  posts: Post[];
  preferences: Preferences;
  autoPublishSettings: AutoPublishSettings;
}

interface StudioContextValue extends StudioState {
  ready: boolean;
  syncing: boolean;
  loadingMorePosts: boolean;
  hasMorePosts: boolean;
  storageError: string | null;
  autoPublishSettings: AutoPublishSettings;
  addPost: (post: Omit<Post, 'id' | 'createdAt'>) => Promise<void>;
  updatePost: (id: string, patch: Partial<Omit<Post, 'id' | 'createdAt'>>) => Promise<void>;
  updatePostStatus: (id: string, status: PostStatus) => Promise<void>;
  publishPost: (id: string, channels?: Channel[], retryUncertain?: boolean) => Promise<PostPublishResponse>;
  updateAutoPublishSettings: (enabled: boolean, channels: Channel[]) => Promise<AutoPublishSettings>;
  analyzeWhatsAppBacklog: () => Promise<WhatsAppBacklogResult>;
  deletePost: (id: string) => Promise<void>;
  updatePreference: (key: keyof Preferences, value: boolean) => void;
  refreshPosts: () => Promise<void>;
  loadMorePosts: () => Promise<void>;
}

const STORAGE_KEY = 'menaflow.mobile.studio.v1';
const defaults: StudioState = {
  posts: [],
  preferences: {
    inAppAlerts: true,
    reviewBeforePublishing: true,
  },
  autoPublishSettings: {
    enabled: false,
    channels: ['facebook', 'instagram'],
    enabledAt: null,
  },
};

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({
  children,
  storageNamespace = 'local',
}: {
  children: React.ReactNode;
  storageNamespace?: string | null;
}) {
  const storageKey = storageNamespace === 'local'
    ? STORAGE_KEY
    : storageNamespace
      ? `${STORAGE_KEY}.${storageNamespace}`
      : null;
  const stateRef = useRef<StudioState | null>(null);
  const [state, setState] = useState<StudioState | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const syncInFlightRef = useRef(false);
  const postsCursorRef = useRef<string | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const serverPostIdsRef = useRef(new Set<string>());

  // Background checks stay silent and only update state when server data changes.
  const syncWithServer = async ({
    includeSettings = false,
    showProgress = false,
  }: {
    includeSettings?: boolean;
    showProgress?: boolean;
  } = {}) => {
    if (syncInFlightRef.current || !stateRef.current) return;
    syncInFlightRef.current = true;
    try {
      if (showProgress) setSyncing(true);
      const response = await fetchApiResponse('/api/posts/page?limit=20');
      if (!response.ok) throw new Error(`POSTS_PAGE_HTTP_${response.status}`);
      const page = await response.json() as { items?: unknown; nextCursor?: unknown };
      if (Array.isArray(page.items)) {
        postsCursorRef.current =
          typeof page.nextCursor === 'string' ? page.nextCursor : null;
        const mapped = page.items.map((post) => mapApiPost(post as Record<string, any>));

        const current = stateRef.current;
        const serverIds = new Set(mapped.map((post) => post.id));
        for (const id of serverIds) serverPostIdsRef.current.add(id);
        const previouslyLoadedFromServer = current.posts.filter(
          (post) =>
            serverPostIdsRef.current.has(post.id) && !serverIds.has(post.id),
        );
        const nextPosts = [...mapped, ...previouslyLoadedFromServer];
        if (postsHaveChanged(current.posts, nextPosts)) {
          commit((latest) => ({ ...latest, posts: nextPosts }));
        }
      }
      if (includeSettings) {
        try {
          const settings = await getAutoPublishSettings();
          if (JSON.stringify(stateRef.current?.autoPublishSettings) !== JSON.stringify(settings)) {
            commit((current) => ({ ...current, autoPublishSettings: settings }));
          }
        } catch (error) {
          console.warn('Unable to refresh auto-publish settings:', error);
        }
      }
    } catch (error) {
      console.warn('Unable to refresh posts from the server:', error);
    } finally {
      syncInFlightRef.current = false;
      if (showProgress) setSyncing(false);
    }
  };

  useEffect(() => {
    postsCursorRef.current = null;
    serverPostIdsRef.current.clear();
    if (!storageKey) {
      stateRef.current = defaults;
      setState(defaults);
      return;
    }

    let active = true;
    AsyncStorage.getItem(storageKey)
      .then((stored) => {
        if (!active) return;
        const parsed: StudioState = stored ? JSON.parse(stored) : defaults;
        stateRef.current = parsed;
        setState(parsed);
        if (!stored) {
          AsyncStorage.setItem(storageKey, JSON.stringify(parsed)).catch(() => {
            setStorageError('تعذر حفظ البيانات على هذا الجهاز.');
          });
        }
        // After loading local storage, sync with server
        void syncWithServer({ includeSettings: true });
      })
      .catch(() => {
        if (active) {
          setStorageError('تعذر تحميل بيانات مساحة العمل. أعد تشغيل التطبيق للمحاولة مرة أخرى.');
        }
      });
    return () => {
      active = false;
    };
  }, [storageKey]);

  useEffect(() => {
    if (!storageNamespace || typeof window === 'undefined' || typeof ReadableStream === 'undefined') return;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = async () => {
      try {
        const response = await fetchApiResponse('/api/posts/events', {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        });
        if (!response.ok || !response.body) {
          throw new Error(`Post change stream failed with status ${response.status}.`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (event.split(/\r?\n/).some((line) => line === 'event: posts_changed')) {
              void syncWithServer();
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (!stopped && !controller.signal.aborted) {
          console.warn('Post change stream disconnected; reconnecting:', error);
        }
      }
      if (!stopped) reconnectTimer = setTimeout(() => void connect(), 5_000);
    };

    void connect();
    return () => {
      stopped = true;
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [storageNamespace]);

  const commit = (change: (current: StudioState) => StudioState) => {
    const current = stateRef.current;
    if (!current) return;
    const next = change(current);
    stateRef.current = next;
    setState(next);
    if (storageKey) {
      AsyncStorage.setItem(storageKey, JSON.stringify(next)).catch(() => {
        setStorageError('تعذر حفظ التغيير. تحقق من مساحة التخزين وأعد المحاولة.');
      });
    }
  };

  const loadMorePosts = async () => {
    const cursor = postsCursorRef.current;
    if (!cursor || loadMoreInFlightRef.current || !stateRef.current) return;
    loadMoreInFlightRef.current = true;
    setLoadingMorePosts(true);
    try {
      const response = await fetchApiResponse(
        `/api/posts/page?limit=20&cursor=${encodeURIComponent(cursor)}`,
      );
      if (!response.ok) throw new Error(`POSTS_PAGE_HTTP_${response.status}`);
      const page = await response.json() as { items?: unknown; nextCursor?: unknown };
      if (!Array.isArray(page.items)) throw new Error('POSTS_PAGE_RESPONSE_INVALID');
      const morePosts = page.items.map((post) => mapApiPost(post as Record<string, any>));
      postsCursorRef.current =
        typeof page.nextCursor === 'string' ? page.nextCursor : null;
      for (const post of morePosts) {
        serverPostIdsRef.current.add(post.id);
      }
      const currentIds = new Set(stateRef.current.posts.map((post) => post.id));
      const newPosts = morePosts.filter((post) => !currentIds.has(post.id));
      commit((current) => ({ ...current, posts: [...current.posts, ...newPosts] }));
    } finally {
      loadMoreInFlightRef.current = false;
      setLoadingMorePosts(false);
    }
  };

  const value: StudioContextValue = {
    posts: state?.posts ?? [],
    preferences: state?.preferences ?? defaults.preferences,
    ready: state !== null && storageError === null,
    syncing,
    loadingMorePosts,
    hasMorePosts: postsCursorRef.current !== null,
    storageError,
    autoPublishSettings: state?.autoPublishSettings ?? defaults.autoPublishSettings,
    refreshPosts: () =>
      syncWithServer({ includeSettings: true, showProgress: true }),
    loadMorePosts,
    addPost: async (post) => {
      const newPostId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const createdAt = new Date().toISOString();
      const localPost: Post = {
        ...post,
        id: newPostId,
        createdAt,
      };

      commit((current) => ({
        ...current,
        posts: [localPost, ...current.posts],
      }));

      // Persist to server — rollback on failure
      try {
        const createStatus = editableStatus(post.status);
        const saved = await createPost({
          id: newPostId,
          title: post.title,
          body: post.body,
          channels: post.channels,
          status: createStatus === 'approved' ? 'review' : createStatus,
          metadata: post.metadata,
          mediaUrls: post.mediaUrls,
        });
        if (saved && saved.id) {
          commit((current) => ({
            ...current,
            posts: current.posts.map((p) =>
              p.id === newPostId
                ? {
                    ...p,
                    id: saved.id,
                    createdAt: typeof saved.createdAt === 'string' ? saved.createdAt : new Date(saved.createdAt).toISOString(),
                    mediaUrls: saved.mediaUrls ?? p.mediaUrls ?? [],
                    mediaPreviewUrls: saved.mediaPreviewUrls ?? p.mediaPreviewUrls ?? [],
                  }
                : p
            ),
          }));
        }
      } catch (error) {
        // Rollback: remove the optimistic post so the UI doesn't show phantom data
        commit((current) => ({
          ...current,
          posts: current.posts.filter((p) => p.id !== newPostId),
        }));
        throw error; // let the caller show a user-facing error
      }
    },
    updatePost: async (id, patch) => {
      // Snapshot previous state for rollback
      let previous: Post | undefined;
      commit((current) => {
        previous = current.posts.find((p) => p.id === id);
        return {
          ...current,
          posts: current.posts.map((post) => (post.id === id ? { ...post, ...patch } : post)),
        };
      });

      try {
        const updateBody = {
          title: patch.title,
          body: patch.body,
          channels: patch.channels,
          status: patch.status === undefined ? undefined : editableStatus(patch.status),
        };
        if (patch.mediaUrls !== undefined) {
          const response = await fetchApiResponse(`/api/posts/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...updateBody, mediaUrls: patch.mediaUrls }),
          });
          if (!response.ok) throw new Error(`POST_UPDATE_HTTP_${response.status}`);
        } else {
          await updatePost(id, updateBody);
        }
      } catch (error) {
        // Rollback to previous post state
        if (previous !== undefined) {
          const snap = previous;
          commit((current) => ({
            ...current,
            posts: current.posts.map((p) => (p.id === id ? snap : p)),
          }));
        }
        throw error;
      }
    },
    updatePostStatus: async (id, status) => {
      let previousStatus: PostStatus | undefined;
      commit((current) => {
        const found = current.posts.find((p) => p.id === id);
        previousStatus = found?.status;
        return {
          ...current,
          posts: current.posts.map((post) => (post.id === id ? { ...post, status } : post)),
        };
      });

      try {
        await updatePost(id, { status: editableStatus(status) });
      } catch (error) {
        // Rollback status to what it was before the optimistic update
        if (previousStatus !== undefined) {
          const prev = previousStatus;
          commit((current) => ({
            ...current,
            posts: current.posts.map((post) =>
              post.id === id ? { ...post, status: prev } : post
            ),
          }));
        }
        throw error;
      }
    },
    publishPost: async (id, channels, retryUncertain) => {
      const selectedChannels = (channels ?? []).filter(
        (channel): channel is 'facebook' | 'instagram' =>
          channel === 'facebook' || channel === 'instagram',
      );
      const payload = await publishPostToChannels(id, selectedChannels, retryUncertain);
      commit((current) => ({
        ...current,
        posts: current.posts.map((post) =>
          post.id === id
            ? {
                ...post,
                status: payload.post.status as PostStatus,
                publishResults: payload.results,
                error: payload.post.error,
                updatedAt: new Date().toISOString(),
                channels: payload.post.channels.filter(
                  (channel): channel is Channel =>
                    channel === "facebook" ||
                    channel === "instagram" ||
                    channel === "whatsapp",
                ),
              }
            : post,
        ),
      }));
      return payload;
    },
    updateAutoPublishSettings: async (enabled, channels) => {
      const validChannels = channels.filter(
        (channel): channel is 'facebook' | 'instagram' =>
          channel === 'facebook' || channel === 'instagram',
      );
      const saved = await saveAutoPublishSettings({ enabled, channels: validChannels });
      commit((current) => ({ ...current, autoPublishSettings: saved }));
      return saved;
    },
    analyzeWhatsAppBacklog: async () => {
      const result = await processWhatsAppBacklog(50);
      await syncWithServer();
      return result;
    },
    deletePost: async (id) => {
      let deletedPost: Post | undefined;
      commit((current) => {
        deletedPost = current.posts.find((p) => p.id === id);
        return {
          ...current,
          posts: current.posts.filter((post) => post.id !== id),
        };
      });

      try {
        await apiDeletePost(id);
      } catch (error) {
        // Rollback: restore the post that failed to delete on the server
        if (deletedPost !== undefined) {
          const restored = deletedPost;
          commit((current) => ({
            ...current,
            posts: [restored, ...current.posts.filter((p) => p.id !== id)],
          }));
        }
        throw error;
      }
    },
    updatePreference: (key, preference) =>
      commit((current) => ({
        ...current,
        preferences: { ...current.preferences, [key]: preference },
      })),
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be used inside StudioProvider');
  return context;
}
