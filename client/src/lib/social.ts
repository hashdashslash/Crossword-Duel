/**
 * Friends and game invites for the signed-in player, kept live over the game
 * connection: the server says "social:changed" and we fetch again.
 */
import { useSyncExternalStore } from 'react';
import type { FriendsList, GameInvite } from '../../../shared/friends';
import { getSocket } from '../game/socket';
import { tokenKey } from '../game/useGame';
import { navigate } from './router';
import { session } from './storage';

interface SocialState {
  friends: FriendsList;
  invites: GameInvite[];
  /** Invites that arrived while this tab was open and haven't been dismissed (shown as a popup). */
  fresh: GameInvite[];
  /** Set when a friend declines an invite to the game you're hosting. */
  declined: string | null;
  /** Friends you've invited, by game code. */
  sent: Record<string, string[]>;
}

const EMPTY: FriendsList = { friends: [], incoming: [], outgoing: [] };
let state: SocialState = { friends: EMPTY, invites: [], fresh: [], declined: null, sent: {} };
let signedIn = false;
let loadedInvites = false;
const listeners = new Set<() => void>();

function set(patch: Partial<SocialState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function applyFriends(friends: FriendsList) {
  set({ friends });
}

export async function refreshSocial() {
  if (!signedIn) return;
  try {
    const res = await fetch('/api/friends', { cache: 'no-store' });
    if (res.ok) set({ friends: await res.json() });
  } catch { /* offline; the next change refreshes */ }
  getSocket().emit('invite:list', (invites) => {
    const known = new Set(state.invites.map((i) => i.id));
    const added = loadedInvites ? invites.filter((i) => !known.has(i.id)) : [];
    const open = new Set(invites.map((i) => i.id));
    loadedInvites = true;
    set({ invites, fresh: [...state.fresh.filter((i) => open.has(i.id)), ...added] });
  });
}

/** Called by the auth store whenever the signed-in account changes. */
export function setSignedIn(on: boolean) {
  signedIn = on;
  loadedInvites = false;
  set({ friends: EMPTY, invites: [], fresh: [], declined: null, sent: {} });
  if (on) void refreshSocial();
}

export function dismissFresh(id: string) {
  set({ fresh: state.fresh.filter((i) => i.id !== id) });
}

export function clearDeclined() {
  set({ declined: null });
}

/** Accepts (joining the game) or declines an invite. Returns an error message, or null. */
export function respondToInvite(invite: GameInvite, accept: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    getSocket().emit('invite:respond', { id: invite.id, accept }, (res) => {
      set({ invites: state.invites.filter((i) => i.id !== invite.id), fresh: state.fresh.filter((i) => i.id !== invite.id) });
      if (!res.ok) return resolve(res.error);
      if (accept && res.code && res.token) {
        session.set(tokenKey(res.code), res.token);
        navigate(`/g/${res.code}`);
      }
      resolve(null);
    });
  });
}

/** Invites a friend to the game this tab is hosting (`code`). */
export function sendInvite(code: string, friendId: string): Promise<string | null> {
  return new Promise((resolve) => {
    getSocket().emit('invite:send', { friendId }, (res) => {
      if (res.ok) {
        const who = state.friends.friends.find((f) => f.id === friendId)?.username;
        set({ sent: { ...state.sent, [code]: [...(state.sent[code] ?? []), friendId] }, declined: state.declined === who ? null : state.declined });
      }
      resolve(res.ok ? null : res.error);
    });
  });
}

export function useSocial(): SocialState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}

/** Pending friend requests plus game invites, for the menu badge. */
export function useSocialBadge(): number {
  const s = useSocial();
  return s.friends.incoming.length + s.invites.length;
}

const socket = getSocket();
socket.on('social:changed', () => void refreshSocial());
socket.on('invite:declined', ({ username }) => {
  const id = state.friends.friends.find((f) => f.username === username)?.id;
  const sent = Object.fromEntries(Object.entries(state.sent).map(([code, ids]) => [code, ids.filter((x) => x !== id)]));
  set({ declined: username, sent });
});
// After a reconnect (sleeping phone, server restart), catch up on anything missed.
socket.on('connect', () => void refreshSocial());
