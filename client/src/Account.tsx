import { useState } from 'react';
import { PASSWORD_MIN, USERNAME_MAX, USERNAME_MIN, checkEmail, checkPassword, checkUsername } from '../../shared/account';
import { Logo } from './components/ui';
import { signIn, signOut, signUp, useAuth } from './lib/auth';
import { navigate } from './lib/router';

/** Sign in / create account. `?next=/path` returns there afterwards. */
export function Account({ mode }: { mode: 'signin' | 'signup' }) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(location.search).get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const submit = async () => {
    const problem = mode === 'signup'
      ? checkEmail(email) ?? checkUsername(username) ?? checkPassword(password)
      : checkEmail(email) ?? (password ? null : 'Please enter your password.');
    if (problem) return setError(problem);
    setBusy(true);
    const err = mode === 'signup' ? await signUp(email, username, password) : await signIn(email, password);
    setBusy(false);
    if (err) return setError(err);
    navigate(safeNext, true);
  };

  const other = mode === 'signup' ? 'signin' : 'signup';
  const switchMode = () => {
    setError('');
    navigate(`/${other}${safeNext !== '/' ? `?next=${encodeURIComponent(safeNext)}` : ''}`, true);
  };

  return (
    <div className="page-center">
      <div className="narrow">
        <button className="ghost small back-link" onClick={() => navigate(safeNext)}>← Back</button>
        <Logo />
        <h1>{mode === 'signup' ? 'Create an account' : 'Sign in'}</h1>
        <p className="tagline">
          {mode === 'signup' ? 'Save your games, track your record and add friends. Optional: you can always play as a guest.' : 'Welcome back.'}
        </p>
        {auth.loaded && !auth.enabled ? (
          <div className="panel"><p className="message">Accounts aren't available right now. You can still play as a guest.</p></div>
        ) : (
          <form className="panel" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
            </label>
            {mode === 'signup' && (
              <label className="field">
                <span>Username <span className="muted">(friends find you by this)</span></span>
                <input value={username} onChange={(e) => setUsername(e.target.value.slice(0, USERNAME_MAX))} autoComplete="username" placeholder={`${USERNAME_MIN}–${USERNAME_MAX} letters, numbers or _`} required />
              </label>
            )}
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                placeholder={mode === 'signup' ? `At least ${PASSWORD_MIN} characters` : ''}
                required
              />
            </label>
            <button className="primary big" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
            {error && <p className="message" role="alert">{error}</p>}
          </form>
        )}
        <div className="home-links">
          <button className="link" onClick={switchMode}>{mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
          <button className="link" onClick={() => navigate('/')}>Play as a guest</button>
        </div>
      </div>
    </div>
  );
}

/** Top-of-page account links: "Sign in" or "username · Sign out". */
export function AccountBar() {
  const auth = useAuth();
  if (!auth.loaded || !auth.enabled) return <div className="account-bar" />;
  const here = encodeURIComponent(location.pathname);
  return (
    <div className="account-bar">
      {auth.user ? (
        <>
          <button className="link" onClick={() => navigate(`/u/${auth.user!.username}`)}>{auth.user.username}</button>
          <button className="link" onClick={() => navigate('/history')}>History</button>
          <AccountSignOut />
        </>
      ) : (
        <>
          <button className="link" onClick={() => navigate(`/signin?next=${here}`)}>Sign in</button>
          <button className="link" onClick={() => navigate(`/signup?next=${here}`)}>Create account</button>
        </>
      )}
    </div>
  );
}

function AccountSignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <button className="link" disabled={busy} onClick={async () => { setBusy(true); await signOut(); setBusy(false); }}>
      Sign out
    </button>
  );
}
