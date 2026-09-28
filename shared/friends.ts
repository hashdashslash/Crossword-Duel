/** Friends and direct invites (signed-in players only). */
import type { PublicUser } from './account.js';
import type { Difficulty, Theme, TimerMode } from './config.js';

export interface FriendsList {
  friends: PublicUser[];
  /** Requests waiting for you to accept or decline. */
  incoming: PublicUser[];
  /** Requests you sent that haven't been answered. */
  outgoing: PublicUser[];
}

/** An invite to a friend's game, shown in-app until accepted, declined or expired. */
export interface GameInvite {
  id: string;
  code: string;
  from: PublicUser;
  difficulty: Difficulty;
  theme: Theme;
  timerMode: TimerMode;
  /** Server time (ms) when the invite expires. */
  expiresAt: number;
}

/** Invites expire after this long, or sooner if the host leaves or someone else takes the seat. */
export const INVITE_TTL_MS = 15 * 60_000;
