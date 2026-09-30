# Crossword Duel

A two-player, real-time competitive crossword game. Each player writes clues for their own
secret set of 15 words, then the players swap and race to solve each other's crossword.
Lowest final time wins — so clever, tricky (but fair) clues are the strategy.

---

## 1. Run it on your computer

**One-time setup**

1. **Install Node.js** from <https://nodejs.org> — download the **LTS** version and install it
   with the default options.
2. **Download the code.** On GitHub, pick the branch with the latest version from the branch
   menu, then **Code → Download ZIP**, and unzip it.
3. **Open a terminal in the project folder.**
   - **Mac:** open *Terminal*, type `cd ` (with a space), drag the folder into the window, press Enter.
   - **Windows:** open the folder in File Explorer, click the address bar, type `cmd`, press Enter.
4. Type `npm install` and press Enter (takes a minute; yellow "warn" lines are fine).

**Every time you want to play**

```
npm run dev
```

Wait for `Local: http://localhost:5173/` and `Server running`, then open
**http://localhost:5173** in your browser. Press **Ctrl + C** in the terminal to stop.

---

## 2. Testing on your own

You don't need a second person to try everything:

- **Play both sides yourself.** Create a game, copy the invite link, and paste it into a **new
  tab** (not "duplicate tab") or a private/incognito window. Each tab is a separate player.
- **Use your phone.** Your phone must be on the same Wi-Fi. The terminal shows a line like
  `Network: http://192.168.1.23:5173/` — open that address on your phone. (Windows may ask
  about the firewall: click **Allow** for private networks.)
- **See the phone layout on a computer:** add `?touch=1` to the address, e.g.
  `http://localhost:5173/?touch=1`.

**Without an API key the AI runs in "pretend mode":** any clue containing the word
**"wrong"** is treated as a bad clue (so you can test warnings and penalties), and hints are
simple "N letters, starts with X" clues. Everything else works normally.

---

## 3. Adding your Anthropic API key (real AI)

The AI checks clues, reviews them, writes replacement clues and writes hints.

1. Go to <https://console.anthropic.com>, sign up, add a little credit under **Billing**, then
   create a key under **API Keys**. It starts with `sk-ant-`.
2. **On your computer:** in the project folder, make a copy of `.env.example` named `.env`
   (exactly that — a dot, then `env`). Open it in a text editor and paste your key after
   `ANTHROPIC_API_KEY=`. Restart `npm run dev`; the terminal will say `AI: using the Anthropic API.`
3. **Online:** paste the key into your hosting dashboard (see below), never into the code.

**Check that the AI works:** in the project folder, run `npm run ai:check`. It checks your key,
your account credit and access to each AI model, tries one real hint, and tells you in plain
English what (if anything) is wrong. It costs a tiny fraction of a cent. The server also runs
this check every time it starts — on Render, look for **"AI self-test"** in the **Logs** tab.
If a hint fails during a game, the message on screen also says why.

**Your key stays private.** The `.env` file is listed in `.gitignore`, so it is never uploaded
to GitHub. The key is only ever read on the server; players' browsers never see it.

**Rough cost (an estimate, not measured):** a few cents for the clue review per game, plus up to a
couple of cents per hint. The quick clue check uses the small, fast Claude Haiku 4.5 model;
the review and hints use Claude Opus 5. The daily puzzle's clues are the biggest cost, roughly
$3 a day: Claude Opus 5.5 writes six candidates per answer and two critics running on the
cheaper Claude Sonnet 5.5 score them. Each day is written once and saved; the server log shows the
tokens every request used. You can change models in `shared/config.ts` (`ai` section).

---

## 4. Put it online (free) with Render

[Render](https://render.com) runs the game on the internet so friends can join from anywhere.

1. Create a free account at <https://render.com> and connect your GitHub account.
2. Click **New → Blueprint**, choose this repository and the branch with the latest code. Render
   reads `render.yaml` and sets everything up.
3. When asked for **ANTHROPIC_API_KEY**, paste your key (or leave it empty for pretend mode).
4. Click **Apply**. After a few minutes you'll get an address like
   `https://crossword-duel.onrender.com`. Share it!

Every time new code is pushed to that branch, Render updates the site automatically.

**Good to know about the free plan:** the site "sleeps" after 15 minutes with no visitors, so
the first visit afterwards takes 30–60 seconds to wake up. While a game is open, each browser
sends a tiny request every few minutes so the site doesn't fall asleep mid-game. Games are kept
in memory, so an update or restart ends games in progress: players see a "server is restarting"
notice, then a "the server restarted" page with a button to start a new game. Render's paid plan
(about $7/month) removes the sleep.

---

### Accounts database (optional)

Guest play needs nothing extra. **Accounts** (sign-up, game history, friends) need a Postgres
database, because Render wipes the server's own files on every update.

- **New setup:** the Blueprint (`render.yaml`) already creates one: `crossword-duel-db`, on the
  smallest paid plan (about $6/month; Render's free database is deleted after 30 days).
- **Existing site:** in Render, open **Blueprints**, pick this blueprint, and click **Manual sync**
  (or **Sync**). Render shows it will create `crossword-duel-db` and add `DATABASE_URL` to the
  web service. Approve it. The tables are created automatically when the server starts.
- **Check it:** the **Logs** tab says `Accounts: on (Postgres).` If it says `Accounts: off`, the
  game still works, but sign-in links are hidden.
- **On your computer** nothing is needed: `npm run dev` uses a built-in database stored in
  `data/pglite`.

Passwords are stored as salted scrypt hashes. Failed sign-ins are limited to 5 per email and 20
per network address every 15 minutes. There is no "forgot password" email yet.

---

## 5. How a game works

1. **Lobby** — enter a name, create a game, send the invite link (or 4-letter code). The host
   picks Easy / Medium / Hard, a **word theme** (Any words, Food & drink, Animals, Sports & games,
   Nature & weather) and the **clue timer**: *Per word* (30 seconds each, one at a time)
   or *Shared clock* (7:30 for all 15 words; tap the dots to jump between words and revise any
   clue). If you've played this opponent before, the lobby shows your record against them. Both
   click **Ready**.
2. **Clue writing** — each player sees their 15 words one at a time, 30 seconds each.
   Clues can't contain the answer and are capped at 150 characters. Don't know a word? Tap it (or **What does this mean?**) for a short definition. A quick AI check warns
   about clues that don't fit (Edit / Leave blank / Keep anyway). **Blank clues** become free,
   pre-filled words in the opponent's grid.
3. **Review** — the AI reviews every clue. Clues that are unconnected to the answer or factually
   wrong are silently replaced with fair ones and cost their writer +60s. (Obscure, punny or
   inside-joke clues are allowed.)
4. **Solving** — each player solves the other's crossword. Hints (5 per game, +30s each) give an
   alternative clue. **Submit** highlights empty squares (light blue) and wrong letters
   (stronger blue). **Resign** is always available.
5. **Reveal** — solve times, hint penalties, flagged clues (original, replacement, and why),
   final times, then the winner with a trophy (or an X). Each player picks the **best clue** their
   opponent wrote, and sees which of their own clues was picked. **Share result** copies a short,
   spoiler-free summary for group chats. View both grids, then **Rematch**.

**Head-to-head record:** wins, losses and draws against each opponent (matched by name) are kept
in your browser only.

**Practice solo:** a single generated grid. Clues are ones players voted "best clue" in duels when
there are any for that word, otherwise dictionary definitions (a word with neither gets its letters
scrambled). Voted clues are saved in `data/best-clues.json` (or the folder set by `DATA_DIR`).
On Render's free plan that file is wiped on every restart or update; keeping it needs a paid
Render persistent disk mounted at `DATA_DIR`.

**Daily puzzle:** a Sunday-newspaper-size crossword every day, the same for everyone: a 21×21
grid with symmetric black squares and 120 to 140 answers. It changes at each player's midnight.
Your times and streak are kept in your browser, as is an unfinished solve (leave and come back
later to pick up where you stopped), and **Share** copies a line like
"Crossword Duel Daily #12 · 48:31 · 🔥 3-day streak".

- *Grids* are built ahead of time and stored in `server/grid/daily-grids.txt`, one per day
  (filling a 21×21 grid takes far more computing than Render's free plan has). The words come
  from `server/words/fill.txt`, a scored list built from the WordNet dictionary and the game's own
  word lists (`npm run words:fill`); offensive words and crosswordese (ERE, ASEA, ETUI…) are
  never used (`server/words/blocked.ts`). After adding to those lists, `npm run daily:repair`
  swaps the words out of the existing grids, keeping each day's grid number.
  To add more days, run `npm run daily:build -- 800` (it keeps going until the file has that
  many grids, using every CPU core). If the file ever runs out, the days start over from #1.
- *Clues* follow a clue-first crossword playbook: fair, precise misdirection that is literally
  true once you see it. Once per day the AI writes six candidate clues per answer in different
  styles; code rejects any that give the answer away, use another grid answer, run over 100
  characters, repeat a clue from the last 90 days or a well-known published clue, or put
  misdirection next to a less familiar word. Two separate AI critics (an editor and a test
  solver) score the rest on accuracy, fairness, freshness, surface and delight, and a clue is
  kept only if both pass it and neither doubts its facts. The best clue per answer is picked,
  keeping any one pattern ("?" puns, fill-in-the-blanks, "e.g." clues) to a tenth of the puzzle.
  The clues are saved in the database so everyone gets the same clues, even after a restart. The server
  writes and edits the next day's clues every night at 2am Pacific time (and, after a restart,
  any day players could be on right now); if a player arrives before they're ready, they see
  "Writing and editing today's clues…" for several minutes. On Render's free plan the server
  sleeps when nobody is playing, so if it's asleep at 2am the clues are written when it next
  wakes. Players never get stand-in clues on the daily: if the AI fails, the day keeps showing
  "Writing and editing today's clues…" and is tried again a few minutes later. Only without an
  API key at all (local development) does the puzzle use dictionary clues.

**Dark mode** follows your device's setting.

**Endings and tie-breaks:** the game ends when both finish, when the player still solving can
no longer win, after 30 minutes, or on resignation / a disconnect of more than 60 seconds.
Equal final times go to the earlier correct submission, then fewer hints, then a draw. If
nobody finishes in 30 minutes, more correct words wins, then fewer hints.

**Controls (computer):** click a square (click again to switch Across/Down), type to fill, Backspace
to go back, arrow keys to move, Tab / Shift+Tab for next/previous word, Space to switch direction.
**Phone:** tap squares and use the on-screen keyboard; tap the blue clue bar to switch direction,
use its ‹ › arrows to change words, and **Clues** for the full list.

---

## 6. Settings

Every adjustable number — words per grid, seconds per clue, character limit, hints per game,
penalties, reconnect window, maximum solve time, grid size limits, AI models and review
strictness — is in **`shared/config.ts`**, each with a comment.

The word lists are plain text files (one word per line) in `server/words/`
(`easy.txt`, `medium.txt`, `hard.txt`, and the theme lists in `server/words/themes/`). After editing, run `npm run words:check` and `npm run words:define`
(which refreshes the definitions shown during clue writing). Definitions come from WordNet 3.1
(© Princeton University; see `server/words/DEFINITIONS-LICENSE.txt`).

---

## 7. Other commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the game locally (auto-reloads when code changes) |
| `npm test` | Run all automated tests (grid rules, controls, scoring, and full simulated games) |
| `npm run grid:demo -- hard` | Print one game's two puzzles |
| `npm run grid:stress` | Build 1,200 grids and check every rule |
| `npm run words:check` | Check the word lists for typos and duplicates |
| `npm run daily:build -- 800` | Add daily-puzzle grids until there are 800 |
| `npm run daily:repair` | Re-check the daily grids and fix any that use a newly banned word |
| `npm run ai:check` | Check your Anthropic API key, credit and model access |
| `npm run build` then `npm start` | Run the production version (what Render runs) |

---

## 8. Project layout

```
shared/          code used by both the server and the browser
  config.ts      every tunable number
  rules.ts       name and clue rules (e.g. "clue can't contain the answer")
  protocol.ts    the messages the server and browsers exchange
server/          the game server (the source of truth for answers, timers and scores)
  game/          game rooms, scoring, real-time connections
  ai/            Anthropic API calls, pretend-AI mode, and the review instructions
  grid/          crossword generator and independent checker
  words/         word lists
client/          the web pages (React)
tests/           automated tests
```
