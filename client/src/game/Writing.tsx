import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONFIG } from '../../../shared/config';
import type { GameView, NextResult, WritingView } from '../../../shared/protocol';
import { clueContainsAnswer } from '../../../shared/rules';
import { Loading, MuteButton } from '../components/ui';
import { sfx } from '../lib/sound';
import { useNow } from '../lib/useNow';
import type { GameSocket } from './socket';

interface Props {
  view: GameView;
  writing: WritingView;
  socket: GameSocket;
  toLocal: (serverTime: number) => number;
  banner: ReactNode;
  opponentName: string;
}

export function Writing({ writing, socket, toLocal, banner, opponentName }: Props) {
  if (!writing.introDone) return <Intro writing={writing} socket={socket} toLocal={toLocal} banner={banner} />;
  if (writing.done) {
    return (
      <>
        <div className="fixed-banner">{banner}</div>
        <Loading
          text="Waiting for opponent to finish writing clues."
          sub={`${opponentName}: ${writing.opponentDoneCount} of ${writing.words.length} done`}
        />
      </>
    );
  }
  return <WordWriter key={writing.index} writing={writing} socket={socket} toLocal={toLocal} banner={banner} />;
}

function Intro({ writing, socket, toLocal, banner }: Omit<Props, 'view' | 'opponentName'>) {
  const now = useNow(500);
  const left = writing.introDeadline ? Math.max(0, Math.ceil((toLocal(writing.introDeadline) - now) / 1000)) : 0;
  return (
    <div className="page-center">
      <div className="narrow">
        {banner}
        <div className="panel intro">
          <h1>Write your clues</h1>
          <ul className="rules">
            <li>You'll see your {writing.words.length} secret words one at a time, with <b>{CONFIG.secondsPerClue} seconds</b> each.</li>
            <li>Your opponent solves a crossword built from your clues. <b>Tricky is good</b> — it slows them down.</li>
            <li>But keep it fair: a clue that's unconnected to the answer or factually wrong gets replaced and costs <b>you +{CONFIG.flaggedCluePenaltySeconds}s</b>.</li>
            <li>Clues can't contain the answer word, and can be up to {CONFIG.clueCharLimit} characters. Inside jokes are fair game.</li>
            <li className="skip-rule"><b>Skipped clue rule:</b> if you leave a clue blank, that word appears <b>pre-filled and locked</b> in your opponent's grid — a free answer and extra crossing letters for them.</li>
          </ul>
          <button className="primary big" onClick={() => socket.emit('write:intro-done')}>Start writing</button>
          <p className="muted small-print center">Starting automatically in {left}s</p>
        </div>
      </div>
    </div>
  );
}

function WordWriter({ writing, socket, toLocal, banner }: Omit<Props, 'view' | 'opponentName'>) {
  const index = writing.index;
  const word = writing.words[index]!;
  const [text, setText] = useState(writing.draft);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const checked = useRef(new Set<string>());
  const autoChecking = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const now = useNow(200);

  const deadline = writing.deadline ? toLocal(writing.deadline) : now;
  const remainingMs = Math.max(0, deadline - now);
  const seconds = Math.ceil(remainingMs / 1000);
  const trimmed = text.trim();
  const hasAnswer = !!trimmed && clueContainsAnswer(trimmed, word.answer);
  const nearLimit = text.length >= CONFIG.clueCounterWarnAt;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const change = (value: string) => {
    const v = value.replace(/\n/g, ' ').slice(0, CONFIG.clueCharLimit);
    setText(v);
    setNotice('');
    socket.emit('write:draft', { index, text: v });
  };

  const send = (mode: 'check' | 'keep' | 'blank') => {
    setBusy(true);
    socket.emit('write:next', { index, text: mode === 'blank' ? '' : text, mode }, (res) => {
      setBusy(false);
      if (!res.ok) return setNotice(res.error);
      const r: NextResult = res.result;
      if (r.status === 'warning') {
        checked.current.add(trimmed);
        setWarning(r.reason);
        sfx.warn();
      } else if (r.status === 'invalid') {
        setNotice(r.message);
      }
      // 'advanced' and 'stale': the next server state moves us on.
    });
  };

  const next = () => {
    if (busy || hasAnswer) return;
    // A clue already checked (and flagged) needs an explicit choice; one already checked OK skips the re-check.
    send(checked.current.has(`ok:${trimmed}`) ? 'keep' : 'check');
  };

  // The quick check also runs automatically with 5 seconds left, if a clue is typed.
  useEffect(() => {
    if (remainingMs > CONFIG.liveCheckAtSecondsLeft * 1000 || remainingMs === 0) return;
    if (!trimmed || hasAnswer || warning || busy || autoChecking.current) return;
    if (checked.current.has(trimmed) || checked.current.has(`ok:${trimmed}`)) return;
    autoChecking.current = true;
    const sent = trimmed;
    socket.emit('write:check', { index, text: sent }, (res) => {
      autoChecking.current = false;
      if (!res.ok) return;
      if (res.valid) checked.current.add(`ok:${sent}`);
      else {
        checked.current.add(sent);
        setWarning(res.reason);
        sfx.warn();
      }
    });
  }, [remainingMs, trimmed, hasAnswer, warning, busy, index, socket]);

  return (
    <div className="writing">
      <header className="writing-header">
        <span className="label">Word {index + 1} of {writing.words.length}</span>
        <div className="dots" aria-hidden>
          {writing.words.map((w, i) => <span key={i} className={i < index ? (w.blank ? 'dot blank' : 'dot done') : i === index ? 'dot current' : 'dot'} />)}
        </div>
        <MuteButton />
      </header>
      {banner}

      <main className="writing-main">
        <div className="word-tiles" aria-label={`Your word: ${word.answer}`}>
          {[...word.answer].map((ch, i) => <span key={i} className="tile" style={{ animationDelay: `${i * 40}ms` }}>{ch}</span>)}
        </div>
        <p className="muted center">{word.answer.length} letters</p>

        <div className="countdown" aria-label={`${seconds} seconds left`}>
          <div className="countdown-bar"><span style={{ width: `${(remainingMs / (CONFIG.secondsPerClue * 1000)) * 100}%` }} /></div>
          <span className={`countdown-num ${seconds <= 5 ? 'urgent' : ''}`}>0:{String(seconds).padStart(2, '0')}</span>
        </div>

        <div className="clue-box">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => change(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }}
            maxLength={CONFIG.clueCharLimit}
            placeholder={`Write a clue for ${word.answer}…`}
            rows={3}
            disabled={!!warning}
            aria-label="Your clue"
          />
          <div className="clue-box-foot">
            <span className="notice" aria-live="polite">
              {hasAnswer ? "Your clue can't contain the answer word." : notice}
            </span>
            <span className={`counter ${nearLimit ? 'near' : ''}`}>{text.length}/{CONFIG.clueCharLimit}</span>
          </div>
        </div>

        {warning ? (
          <div className="warning-panel" role="alert">
            <p><b>Heads up:</b> {warning}</p>
            <div className="warning-actions">
              <button className="primary" onClick={() => { setWarning(null); setTimeout(() => inputRef.current?.focus()); }}>Edit clue</button>
              <button className="ghost" onClick={() => send('blank')} disabled={busy}>Leave blank</button>
              <button className="ghost" onClick={() => send('keep')} disabled={busy}>Keep anyway</button>
            </div>
            <p className="muted small-print">Leave blank: your opponent gets this word filled in for free, with no penalty. Keep anyway: it goes to the final review and may cost you +{CONFIG.flaggedCluePenaltySeconds}s.</p>
          </div>
        ) : (
          <div className="writing-actions">
            <button className="primary big" onClick={next} disabled={busy || hasAnswer}>
              {busy ? 'Checking…' : trimmed ? 'Next →' : 'Skip (leave blank) →'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
