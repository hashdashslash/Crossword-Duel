/** Pops up when a friend invites you while you're browsing (not during a game). */
import { useState } from 'react';
import { inviteSummary } from '../Friends';
import { dismissFresh, respondToInvite, useSocial } from '../lib/social';

export function InviteToast() {
  const { fresh } = useSocial();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invite = fresh[0];
  if (!invite) return null;
  const answer = async (accept: boolean) => {
    setBusy(true);
    const err = await respondToInvite(invite, accept);
    setBusy(false);
    setError(err ?? '');
  };
  return (
    <div className="invite-toast" role="alertdialog" aria-label="Game invite">
      <p><b>{invite.from.username}</b> invited you to a game</p>
      <p className="muted small-print">{inviteSummary(invite)}</p>
      {error && <p className="message">{error}</p>}
      <div className="invite-toast-actions">
        <button className="primary small" disabled={busy} onClick={() => answer(true)}>Accept</button>
        <button className="ghost small" disabled={busy} onClick={() => answer(false)}>Decline</button>
        <button className="link small" onClick={() => { setError(''); dismissFresh(invite.id); }}>Later</button>
      </div>
    </div>
  );
}
