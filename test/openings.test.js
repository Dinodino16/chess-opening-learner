// Run: node test/openings.test.js — every book line is legal and fully explained.
const assert = require('assert');
const Chess = require('../js/chess.js');
const { OPENINGS, FAMILIES } = require('../js/openings.js');

const ids = new Set();
for (const o of OPENINGS) {
  assert(!ids.has(o.id), `duplicate id ${o.id}`);
  ids.add(o.id);
  const g = new Chess();
  o.moves.forEach((san, i) => assert(g.move(san), `${o.name}: illegal move ${i + 1} "${san}"`));
  // A line should end on the player's own move, so the drill finishes with them.
  const lastMover = o.moves.length % 2 === 1 ? 'w' : 'b';
  assert.strictEqual(lastMover, o.side, `${o.name}: line should end on a ${o.side} move`);
  assert.strictEqual(o.ideas.length, o.moves.length, `${o.name}: ${o.ideas.length} ideas for ${o.moves.length} moves`);
  assert(o.intro && o.source && /^https:\/\//.test(o.source.url), `${o.name}: needs intro and source`);
  // Book SAN must match the engine's SAN exactly, or the trainer can't compare moves.
  assert.deepStrictEqual(g.history().map((s) => s.replace(/[+#]/g, '')), o.moves.map((s) => s.replace(/[+#]/g, '')), `${o.name}: SAN mismatch`);
}
for (const o of OPENINGS) assert(o.show >= 1 && o.show <= o.moves.length, `${o.name}: thumbnail move count out of range`);
for (const f of FAMILIES) {
  assert(f.variations.length && f.variations.every((v) => v.side === f.side), `${f.name}: bad family`);
  // The family thumbnail plays the first variation's moves, so they must be shared by every variation.
  const head = f.variations[0].moves.slice(0, f.show).join(' ');
  assert(f.show >= 1 && f.variations.every((v) => v.moves.slice(0, f.show).join(' ') === head), `${f.name}: thumbnail moves not shared`);
}

// The 3.Bc4 idea text claims the final position is the King's Gambit Declined one. Prove it.
const bc4 = new Chess();
OPENINGS.find((o) => o.id === 'vienna-bc4').moves.forEach((s) => bc4.move(s));
const kgd = new Chess();
'e4 e5 f4 Bc5 Nf3 d6 Nc3 Nf6 Bc4 Nc6 d3'.split(' ').forEach((s) => assert(kgd.move(s), s));
assert.strictEqual(bc4.fen().split(' ').slice(0, 4).join(' '), kgd.fen().split(' ').slice(0, 4).join(' '), '3.Bc4 line is not the KGD position');

console.log(`openings: ${OPENINGS.length} lines in ${FAMILIES.length} families, all legal`);
