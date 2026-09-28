/**
 * The signed-in account (if any). Accounts are optional: when the server has
 * no database, `enabled` is false and the app shows no sign-in links.
 */
import { useSyncExternalStore } from 'react';
import type { PublicUser } from '../../../shared/account';
import { getSocket } from '../game/socket';

interface AuthState {
  loaded: boolean;
  enabled: boolean;
  user: PublicUser | null;
}

let state: AuthState = { loaded: false, enabled: false, user: null };
const listeners = new Set<() => void>();

function set(next: AuthState) {
  const changedUser = next.user?.id !== state.user?.id;
  state = next;
  listeners.forEach((l) => l());
  // The game connection identifies the player when it connects, so reconnect after signing in or out.
  if (changedUser && next.loaded) {
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  }
}

export async function refreshAuth() {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    const data = (await res.json()) as { enabled: boolean; user: PublicUser | null };
    const first = !state.loaded;
    state = first ? { loaded: true, enabled: data.enabled, user: data.user } : state;
    if (first) listeners.forEach((l) => l());
    else set({ loaded: true, enabled: data.enabled, user: data.user });
  } catch {
    if (!state.loaded) set({ loaded: true, enabled: false, user: null });
  }
}

async function post(url: string, body: unknown): Promise<{ user?: PublicUser; error?: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? 'Something went wrong. Please try again.' };
    return data;
  } catch {
    return { error: "Couldn't reach the server. Check your connection." };
  }
}

/** Returns an error message, or null on success. */
export async function signUp(email: string, username: string, password: string): Promise<string | null> {
  const r = await post('/api/auth/signup', { email, username, password });
  if (r.user) set({ ...state, user: r.user });
  return r.error ?? null;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const r = await post('/api/auth/login', { email, password });
  if (r.user) set({ ...state, user: r.user });
  return r.error ?? null;
}

export async function signOut() {
  await post('/api/auth/logout', {});
  set({ ...state, user: null });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

void refreshAuth();
