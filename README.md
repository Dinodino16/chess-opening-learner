# Chess Opening Learner

**▶ Play it here: https://dinodino16.github.io/chess-opening-learner/**

Pick a colour, search for an opening, and play through it against an opponent that answers from the book.

- Play any legal move. Leaving the book is allowed: the opponent switches to a small built-in engine.
- **Hint** shows the piece to move, then an arrow to its square.
- **Ideas** explains the idea behind each move, with the source where one exists.
- **End game** (or mate/draw) gives a review of how you did in the opening.
  
## Layout

| File | What it does |
|---|---|
| `js/chess.js` | Rules engine: legal moves, SAN, check/mate/draws. No DOM. |
| `js/ai.js` | Opponent for off-book play: alpha-beta search, depth 3. |
| `js/board.js` | Board view: drag/click input, animation, hints, arrows. Knows no rules. |
| `js/openings.js` | Opening lines, per-move ideas and sources. Add openings here. |
| `js/app.js` | Trainer flow: colour, opening picker, opponent, review. |

## Credits

Sound effects: chess.com.

Pieces: cburnett set by Colin M.L. Burnett (CC BY-SA 3.0 / GPLv2+), as packaged by lichess chessground.
