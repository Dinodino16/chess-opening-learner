// Run: node test/ai.test.js — the opponent must find obvious tactics, and fast enough.
const assert = require('assert');
const Chess = require('../js/chess.js');
global.Chess = Chess;
require('../js/ai.js');

const time = (fen, depth) => { const g = new Chess(fen); const t = Date.now(); const m = g.bestMove({ depth, variety: 0 }); return { m, ms: Date.now() - t }; };

// Takes a hanging queen.
assert.strictEqual(time('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/3P4/PPP2PPP/RNBQKBNR w KQkq - 1 3', 3).m.san, 'Bxg5');
// Finds mate in one.
assert.strictEqual(time('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 3).m.san, 'Ra8#');
// Doesn't leave its own queen en prise to a pawn.
const q = time('rnbqkbnr/pppp1ppp/8/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR b KQkq - 1 2', 3).m;
assert.notStrictEqual(q.to, 'f3');

// Speed on typical opening/middlegame positions (must fit in the ~1s think pause).
for (const fen of [
  Chess.START_FEN,
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
  'r2q1rk1/pp1nbppp/2p1pn2/3p1b2/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 9',
]) {
  const { m, ms } = time(fen, 3);
  console.log(`depth 3: ${m.san.padEnd(6)} ${ms} ms`);
}
console.log('ai: tactics ok');
