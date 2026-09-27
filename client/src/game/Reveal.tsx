import { useEffect, useState, type ReactNode } from 'react';
import { CONFIG } from '../../../shared/config';
import type { GameResult, GameView, PlayerResult, RevealGrid } from '../../../shared/protocol';
import { MuteButton } from '../components/ui';
import { sfx } from '../lib/sound';
import { formatTime } from '../solve/Timer';

interface Props {
  result: GameResult;
  view: GameView;
  onRematch: () => void;
  onHome: () => void;
}

/** Delay before each reveal step (ms): raw times, hints, flagged clues, final times, winner. */
const STEP_DELAYS = [600, 1500, 1500, 1700, 1500];

export function Reveal({ result, view, onRematch, onHome }: Props) {
  const me = result.players.find((p) => p.id === view.you)!;
  const opp = result.players.find((p) => p.id !== view.you)!;
  const short = result.reason === 'resign' || result.reason === 'forfeit';
  const anyFlagged = result.players.some((p) => p.flagged.length);
  const [step, setStep] = useState(0);
  const [showGrids, setShowGrids] = useState(false);
  const outcome = result.winnerId === null ? 'draw' : result.winnerId === view.you ? 'win' : 'lose';

  useEffect(() => {
    if (short) {
      const t = setTimeout(() => setStep(5), 500);
      return () => clearTimeout(t);
    }
    if (step >= 5) return;
    const delay = step === 3 && anyFlagged ? 2600 : STEP_DELAYS[step]!;
    const t = setTimeout(() => setStep((s) => s + 1), delay);
    return () => clearTimeout(t);
  }, [step, short, anyFlagged]);

  useEffect(() => {
    if (step === 0) return;
    if (step < 5) sfx.step();
    else if (outcome === 'win') sfx.win();
    else if (outcome === 'lose') sfx.lose();
    else sfx.draw();
  }, [step, outcome]);

  // Live room status (the opponent may already be back in the lobby, or gone).
  const liveOpp = view.players.find((p) => p.id !== view.you);
  const oppLeft = !liveOpp || liveOpp.left;
  const oppWaiting = view.phase === 'lobby' && !oppLeft;

  if (showGrids) return <GridsView grids={result.grids} onBack={() => setShowGrids(false)} />;

  const endedByName = result.players.find((p) => p.id === result.endedBy)?.name;
  const winner = result.players.find((p) => p.id === result.winnerId);

  return (
    <div className="reveal">
      <header className="reveal-header">
        <h1>Results</h1>
        <div className="reveal-header-actions">
          {step < 5 && <button className="ghost small" onClick={() => setStep(5)}>Skip</button>}
          <MuteButton />
        </div>
      </header>

      {short ? (
        <p className="reveal-reason">
          {result.reason === 'resign' ? `${endedByName} resigned.` : `${endedByName} left the game.`}
        </p>
      ) : (
        <div className="score-table" role="table">
          <div className="score-row head" role="row">
            <span />
            <span className="who">You</span>
            <span className="who">{opp.name}</span>
          </div>
          <Row show={step >= 1} label="Solve time">
            <Raw p={me} />
            <Raw p={opp} />
          </Row>
          <Row show={step >= 2} label={`Hints (+${CONFIG.hintPenaltySeconds}s each)`}>
            <Penalty ms={me.hintPenaltyMs} count={me.hintsUsed} unit="hint" />
            <Penalty ms={opp.hintPenaltyMs} count={opp.hintsUsed} unit="hint" />
          </Row>
          <Row show={step >= 3} label={`Flagged clues (+${CONFIG.flaggedCluePenaltySeconds}s each)`}>
            <Penalty ms={me.flaggedPenaltyMs} count={me.flagged.length} unit="clue" />
            <Penalty ms={opp.flaggedPenaltyMs} count={opp.flagged.length} unit="clue" />
          </Row>
          {step >= 3 && anyFlagged && (
            <div className="flagged-list">
              {[me, opp].flatMap((p) => p.flagged.map((f, i) => (
                <div className="flagged-card" key={`${p.id}-${i}`}>
                  <div className="flagged-top">
                    <span className="tag">{p.id === me.id ? 'Your clue' : `${p.name}'s clue`}</span>
                    <span className="answer">{f.answer}</span>
                  </div>
                  <p><span className="muted">Original:</span> <s>{f.original}</s></p>
                  <p><span className="muted">Solved with:</span> {f.replacement}</p>
                  <p className="why">{f.explanation}</p>
                </div>
              )))}
            </div>
          )}
          <Row show={step >= 4} label="Final time" big>
            <Final p={me} highlight={step >= 5 && result.winnerId === me.id} />
            <Final p={opp} highlight={step >= 5 && result.winnerId === opp.id} />
          </Row>
          {result.reviewSkipped && step >= 3 && (
            <p className="muted small-print center">The clue review couldn't run this game, so original clues were used with no clue penalties.</p>
          )}
        </div>
      )}

      {step >= 5 && (
        <div className={`verdict ${outcome}`}>
          {outcome === 'win' && <Trophy />}
          {outcome === 'lose' && <BigX />}
          {outcome === 'draw' ? (
            <>
              <h2 className="verdict-title">It's a draw</h2>
              <p className="verdict-names">{me.name} &amp; {opp.name}</p>
            </>
          ) : (
            <>
              <h2 className="verdict-title">{outcome === 'win' ? 'You win!' : `${winner?.name} wins`}</h2>
              <p className="verdict-sub">{verdictDetail(result, winner?.name ?? '')}</p>
            </>
          )}
        </div>
      )}

      {step >= 5 && (
        <div className="reveal-actions">
          <button className="ghost" onClick={() => setShowGrids(true)}>View both grids</button>
          <button className="primary" onClick={onRematch} disabled={oppLeft}>Rematch</button>
          <button className="ghost" onClick={onHome}>Home</button>
          <p className="muted small-print center">
            {oppLeft ? 'Opponent left.' : oppWaiting ? `${liveOpp!.name} is waiting in the lobby for a rematch.` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

function verdictDetail(result: GameResult, winnerName: string): string {
  if (result.tieBreak === 'submission') return `Tied on time — ${winnerName} submitted first.`;
  if (result.tieBreak === 'hints') return `Tied — ${winnerName} used fewer hints.`;
  if (result.tieBreak === 'words') return `Time ran out — ${winnerName} had more words right.`;
  if (result.reason === 'timeout') return `Time ran out after ${CONFIG.maxSolveMinutes} minutes.`;
  if (result.reason === 'resign') return 'By resignation.';
  if (result.reason === 'forfeit') return 'Opponent left the game.';
  return '';
}

function Row({ show, label, big, children }: { show: boolean; label: string; big?: boolean; children: ReactNode }) {
  return (
    <div className={`score-row ${show ? 'shown' : ''} ${big ? 'big' : ''}`} role="row">
      <span className="row-label">{label}</span>
      {show ? children : <><span className="placeholder" /><span className="placeholder" /></>}
    </div>
  );
}

function Raw({ p }: { p: PlayerResult }) {
  return <span className="cell-val">{p.rawMs !== null ? formatTime(p.rawMs) : <span className="dnf">Didn't finish · {p.wordsCorrect}/{p.totalWords} right</span>}</span>;
}

function Penalty({ ms, count, unit }: { ms: number; count: number; unit: string }) {
  return (
    <span className={`cell-val ${ms ? 'penalty' : 'muted'}`}>
      {ms ? `+${formatTime(ms)}` : '—'}
      {count > 0 && <span className="small-print"> ({count} {unit}{count === 1 ? '' : 's'})</span>}
    </span>
  );
}

function Final({ p, highlight }: { p: PlayerResult; highlight: boolean }) {
  return <span className={`cell-val final ${highlight ? 'winner' : ''}`}>{p.finalMs !== null ? formatTime(p.finalMs) : 'DNF'}</span>;
}

function Trophy() {
  return (
    <div className="trophy-wrap" aria-label="Trophy">
      <div className="burst" aria-hidden>{Array.from({ length: 14 }, (_, i) => <span key={i} style={{ ['--i' as string]: i }} />)}</div>
      <svg className="trophy" viewBox="0 0 120 120" width="120" height="120" aria-hidden>
        <path d="M34 18h52v22c0 16-12 30-26 30S34 56 34 40V18z" fill="var(--blue)" />
        <path d="M34 26H20c0 14 7 22 16 24M86 26h14c0 14-7 22-16 24" fill="none" stroke="var(--blue)" strokeWidth="7" strokeLinecap="round" />
        <rect x="54" y="68" width="12" height="16" fill="var(--blue-strong)" />
        <rect x="38" y="84" width="44" height="12" rx="3" fill="var(--ink)" />
        <path d="M50 30l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#fff" opacity="0.9" transform="translate(6 2)" />
      </svg>
    </div>
  );
}

function BigX() {
  return (
    <svg className="big-x" viewBox="0 0 120 120" width="120" height="120" aria-label="You lost">
      <path d="M30 30L90 90M90 30L30 90" stroke="var(--ink)" strokeWidth="14" strokeLinecap="round" />
    </svg>
  );
}

// ── Both grids, side by side ─────────────────────────────

function GridsView({ grids, onBack }: { grids: RevealGrid[]; onBack: () => void }) {
  return (
    <div className="reveal grids-view">
      <header className="reveal-header">
        <button className="ghost small" onClick={onBack}>← Results</button>
        <h1>Both grids</h1>
        <MuteButton />
      </header>
      <div className="grids-pair">
        {grids.map((g, i) => <SolvedGrid key={i} grid={g} />)}
      </div>
    </div>
  );
}

function SolvedGrid({ grid }: { grid: RevealGrid }) {
  const numbers = new Map(grid.clues.map((c) => [`${c.row},${c.col}`, c.number]));
  const byDir = (dir: 'across' | 'down') => grid.clues.filter((c) => c.direction === dir).sort((a, b) => a.number - b.number);
  return (
    <section className="solved-grid">
      <h2>Clues by {grid.writerName} <span className="muted">· solved by {grid.solverName}</span></h2>
      <div className="mini-grid" style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)`, aspectRatio: `${grid.cols} / ${grid.rows}` }}>
        {grid.cells.map((row, r) => row.map((cell, c) => (
          <div key={`${r},${c}`} className={`mcell ${cell === null ? 'black' : ''}`}>
            {numbers.has(`${r},${c}`) && <span className="num">{numbers.get(`${r},${c}`)}</span>}
            {cell}
          </div>
        )))}
      </div>
      {(['across', 'down'] as const).map((dir) => (
        <div key={dir} className="answer-list">
          <h3>{dir === 'across' ? 'Across' : 'Down'}</h3>
          <ol>
            {byDir(dir).map((c) => (
              <li key={`${dir}${c.number}`}>
                <span className="clue-num">{c.number}</span>
                <span className="clue-body">
                  <span className="answer">{c.answer}</span>{' '}
                  <span className={c.prefilled ? 'muted' : ''}>{c.text}</span>
                  {c.original !== undefined && (
                    <span className="replaced">Replaced — original: <s>{c.original}</s>{c.explanation ? ` (${c.explanation})` : ''}</span>
                  )}
                  {c.hint && <span className="hint-text">Hint used: {c.hint}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
