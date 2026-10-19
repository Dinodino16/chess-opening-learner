// Run: node test/engine.test.js
const assert = require('assert');
const Chess = require('../js/chess.js');

// Known perft node counts (chessprogramming.org/Perft_Results).
const perft = [
  [Chess.START_FEN, 4, 197281],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862], // Kiwipete
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379],
];
for (const [fen, d, n] of perft) {
  const got = new Chess(fen).perft(d);
  assert.strictEqual(got, n, `perft(${d}) ${fen}: ${got} != ${n}`);
}

const g = new Chess();
for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']) assert(g.move(m), m);
assert.strictEqual(g.fen(), 'r1bqk2r/1pppbppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 4 6');
assert.deepStrictEqual(g.history().slice(-2), ['O-O', 'Be7']);
g.undo(); g.undo();
assert.strictEqual(g.fen(), 'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 5');

// Scholar's mate
const m = new Chess();
['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'].forEach((s) => assert(m.move(s), s));
assert(m.isCheckmate());
assert.deepStrictEqual(m.outcome(), { over: true, result: '1-0', reason: 'checkmate' });
assert.strictEqual(m.history().pop(), 'Qxf7#');

// SAN disambiguation, promotion, en passant, UCI input
const d = new Chess('4k3/8/8/8/8/8/4K3/R6R w - - 0 1');
assert(d.moves().some((x) => x.san === 'Rad1') && d.moves().some((x) => x.san === 'Rhd1'));
const p = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
assert.strictEqual(p.move('a8=Q').san, 'a8=Q');
const e = new Chess('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
assert.strictEqual(e.move('e5d6').san, 'exd6');
assert.strictEqual(e.get('d5'), null);

// Draws
assert(new Chess('8/8/8/8/8/5k2/8/5K2 w - - 0 1').isInsufficientMaterial());
assert(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').isStalemate());
const r = new Chess();
for (let i = 0; i < 2; i++) ['Nf3', 'Nf6', 'Ng1', 'Ng8'].forEach((s) => r.move(s));
assert(r.isThreefold());
r.undo();
assert(!r.isThreefold());
assert.strictEqual(new Chess().move('e5'), null);

console.log('engine: all tests passed');
