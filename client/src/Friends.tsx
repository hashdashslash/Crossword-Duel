/** Friends: add by username, answer requests, and invite a friend to a new game. */
import { useState } from 'react';
import type { PublicUser } from '../../shared/account';
import type { Difficulty } from '../../shared/config';
import type { GameInvite } from '../../shared/friends';
import { THEME_LABELS } from '../../shared/config';
import { LABELS } from './components/DifficultyPicker';
import { Loading, Logo } from './components/ui';
import { getSocket } from './game/socket';
import { tokenKey } from './game/useGame';
import { BackBar, SignInNeeded } from './History';
import { useAuth } from './lib/auth';
import { navigate } from './lib/router';
import { applyFriends, respondToInvite, sendInvite, useSocial } from './lib/social';
import { local, session } from './lib/storage';

async function post(url: string, body: unknown = {}) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (data.list) applyFriends(data.list);
    return res.ok ? { message: data.message as string | undefined } : { error: (data.error as string) ?? 'Something went wrong. Please try again.' };
  } catch {
    return { error: "Couldn't reach the server. Check your connection." };
  }
}

/** Creates a game with your usual difficulty, invites the friend, and opens the lobby. */
export function inviteToNewGame(friend: PublicUser, username: string): Promise<string | null> {
  const difficulty = (local.get('cd.difficulty') as Difficulty) || 'medium';
  return new Promise((resolve) => {
    getSocket().emit('room:create', { name: username, difficulty }, async (res) => {
      if (!res.ok) return resolve(res.error);
      session.set(tokenKey(res.code), res.token);
      const err = await sendInvite(res.code, friend.id);
      navigate(`/g/${res.code}`);
      resolve(err);
    });
  });
}

export function FriendsPage() {
  const auth = useAuth();
  const social = useSocial();
  const [name, setName] = useState('');
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!auth.loaded) return <Loading text="Loading…" />;
  if (!auth.user) return <SignInNeeded what="your friends" />;
  const me = auth.user;
  const { friends, incoming, outgoing } = social.friends;

  const run = async (key: string, fn: () => Promise<{ message?: string; error?: string } | string | null>) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (typeof r === 'string') setNote({ text: r, error: true });
    else if (r && 'error' in r && r.error) setNote({ text: r.error, error: true });
    else if (r && 'message' in r && r.message) setNote({ text: r.message });
  };

  const add = () => run('add', async () => {
    const r = await post('/api/friends/request', { username: name });
    if (!r.error) setName('');
    return r;
  });

  return (
    <div className="page-center">
      <div className="narrow">
        <BackBar />
        <Logo />
        <h1>Friends</h1>

        <InviteList invites={social.invites} />

        <form className="panel" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="field">
            <span>Add a friend by username</span>
            <div className="inline-field">
              <input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              <button className="primary" type="submit" disabled={busy === 'add' || !name.trim()}>Add</button>
            </div>
          </label>
          {note && <p className={note.error ? 'message' : 'muted small-print'} role="status">{note.text}</p>}
          <p className="muted small-print">Your username is <b>{me.username}</b>.</p>
        </form>

        {incoming.length > 0 && (
          <div className="panel">
            <strong>Friend requests</strong>
            {incoming.map((u) => (
              <div className="friend-row" key={u.id}>
                <UserLink u={u} />
                <span className="friend-actions">
                  <button className="primary small" disabled={!!busy} onClick={() => run(u.id, () => post(`/api/friends/${u.id}/accept`))}>Accept</button>
                  <button className="ghost small" disabled={!!busy} onClick={() => run(u.id, () => post(`/api/friends/${u.id}/remove`))}>Decline</button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="panel">
          <strong>Your friends</strong>
          {!friends.length && <p className="muted small-print">No friends yet. Add someone by their username above.</p>}
          {friends.map((u) => (
            <div className="friend-row" key={u.id}>
              <UserLink u={u} />
              <span className="friend-actions">
                <button className="primary small" disabled={!!busy} onClick={() => run(u.id, () => inviteToNewGame(u, me.username))}>Invite</button>
                <RemoveButton onRemove={() => run(u.id, () => post(`/api/friends/${u.id}/remove`))} disabled={!!busy} />
              </span>
            </div>
          ))}
          {friends.length > 0 && <p className="muted small-print">Invite starts a new game and sends your friend an invite. You can still share the link too.</p>}
        </div>

        {outgoing.length > 0 && (
          <div className="panel">
            <strong>Sent requests</strong>
            {outgoing.map((u) => (
              <div className="friend-row" key={u.id}>
                <UserLink u={u} />
                <span className="friend-actions">
                  <span className="muted small-print">Waiting</span>
                  <button className="ghost small" disabled={!!busy} onClick={() => run(u.id, () => post(`/api/friends/${u.id}/remove`))}>Cancel</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserLink({ u }: { u: PublicUser }) {
  return (
    <button className="link friend-name" onClick={() => navigate(`/u/${u.username}`)}>
      <span className="avatar small" aria-hidden>{u.username[0]!.toUpperCase()}</span>
      {u.username}
    </button>
  );
}

function RemoveButton({ onRemove, disabled }: { onRemove: () => void; disabled: boolean }) {
  const [sure, setSure] = useState(false);
  if (!sure) return <button className="ghost small" disabled={disabled} onClick={() => setSure(true)}>Remove</button>;
  return <button className="ghost small danger-text" disabled={disabled} onClick={onRemove} onBlur={() => setSure(false)}>Remove?</button>;
}

export function inviteSummary(i: GameInvite) {
  return `${LABELS[i.difficulty]}${i.theme !== 'any' ? ` · ${THEME_LABELS[i.theme]}` : ''}`;
}

/** Game invites waiting for you, with Accept and Decline. Renders nothing when there are none. */
export function InviteList({ invites }: { invites: GameInvite[] }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!invites.length) return null;
  const answer = async (i: GameInvite, accept: boolean) => {
    setBusy(true);
    const err = await respondToInvite(i, accept);
    setBusy(false);
    setError(err ?? '');
  };
  return (
    <div className="panel invites-panel">
      <strong>{invites.length === 1 ? 'Game invite' : 'Game invites'}</strong>
      {invites.map((i) => (
        <div className="friend-row" key={i.id}>
          <span>
            <b>{i.from.username}</b> invited you to a game
            <span className="muted small-print block">{inviteSummary(i)}</span>
          </span>
          <span className="friend-actions">
            <button className="primary small" disabled={busy} onClick={() => answer(i, true)}>Accept</button>
            <button className="ghost small" disabled={busy} onClick={() => answer(i, false)}>Decline</button>
          </span>
        </div>
      ))}
      {error && <p className="message">{error}</p>}
    </div>
  );
}
