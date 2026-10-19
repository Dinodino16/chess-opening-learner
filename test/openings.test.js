// Run: node test/openings.test.js — every book line must be legal from the start.
const assert = require('assert');
const Chess = require('../js/chess.js');
const OPENINGS = require('../js/openings.js');

for (const o of OPENINGS) {
  const g = new Chess();
  o.moves.forEach((san, i) => assert(g.move(san), `${o.name}: illegal move ${i + 1} "${san}"`));
  // A line should end on the player's own move, so the drill finishes with them.
  const lastMover = o.moves.length % 2 === 1 ? 'w' : 'b';
  assert.strictEqual(lastMover, o.side, `${o.name}: line should end on a ${o.side} move`);
  assert.strictEqual(o.ideas.length, o.moves.length, `${o.name}: ${o.ideas.length} ideas for ${o.moves.length} moves`);
  assert(o.intro && o.source && /^https:\/\//.test(o.source.url), `${o.name}: needs intro and source`);
  assert.deepStrictEqual(g.history().map((s) => s.replace(/[+#]/g, '')), o.moves.map((s) => s.replace(/[+#]/g, '')), `${o.name}: SAN mismatch`);
}
console.log(`openings: ${OPENINGS.length} lines legal`);
