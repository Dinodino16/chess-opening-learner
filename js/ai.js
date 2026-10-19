/*
 * A small opponent for when the game leaves the book: alpha-beta search with a
 * capture-only quiescence search, scored by material plus piece-square tables.
 * It plays sensible club-level moves and punishes hanging pieces; it is not strong.
 *
 * Adds Chess.prototype.bestMove({ depth }) -> public move object, or null.
 */
(function (root) {
  'use strict';

  const Chess = root.Chess || (typeof require !== 'undefined' ? require('./chess.js') : null);

  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const MATE = 100000;

  // Piece-square tables from White's point of view, a8 first (FEN order).
  // Black uses the same table mirrored vertically (index ^ 56).
  const PST = {
    P: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    N: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    B: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    R: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0,
    ],
    Q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    K: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
  };

  /** Static score from the side to move's point of view. */
  function evaluate(g) {
    let score = 0;
    const b = g._board;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p) continue;
      const v = VALUE[p[1]] + PST[p[1]][p[0] === 'w' ? i : i ^ 56];
      score += p[0] === 'w' ? v : -v;
    }
    return g._turn === 'w' ? score : -score;
  }

  // Captures first, most valuable victim / least valuable attacker; promotions too.
  const orderScore = (m) => (m.captured ? 10 * VALUE[m.captured[1]] - VALUE[m.piece[1]] + 1000 : 0)
    + (m.promotion ? VALUE[m.promotion] : 0);
  const ordered = (moves) => moves.sort((a, b) => orderScore(b) - orderScore(a));

  /** Make m if it doesn't leave the mover's king in check; returns whether it was made. */
  function tryMake(g, m) {
    const us = g._turn;
    g._make(m);
    if (g._attacked(g._kingSq(us), g._turn)) { g._unmake(); return false; }
    return true;
  }

  function quiesce(g, alpha, beta, depth) {
    const stand = evaluate(g);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth === 0) return alpha;
    for (const m of ordered(g._pseudo().filter((x) => x.captured || x.promotion))) {
      if (!tryMake(g, m)) continue;
      const s = -quiesce(g, -beta, -alpha, depth - 1);
      g._unmake();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    return alpha;
  }

  function search(g, depth, alpha, beta, ply) {
    if (depth === 0) return quiesce(g, alpha, beta, 4);
    let any = false;
    for (const m of ordered(g._pseudo())) {
      if (!tryMake(g, m)) continue;
      any = true;
      const s = -search(g, depth - 1, -beta, -alpha, ply + 1);
      g._unmake();
      if (s >= beta) return beta;
      if (s > alpha) alpha = s;
    }
    if (!any) return g.inCheck() ? -MATE + ply : 0;
    return alpha;
  }

  Chess.prototype.bestMove = function ({ depth = 3, variety = 15 } = {}) {
    const legal = this._legal();
    if (!legal.length) return null;
    // Moves more than `variety` below the best so far can't be picked, so they only
    // need to be proven worse (fail low), not scored exactly.
    let best = -MATE - 1;
    const scored = [];
    for (const m of ordered(legal.slice())) {
      const floor = Math.max(best - variety - 1, -MATE - 1);
      this._make(m);
      const s = -search(this, depth - 1, -MATE - 1, -floor, 1);
      this._unmake();
      if (s > floor) scored.push({ m, s });
      if (s > best) best = s;
    }
    // Pick randomly among moves within `variety` centipawns of the best, so it isn't predictable.
    const pool = scored.filter((x) => x.s >= best - variety);
    const pick = pool[Math.floor(Math.random() * pool.length)].m;
    return this._publicMove(pick, this._san(pick, legal));
  };
})(typeof self !== 'undefined' ? self : this);
