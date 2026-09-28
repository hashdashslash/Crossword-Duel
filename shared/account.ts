/** Account rules shared by the browser and the server. */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

export interface PublicUser {
  id: string;
  username: string;
}

export function checkUsername(raw: unknown): string | null {
  const u = typeof raw === 'string' ? raw.trim() : '';
  if (u.length < USERNAME_MIN || u.length > USERNAME_MAX) return `Usernames are ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  if (!/^[A-Za-z0-9_]+$/.test(u)) return 'Usernames can use letters, numbers and underscores only.';
  return null;
}

export function checkEmail(raw: unknown): string | null {
  const e = typeof raw === 'string' ? raw.trim() : '';
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Please enter a valid email address.';
  return null;
}

export function checkPassword(raw: unknown): string | null {
  const p = typeof raw === 'string' ? raw : '';
  if (p.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (p.length > PASSWORD_MAX) return 'That password is too long.';
  return null;
}
