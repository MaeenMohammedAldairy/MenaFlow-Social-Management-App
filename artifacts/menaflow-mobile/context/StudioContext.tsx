import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

export type Channel = 'instagram' | 'facebook' | 'whatsapp';
export type PostStatus = 'draft' | 'review' | 'scheduled' | 'published';

export interface Post {
  id: string;
  title: string;
  body: string;
  channels: Channel[];
  status: PostStatus;
  createdAt: string;
}

export interface Preferences {
  inAppAlerts: boolean;
  reviewBeforePublishing: boolean;
}

interface StudioState {
  posts: Post[];
  preferences: Preferences;
}

interface StudioContextValue extends StudioState {
  ready: boolean;
  storageError: string | null;
  addPost: (post: Omit<Post, 'id' | 'createdAt'>) => void;
  updatePostStatus: (id: string, status: PostStatus) => void;
  deletePost: (id: string) => void;
  updatePreference: (key: keyof Preferences, value: boolean) => void;
}

const STORAGE_KEY = 'menaflow.mobile.studio.v1';
const defaults: StudioState = {
  posts: [],
  preferences: {
    inAppAlerts: true,
    reviewBeforePublishing: true,
  },
};

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const stateRef = useRef<StudioState | null>(null);
  const [state, setState] = useState<StudioState | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!active) return;
        const parsed: StudioState = stored ? JSON.parse(stored) : defaults;
        stateRef.current = parsed;
        setState(parsed);
        if (!stored) {
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)).catch(() => {
            if (active) setStorageError('تعذر حفظ البيانات على هذا الجهاز.');
          });
        }
      })
      .catch(() => {
        if (active) setStorageError('تعذر تحميل بيانات مساحة العمل. أعد تشغيل التطبيق للمحاولة مرة أخرى.');
      });
    return () => {
      active = false;
    };
  }, []);

  const commit = (change: (current: StudioState) => StudioState) => {
    const current = stateRef.current;
    if (!current) return;
    const next = change(current);
    stateRef.current = next;
    setState(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
      setStorageError('تعذر حفظ التغيير. تحقق من مساحة التخزين وأعد المحاولة.');
    });
  };

  const value: StudioContextValue = {
    posts: state?.posts ?? [],
    preferences: state?.preferences ?? defaults.preferences,
    ready: state !== null && storageError === null,
    storageError,
    addPost: (post) =>
      commit((current) => ({
        ...current,
        posts: [
          {
            ...post,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
          },
          ...current.posts,
        ],
      })),
    updatePostStatus: (id, status) =>
      commit((current) => ({
        ...current,
        posts: current.posts.map((post) => (post.id === id ? { ...post, status } : post)),
      })),
    deletePost: (id) =>
      commit((current) => ({
        ...current,
        posts: current.posts.filter((post) => post.id !== id),
      })),
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
