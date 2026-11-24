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
import { AppState, Platform } from 'react-native';
import {
  markNetworkAvailable,
  markNetworkUnavailable,
} from '@/lib/network-status';
import { isFocusedAppState } from '@/lib/query-focus';
import { streamReconnectPlan } from '@/lib/posts-stream';
import { setPostsSyncListener } from '@/lib/posts-sync-signal';
import {
  STUDIO_STORAGE_KEY as STORAGE_KEY,
  legacyStudioStorageKey,
} from '@/lib/studio-storage-key';

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
  /** موعد النشر للمقالات المجدولة (ISO-8601)؛ null لغيرها. */
  scheduledAt?: string | null;
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
    scheduledAt: post.scheduledAt
      ? typeof post.scheduledAt === 'string'
        ? post.scheduledAt
        : new Date(post.scheduledAt).toISOString()
      : null,
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
  syncError: string | null;
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

/**
 * The starting state for a workspace-scoped key that has nothing cached yet,
 * carrying over the device-local preferences from the older user-scoped key.
 *
 * Only preferences travel. Posts and auto-publish settings belong to one
 * workspace: copying them into another workspace's key would put data in front of
 * the merchant that this workspace does not own, even if the sync that follows
 * immediately replaces it. The legacy key is left in place on purpose — the same
 * user's other workspaces carry their preferences from it too.
 */
async function carryOverPreferences(
  storageNamespace: string | null,
): Promise<StudioState> {
  const legacyKey = legacyStudioStorageKey(storageNamespace);
  if (!legacyKey) return defaults;
  try {
    const stored = await AsyncStorage.getItem(legacyKey);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored) as { preferences?: Partial<Preferences> } | null;
    const preferences = parsed?.preferences;
    if (!preferences || typeof preferences !== 'object') return defaults;
    return {
      ...defaults,
      preferences: { ...defaults.preferences, ...preferences },
    };
  } catch {
    return defaults;
  }
}

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
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const syncInFlightRef = useRef(false);
  const postsCursorRef = useRef<string | null>(null);
  const loadMoreInFlightRef = useRef(false);
  const serverPostIdsRef = useRef(new Set<string>());
  // Mirrored into state because a ref read during render does not re-render when
  // it changes: the "load more" affordance stayed whatever it was at the last
  // unrelated render.
  const [hasMorePosts, setHasMorePosts] = useState(false);

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
      if (!Array.isArray(page.items)) {
        throw new Error('POSTS_PAGE_RESPONSE_INVALID');
      }
      setSyncError(null);
      postsCursorRef.current =
        typeof page.nextCursor === 'string' ? page.nextCursor : null;
      setHasMorePosts(postsCursorRef.current !== null);
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
      markNetworkAvailable();
    } catch (error) {
      if (error instanceof TypeError) markNetworkUnavailable();
      console.warn('Unable to refresh posts from the server:', error);
      setSyncError(
        'تعذّرت مزامنة المنشورات مع الخادم. يمكنك متابعة المحتوى المحفوظ ثم إعادة المحاولة.',
      );
    } finally {
      syncInFlightRef.current = false;
      if (showProgress) setSyncing(false);
    }
  };

  // The effects below depend on the storage key or namespace, not on this
  // closure, so they call through a ref instead of re-subscribing every render.
  const syncRef = useRef(syncWithServer);
  syncRef.current = syncWithServer;

  useEffect(() => {
    postsCursorRef.current = null;
    setHasMorePosts(false);
    serverPostIdsRef.current.clear();
    if (!storageKey) {
      // Signed out, or signed in with the active workspace still unresolved.
      // `null` rather than the defaults: an empty post list renders as "this
      // workspace has no posts yet", which is a claim the app cannot make before
      // it knows which workspace it is looking at.
      stateRef.current = null;
      setState(null);
      return;
    }

    let active = true;
    AsyncStorage.getItem(storageKey)
      .then(async (stored) => {
        if (!active) return;
        const parsed: StudioState = stored
          ? JSON.parse(stored)
          : await carryOverPreferences(storageNamespace);
        stateRef.current = parsed;
        setState(parsed);
        if (!stored) {
          AsyncStorage.setItem(storageKey, JSON.stringify(parsed)).catch(() => {
            setStorageError('تعذر حفظ البيانات على هذا الجهاز.');
          });
        }
        // After loading local storage, sync with server
        void syncRef.current({ includeSettings: true });
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

  /**
   * Live post changes, on the platforms that can hold a streamed response open.
   *
   * Three responsibilities this effect did not have before:
   *
   * - **The reconnect schedule comes from `lib/posts-stream.ts`.** A fixed
   *   five-second timer with no ceiling retried a dead or refusing API twelve
   *   times a minute per open tab, forever, and every attempt passed through the
   *   `/api` rate limiter. Backoff now doubles to a one-minute ceiling, and a
   *   refusal a timer cannot fix (401/403, or any other 4xx) parks the stream
   *   instead of hammering it.
   * - **A backgrounded tab schedules nothing.** Nobody is watching it, so a
   *   reconnect timer there is pure load on the API; the stream reopens when the
   *   tab becomes visible again, which is also when its data is wanted. An already
   *   open connection is left alone — holding it costs nothing and it keeps
   *   delivering events.
   * - **The request opts out of the default deadline** (`timeoutMs: null`). The
   *   shared fetch layer now arms every request with a timeout, and the read
   *   deadline would close a healthy stream after twenty seconds — turning the
   *   reconnect policy into a poll of exactly the kind the stream exists to avoid.
   */
  useEffect(() => {
    if (!storageNamespace || typeof window === 'undefined' || typeof ReadableStream === 'undefined') return;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let parked = false;
    let waitingForFocus = false;
    let attempt = 0;
    let blurred = !isFocusedAppState(AppState.currentState);

    const resume = () => {
      if (stopped || (!parked && !waitingForFocus)) return;
      parked = false;
      waitingForFocus = false;
      attempt = 0;
      void connect();
    };

    const scheduleReconnect = (status: number | null) => {
      if (stopped) return;
      const plan = streamReconnectPlan({ status, attempt });
      if (plan.kind === 'stop') {
        parked = true;
        return;
      }
      if (blurred) {
        waitingForFocus = true;
        return;
      }
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, plan.delayMs);
    };

    const connect = async () => {
      parked = false;
      let status: number | null = null;
      try {
        const response = await fetchApiResponse('/api/posts/events', {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
          timeoutMs: null,
        });
        status = response.status;
        if (!response.ok || !response.body) {
          throw new Error(`Post change stream failed with status ${response.status}.`);
        }
        // An accepted connection resets the backoff: the next failure is the first
        // of a new streak rather than a continuation of the old one.
        attempt = 0;
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
              void syncRef.current();
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (!stopped && !controller.signal.aborted) {
          console.warn('Post change stream disconnected; reconnecting:', error);
        }
      }
      scheduleReconnect(status);
    };

    const onStatus = (status: string) => {
      const nowFocused = isFocusedAppState(status);
      blurred = !nowFocused;
      if (nowFocused) {
        resume();
        return;
      }
      // A timer armed while the tab was still visible would otherwise fire into a
      // background nobody is looking at; the reconnect waits for the return
      // instead. An open stream is left connected.
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        waitingForFocus = true;
      }
    };
    const onVisibilityChange = () => {
      onStatus(
        typeof document !== 'undefined' && document.visibilityState === 'visible'
          ? 'active'
          : 'background',
      );
    };
    const appStateSubscription = AppState.addEventListener('change', onStatus);
    const usesDocument = typeof document !== 'undefined';
    if (usesDocument) document.addEventListener('visibilitychange', onVisibilityChange);

    void connect();
    return () => {
      stopped = true;
      parked = false;
      waitingForFocus = false;
      appStateSubscription.remove();
      if (usesDocument) document.removeEventListener('visibilitychange', onVisibilityChange);
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [storageNamespace]);

  /**
   * Sync when the merchant comes back to the app.
   *
   * Posts are not in React Query, so neither the focus-manager wiring in
   * `lib/query-focus.ts` nor the refetch-on-return in the root layout reaches
   * them: a merchant who backgrounded the app for half an hour came back to
   * refreshed conversations, orders and products sitting above a post list from
   * before they left — and the dashboard hero and the header bell are both
   * computed from that list. This puts posts on the same footing, and reopens a
   * parked stream.
   *
   * On web both host signals are wired (AppState and `visibilitychange`); the
   * trigger is the transition, so the two agreeing costs one comparison.
   */
  useEffect(() => {
    if (!storageKey) return;
    let focused = isFocusedAppState(AppState.currentState);

    const onStatus = (status: string) => {
      const nowFocused = isFocusedAppState(status);
      // The event stream handles its own visibility (see the effect above); this
      // one is about the post list, which has no connection to reopen.
      if (nowFocused && !focused) {
        void syncRef.current({ includeSettings: true });
      }
      focused = nowFocused;
    };
    const onVisibilityChange = () => {
      onStatus(
        typeof document !== 'undefined' && document.visibilityState === 'visible'
          ? 'active'
          : 'background',
      );
    };

    const subscription = AppState.addEventListener('change', onStatus);
    const usesDocument = Platform.OS === 'web' && typeof document !== 'undefined';
    if (usesDocument) document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      subscription.remove();
      if (usesDocument) document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [storageKey]);

  /**
   * Let an arriving push alert refresh the post list.
   *
   * A `publish_failure` alert changes a post's status and its error, which is what
   * the dashboard hero ("a post failed to publish") and the bell's failed-post
   * count are built from; invalidating query keys cannot reach them. The layout
   * that installs the alert listeners sits above this provider, so the request
   * arrives through `lib/posts-sync-signal.ts`, and `lib/alert-invalidation.ts`
   * decides which events warrant it.
   */
  useEffect(() => {
    if (!storageKey) return;
    return setPostsSyncListener(() => {
      void syncRef.current();
    });
  }, [storageKey]);

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
      setHasMorePosts(postsCursorRef.current !== null);
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
    syncError,
    loadingMorePosts,
    hasMorePosts,
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
          ...(post.scheduledAt ? { scheduledAt: post.scheduledAt } : {}),
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
          // undefined = untouched; null = clear the due time on the server.
          scheduledAt: patch.scheduledAt,
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
