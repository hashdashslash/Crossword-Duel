import { useEffect, type ReactNode } from 'react';
import { useMuted } from '../lib/sound';

/** A centred dialog. Escape or clicking outside calls onClose (if given). */
export function Modal({ children, onClose, labelledBy }: { children: ReactNode; onClose?: () => void; labelledBy?: string }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby={labelledBy} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ title, body, yes, no = 'Cancel', onYes, onNo, busy }: {
  title: string; body?: ReactNode; yes: string; no?: string; onYes: () => void; onNo: () => void; busy?: boolean;
}) {
  return (
    <Modal onClose={busy ? undefined : onNo} labelledBy="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      {body && <div className="dialog-body">{body}</div>}
      <div className="card-actions">
        <button className="primary" onClick={onYes} disabled={busy} autoFocus>{yes}</button>
        <button className="ghost" onClick={onNo} disabled={busy}>{no}</button>
      </div>
    </Modal>
  );
}

export function MuteButton() {
  const [muted, setMuted] = useMuted();
  return (
    <button className="ghost icon" onClick={() => setMuted(!muted)} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} title={muted ? 'Sound off' : 'Sound on'}>
      {muted ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="m23 9-6 6M17 9l6 6" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /></svg>
      )}
    </button>
  );
}

export function Logo() {
  // A tiny 3×3 crossword as the logo.
  const pattern = [1, 1, 1, 1, 0, 1, 1, 1, 1];
  return (
    <div className="logo" aria-hidden>
      {pattern.map((on, i) => <span key={i} className={!on ? 'dark' : i % 2 ? 'blue' : ''} />)}
    </div>
  );
}

export function Loading({ text, sub }: { text: string; sub?: string }) {
  return (
    <div className="loading">
      <div className="loading-grid" aria-hidden>
        {Array.from({ length: 9 }, (_, i) => <span key={i} style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 120}ms` }} />)}
      </div>
      <p className="loading-text">{text}</p>
      {sub && <p className="muted">{sub}</p>}
    </div>
  );
}
