'use client';

import type { PublicUser } from '@orbit/shared';
import { create } from 'zustand';
import { ApiError, api, setAccessToken } from './api';

/**
 * Authentication state.
 *
 * Deliberately small: the signed-in user and a hydration flag. The token itself
 * lives in the api module's closure, not here, so it never lands in a
 * serialisable store that could be persisted by accident.
 */
interface AuthState {
  user: PublicUser | null;
  /** False until the initial refresh attempt has settled. */
  ready: boolean;
  busy: boolean;

  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: PublicUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  busy: false,

  /**
   * Restores a session on first load by exchanging the httpOnly refresh cookie
   * for an access token. Failure is normal — it just means nobody is signed in.
   */
  async hydrate() {
    try {
      const token = await api.auth.refresh();
      if (!token) {
        set({ user: null, ready: true });
        return;
      }
      const { user } = await api.auth.me();
      set({ user, ready: true });
    } catch {
      setAccessToken(null);
      set({ user: null, ready: true });
    }
  },

  async login(email, password) {
    set({ busy: true });
    try {
      const result = await api.auth.login({ email, password });
      setAccessToken(result.accessToken);
      set({ user: result.user, ready: true });
    } finally {
      set({ busy: false });
    }
  },

  async register(name, email, password) {
    set({ busy: true });
    try {
      const result = await api.auth.register({ name, email, password });
      setAccessToken(result.accessToken);
      set({ user: result.user, ready: true });
    } finally {
      set({ busy: false });
    }
  },

  async logout() {
    try {
      await api.auth.logout();
    } catch (error) {
      // A failed logout call must still clear local state.
      if (!(error instanceof ApiError)) throw error;
    } finally {
      setAccessToken(null);
      set({ user: null });
    }
  },

  setUser(user) {
    set({ user });
  },
}));
