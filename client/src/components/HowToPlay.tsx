/**
 * How to play: the full rules, opened from the "How to play" button.
 * Numbers come from CONFIG so the rules always match the game.
 */
import { useState } from 'react';
import { CONFIG, poolSeconds } from '../../../shared/config';
import { formatTime } from '../solve/Timer';
import { Modal } from './ui';

const HEADLINE = 'Write challenging clues to slow your opponent down — but they must be fair and solvable.';

/** The three SANDWICH example clues. */
export function ClueExamples() {
  return (
    <div className="clue-examples">
      <p className="clue-examples-word">Your word: <span className="answer">SANDWICH</span></p>
      <div className="clue-example bad">
        <span className="clue-example-tag">✗ Bad</span>
        <span className="clue-example-text">“Blue”</span>
        <span className="clue-example-why">No connection to the answer. It gets flagged and replaced, and <b>you</b> get +{CONFIG.flaggedCluePenaltySeconds}s.</span>
      </div>
      <div className="clue-example meh">
        <span className="clue-example-tag">Too easy</span>
        <span className="clue-example-text">“Bread with filling in between”</span>
        <span className="clue-example-why">Fair, but your opponent solves it instantly.</span>
      </div>
      <div className="clue-example great">
        <span className="clue-example-tag">✓ Great</span>
        <span className="clue-example-text">“Club, for one”</span>
        <span className="clue-example-why">True, but it misdirects (golf club? nightclub?) and slows them down.</span>
      </div>
    </div>
  );
}

/** The full rules. */
export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} labelledBy="rules-title">
      <div className="rules-modal">
        <h2 id="rules-title">How to play</h2>

        <h3>The idea</h3>
        <p>{HEADLINE}</p>
        <p>This is a duel: you're <b>not</b> helping your opponent. The <b>fastest correct solve wins</b>, so tricky-but-fair clues are how you win.</p>
        <ol>
          <li>Create a game and send the link (or invite a friend). Both players press <b>Ready</b>.</li>
          <li>You each get {CONFIG.wordsPerGrid} secret words and write a clue for each one.</li>
          <li>The clues are checked, then you swap: each of you solves the crossword built from the <b>other</b> player's clues.</li>
          <li>The lowest final time (solve time plus penalties) wins.</li>
        </ol>

        <h3>What makes a great clue</h3>
        <p>A great clue is true and fair, but points the solver the wrong way first. Puns, double meanings and inside jokes are all allowed.</p>
        <ClueExamples />

        <h3>What gets flagged</h3>
        <p>After writing, the AI reviews every clue. A clue that is <b>unconnected</b> to the answer or <b>factually wrong</b> is replaced with a fair one, and costs its writer <b>+{CONFIG.flaggedCluePenaltySeconds}s</b>. Obscure, punny or inside-joke clues are fine. Clues can't contain the answer word and are up to {CONFIG.clueCharLimit} characters.</p>
        <p>While writing, a quick check warns you if a clue looks off. You can edit it, keep it anyway, or leave the word blank. A <b>blank</b> clue gives your opponent that word filled in for free.</p>

        <h3>Timers, difficulty and themes</h3>
        <ul>
          <li><b>Per word:</b> {CONFIG.secondsPerClue} seconds for each word, one at a time.</li>
          <li><b>Shared clock:</b> {formatTime(poolSeconds() * 1000)} for all words. Jump between words and revise any clue.</li>
          <li>The host picks the difficulty (Easy, Medium or Hard) and an optional word theme.</li>
          <li>Solving has a {CONFIG.maxSolveMinutes}-minute limit.</li>
        </ul>

        <h3>Hints</h3>
        <p>While solving you can take up to {CONFIG.hintsPerGame} hints. Each one gives an alternative clue for a word and adds <b>+{CONFIG.hintPenaltySeconds}s</b> to your time.</p>

        <h3>Penalties</h3>
        <ul>
          <li>+{CONFIG.hintPenaltySeconds}s for each hint you take.</li>
          <li>+{CONFIG.flaggedCluePenaltySeconds}s for each of <b>your</b> clues that gets flagged.</li>
        </ul>

        <h3>Who wins</h3>
        <ul>
          <li>Lowest final time wins. Final time is your solve time plus penalties.</li>
          <li>The game ends early when the player still solving can no longer win.</li>
          <li>On equal final times, the earlier correct submission wins, then fewer hints, then it's a draw.</li>
          <li>If nobody finishes in {CONFIG.maxSolveMinutes} minutes, more correct words wins, then fewer hints.</li>
          <li>Resigning, or being disconnected for more than {CONFIG.reconnectWindowSeconds} seconds, loses the game.</li>
        </ul>

        <div className="card-actions">
          <button className="primary" onClick={onClose} autoFocus>Got it</button>
        </div>
      </div>
    </Modal>
  );
}

/** Menu link that opens the full rules. */
export function HowToPlayButton({ className = 'link' }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>How to play</button>
      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}
