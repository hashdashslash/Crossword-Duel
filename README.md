# Crossword Duel

A two-player, real-time competitive crossword game. Each player writes clues for their own
secret set of 15 words, then the players swap and race to solve each other's puzzle.
Lowest final time wins.

> **Status: Phase 2 of 7 — single-player solving screen.** You can solve practice puzzles in
> your browser. Clues are placeholder "unscramble" clues until clue writing arrives in Phase 3.

---

## One-time setup (on your own computer)

1. **Install Node.js** (the program that runs this project). Go to <https://nodejs.org>,
   download the **LTS** version, and install it with the default options.
2. **Get the code.** On GitHub, click the green **Code** button → **Download ZIP**, then unzip it.
   (Or, if you use Git: `git clone` the repository.)
3. **Open a terminal in the project folder.**
   - **Mac:** open the *Terminal* app, type `cd ` (with a space), drag the project folder
     into the window, press Enter.
   - **Windows:** open the project folder in File Explorer, click the address bar, type `cmd`,
     press Enter.
4. **Install the project's helpers:** type the following and press Enter. It takes a minute.

   ```
   npm install
   ```

You only do these steps once.

---

## Play the practice puzzle (Phase 2)

1. In the terminal, in the project folder, type:

   ```
   npm run dev
   ```

2. Wait until you see `Local: http://localhost:5173/` and `Server running`.
3. Open **http://localhost:5173** in your web browser.
4. To stop the game, click the terminal and press **Ctrl + C**.

**Try it on your phone:** your phone must be on the same Wi-Fi as your computer. The terminal
also shows a line like `Network: http://192.168.1.23:5173/` — type that address into your
phone's browser. (Windows may ask whether to allow Node.js through the firewall: click **Allow**
for private networks.)

**See the phone layout on a computer:** open **http://localhost:5173/?touch=1**.

### Controls

| On a computer | |
|---|---|
| Click a square | Select it |
| Click the same square again | Switch between Across and Down |
| Type a letter | Fill the square and move to the next one |
| Backspace | Clear the square (or step back if it's already empty) |
| Arrow keys | Move around (the first press across the word turns direction) |
| Tab / Shift + Tab | Next / previous word |
| Space bar | Switch between Across and Down |
| Click a clue | Jump to that word |

On a phone, tap squares and use the on-screen keyboard. Tap the blue clue bar to switch
direction, its ‹ › arrows to move between words, and **Clues** to see the full list.

**Submit** checks the grid: empty squares turn light blue, wrong letters turn a stronger
blue (both get a small blue corner marker). Fix them and submit again — there's no penalty.

## Grid generator tools (Phase 1)

Type any of these commands in the terminal, from the project folder.

### See one game's two puzzles

```
npm run grid:demo
```

This prints Grid A and Grid B for a random medium game: letters, black squares (■),
and the Across/Down answer lists. Try other difficulties:

```
npm run grid:demo -- easy
npm run grid:demo -- hard
```

Each run prints a **seed** number. Running it again with the same seed rebuilds the exact
same puzzles, which is handy for reporting a grid you don't like:

```
npm run grid:demo -- hard 12345
```

### Stress-test the generator

```
npm run grid:stress
```

This builds 200 games per difficulty (1,200 grids) and re-checks every one of them against
every rule. It takes about a minute. For a bigger test: `npm run grid:stress -- 1000`.

What the report means:

| Line | What it tells you |
|---|---|
| **Pass rate** | Share of games that were built *and* passed every check. Should be 100%. |
| Rule violations found | Any grid breaking a rule (should be 0; details are listed if not). |
| Build time | How long one game's puzzles take. Anything under a second is fine. |
| Grid sizes | Most common sizes, written wide × tall. |
| Density | How much of the grid is letters rather than black squares. |
| Words crossing 2+ | Share of answers that cross at least two other answers. |
| Answer length | How many answers of each length appeared. |
| A vs B gaps | How different the two players' puzzles are in size and total letters. |

It ends with `RESULT: every grid passed every check.` when all is well.

### Check the word lists after editing them

The words live in three plain text files, one word per line:

- `server/words/easy.txt`
- `server/words/medium.txt`
- `server/words/hard.txt`

You can add or remove words with any text editor. Then run:

```
npm run words:check
```

It flags typos, words that aren't in a standard English dictionary (which catches most
proper nouns and abbreviations), words listed twice, and words in two difficulty files.

### Run the automated tests

```
npm test
```

---

## Tuning the game

Every adjustable number (words per grid, seconds per clue, hint penalty, grid size limits,
and so on) is in **`shared/config.ts`**, with a comment next to each one.

---

## How the grid generator works

The generator is ordinary code, not AI. For each game it:

1. Draws about 52 random words from the chosen difficulty, making sure no two are related
   (e.g. never both CAT and CATS, or BAKER and BAKING).
2. Splits them into two pools with the same mix of word lengths.
3. For each pool, builds about 40 candidate grids. Each grid starts with one long word and
   repeatedly adds the word and position that crosses the most letters while keeping the grid
   compact. Positions that would put letters side by side (forming non-words) are never allowed.
4. Runs every candidate through an **independent checker** (`server/grid/validate.ts`)
   that re-verifies all the rules from scratch.
5. Picks the best-scoring pair of valid grids that are similar in size and difficulty.
   If none qualify, it draws fresh words and tries again.

### Rules every grid must pass

- Exactly 15 answers, all different, 3–10 letters, from the word bank.
- All answers connected in one network; every answer crosses at least one other,
  and at least 60% cross two or more.
- No accidental words: every run of two or more letters is exactly one answer.
- Between 9 and 12 squares wide, 9 and 15 tall, no more than 1.5× taller than wide (or vice
  versa), at least 36% letters, and no empty block bigger than 5×5.
- Grid A and Grid B share no words, differ in area by at most 20%, in total letters by at
  most 10%, and in the number of long (8+ letter) answers by at most 2.

## Project layout

```
shared/config.ts         every tunable number
shared/puzzle.ts         what the browser is told about a puzzle (never the answers)
server/index.ts          the game server
server/words/            word lists + loader
server/grid/             generator, independent validator, clue numbering
server/solve/            answer checking
client/                  the web pages (React)
scripts/                 demo, stress test, word-list checker
tests/                   automated tests
```
