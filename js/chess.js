/*
 * Chess rules engine. No DOM, no dependencies.
 *
 * Squares are indexed 0..63 in FEN order: a8 = 0, h8 = 7, a1 = 56, h1 = 63.
 * Pieces are two-char strings: colour + type, e.g. 'wP', 'bK'.
 */
(function (root) {
  'use strict';

  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const FILES = 'abcdefgh';

  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // Losing a rook from (or capturing on) one of these squares kills that castling right.
  const ROOK_CORNERS = { 56: 'Q', 63: 'K', 0: 'q', 7: 'k' };

  const sqName = (s) => FILES[s & 7] + (8 - (s >> 3));
  const sqIndex = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
  const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1);
  const other = (c) => (c === 'w' ? 'b' : 'w');

  class Chess {
    constructor(fen = START_FEN) {
      this.load(fen);
    }

    // ---------------------------------------------------------------- setup

    load(fen) {
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 4) throw new Error('Invalid FEN: ' + fen);
      const [placement, turn, castling, ep, half = '0', full = '1'] = parts;

      const rows = placement.split('/');
      if (rows.length !== 8) throw new Error('Invalid FEN placement: ' + placement);
      const board = new Array(64).fill(null);
      rows.forEach((row, r) => {
        let c = 0;
        for (const ch of row) {
          if (/[1-8]/.test(ch)) c += Number(ch);
          else if (/[pnbrqkPNBRQK]/.test(ch)) {
            if (c > 7) throw new Error('Invalid FEN row: ' + row);
            board[r * 8 + c] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
            c++;
          } else throw new Error('Invalid FEN character: ' + ch);
        }
        if (c !== 8) throw new Error('Invalid FEN row: ' + row);
      });
      if (turn !== 'w' && turn !== 'b') throw new Error('Invalid FEN turn: ' + turn);

      this._board = board;
      this._turn = turn;
      this._castling = {
        K: castling.includes('K'), Q: castling.includes('Q'),
        k: castling.includes('k'), q: castling.includes('q'),
      };
      this._ep = ep === '-' ? -1 : sqIndex(ep);
      this._half = Number(half) || 0;
      this._full = Number(full) || 1;
      this._stack = [];
      this._sans = [];
      this._reps = new Map();
      this._bumpRep(1);
      return this;
    }

    reset() {
      return this.load(START_FEN);
    }

    fen() {
      let placement = '';
      for (let r = 0; r < 8; r++) {
        let empty = 0;
        for (let c = 0; c < 8; c++) {
          const p = this._board[r * 8 + c];
          if (!p) { empty++; continue; }
          if (empty) { placement += empty; empty = 0; }
          placement += p[0] === 'w' ? p[1] : p[1].toLowerCase();
        }
        if (empty) placement += empty;
        if (r < 7) placement += '/';
      }
      const cr = ['K', 'Q', 'k', 'q'].filter((k) => this._castling[k]).join('') || '-';
      const ep = this._ep >= 0 ? sqName(this._ep) : '-';
      return `${placement} ${this._turn} ${cr} ${ep} ${this._half} ${this._full}`;
    }

    // ---------------------------------------------------------------- queries

    turn() { return this._turn; }
    get(square) { return this._board[typeof square === 'string' ? sqIndex(square) : square]; }

    /** Map of square name -> piece for every occupied square. */
    pieces() {
      const out = {};
      this._board.forEach((p, i) => { if (p) out[sqName(i)] = p; });
      return out;
    }

    history() { return this._sans.slice(); }
    historyVerbose() { return this._stack.map((u) => this._publicMove(u.move, u.san)); }
    lastMove() {
      const u = this._stack[this._stack.length - 1];
      return u ? this._publicMove(u.move, u.san) : null;
    }

    inCheck() {
      return this._attacked(this._kingSq(this._turn), other(this._turn));
    }

    /** King square name of the side to move when in check, else null. */
    checkSquare() {
      return this.inCheck() ? sqName(this._kingSq(this._turn)) : null;
    }

    isCheckmate() { return this.inCheck() && this._legal().length === 0; }
    isStalemate() { return !this.inCheck() && this._legal().length === 0; }
    isFiftyMoves() { return this._half >= 100; }
    isThreefold() { return (this._reps.get(this._repKey()) || 0) >= 3; }

    isInsufficientMaterial() {
      const minors = [];
      for (let i = 0; i < 64; i++) {
        const p = this._board[i];
        if (!p || p[1] === 'K') continue;
        if (p[1] === 'P' || p[1] === 'R' || p[1] === 'Q') return false;
        minors.push({ type: p[1], shade: ((i >> 3) + (i & 7)) & 1 });
      }
      if (minors.length <= 1) return true;
      // Any number of bishops, all on the same colour squares, can never mate.
      return minors.every((m) => m.type === 'B' && m.shade === minors[0].shade);
    }

    isDraw() {
      return this.isStalemate() || this.isFiftyMoves() || this.isThreefold() || this.isInsufficientMaterial();
    }

    isGameOver() { return this.isCheckmate() || this.isDraw(); }

    /**
     * Summary of the game state:
     * { over, result: '1-0' | '0-1' | '1/2-1/2' | '*', reason }
     */
    outcome() {
      if (this.isCheckmate()) return { over: true, result: this._turn === 'w' ? '0-1' : '1-0', reason: 'checkmate' };
      if (this.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' };
      if (this.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
      if (this.isThreefold()) return { over: true, result: '1/2-1/2', reason: 'threefold repetition' };
      if (this.isFiftyMoves()) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule' };
      return { over: false, result: '*', reason: null };
    }

    /**
     * Legal moves for the side to move. Options: { square: 'e2' } to restrict.
     * Each move: { from, to, piece, captured?, promotion?, san, flags }
     */
    moves({ square } = {}) {
      const legal = this._legal();
      const from = square ? sqIndex(square) : -1;
      return legal
        .filter((m) => from < 0 || m.from === from)
        .map((m) => this._publicMove(m, this._san(m, legal)));
    }

    /** Map of from-square -> [to-squares] for the side to move. Cheap; no SAN. */
    dests() {
      const out = {};
      for (const m of this._legal()) {
        const f = sqName(m.from);
        (out[f] = out[f] || []);
        const t = sqName(m.to);
        if (!out[f].includes(t)) out[f].push(t);
      }
      return out;
    }

    // ---------------------------------------------------------------- moving

    /**
     * Play a move. Accepts SAN ('Nf3', 'exd5', 'O-O', 'e8=Q+'), UCI ('e2e4', 'e7e8q')
     * or { from, to, promotion }. Returns the played move, or null if illegal.
     */
    move(input) {
      const legal = this._legal();
      let m = null;

      if (typeof input === 'string') {
        const s = input.trim();
        const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(s);
        if (uci) {
          m = this._pick(legal, uci[1], uci[2], uci[3]);
        } else {
          const want = normaliseSan(s);
          m = legal.find((x) => normaliseSan(this._san(x, legal)) === want) || null;
        }
      } else if (input && input.from && input.to) {
        m = this._pick(legal, input.from, input.to, input.promotion);
      }
      if (!m) return null;

      const san = this._san(m, legal);
      this._make(m);
      this._stack[this._stack.length - 1].san = san;
      this._sans.push(san);
      this._bumpRep(1);
      return this._publicMove(m, san);
    }

    undo() {
      if (!this._stack.length) return null;
      this._bumpRep(-1);
      const u = this._stack[this._stack.length - 1];
      this._unmake();
      this._sans.pop();
      return this._publicMove(u.move, u.san);
    }

    // ---------------------------------------------------------------- internals

    _pick(legal, from, to, promotion) {
      const f = sqIndex(from), t = sqIndex(to);
      const promo = promotion ? promotion.toUpperCase() : null;
      const hits = legal.filter((m) => m.from === f && m.to === t);
      if (!hits.length) return null;
      if (hits[0].promotion) return hits.find((m) => m.promotion === (promo || 'Q')) || null;
      return hits[0];
    }

    _publicMove(m, san) {
      const out = { from: sqName(m.from), to: sqName(m.to), piece: m.piece, san, flags: '' };
      if (m.captured) { out.captured = m.captured; out.flags += 'c'; }
      if (m.promotion) { out.promotion = m.promotion; out.flags += 'p'; }
      if (m.ep) out.flags += 'e';
      if (m.castle) out.flags += m.castle === 'K' ? 'k' : 'q';
      if (m.double) out.flags += 'b';
      return out;
    }

    _kingSq(color) {
      return this._board.indexOf(color + 'K');
    }

    /** Is square `sq` attacked by any piece of colour `by`? */
    _attacked(sq, by) {
      if (sq < 0) return false;
      const b = this._board;
      const r = sq >> 3, c = sq & 7;

      // Pawns: white pawns attack upward (toward row 0), so they sit one row below.
      const pr = by === 'w' ? r + 1 : r - 1;
      for (const dc of [-1, 1]) {
        const s = at(pr, c + dc);
        if (s >= 0 && b[s] === by + 'P') return true;
      }
      for (const [dr, dc] of KNIGHT) {
        const s = at(r + dr, c + dc);
        if (s >= 0 && b[s] === by + 'N') return true;
      }
      for (const [dr, dc] of KING) {
        const s = at(r + dr, c + dc);
        if (s >= 0 && b[s] === by + 'K') return true;
      }
      const slide = (dirs, a, q) => {
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc, s;
          while ((s = at(rr, cc)) >= 0) {
            const p = b[s];
            if (p) {
              if (p === a || p === q) return true;
              break;
            }
            rr += dr; cc += dc;
          }
        }
        return false;
      };
      return slide(ORTHO, by + 'R', by + 'Q') || slide(DIAG, by + 'B', by + 'Q');
    }

    _pseudo() {
      const b = this._board, us = this._turn, them = other(us);
      const out = [];
      const push = (from, to, extra) => {
        const m = { from, to, piece: b[from] };
        if (b[to]) m.captured = b[to];
        out.push(extra ? Object.assign(m, extra) : m);
      };

      for (let from = 0; from < 64; from++) {
        const p = b[from];
        if (!p || p[0] !== us) continue;
        const r = from >> 3, c = from & 7, type = p[1];

        if (type === 'P') {
          const dir = us === 'w' ? -1 : 1;
          const startRow = us === 'w' ? 6 : 1;
          const lastRow = us === 'w' ? 0 : 7;
          const addPawn = (to, extra) => {
            if ((to >> 3) === lastRow) {
              for (const promotion of ['Q', 'R', 'B', 'N']) push(from, to, Object.assign({ promotion }, extra));
            } else push(from, to, extra);
          };
          const one = at(r + dir, c);
          if (one >= 0 && !b[one]) {
            addPawn(one);
            const two = at(r + 2 * dir, c);
            if (r === startRow && !b[two]) push(from, two, { double: true });
          }
          for (const dc of [-1, 1]) {
            const t = at(r + dir, c + dc);
            if (t < 0) continue;
            if (b[t] && b[t][0] === them) addPawn(t);
            else if (t === this._ep) push(from, t, { ep: true, captured: them + 'P' });
          }
          continue;
        }

        if (type === 'N' || type === 'K') {
          for (const [dr, dc] of type === 'N' ? KNIGHT : KING) {
            const t = at(r + dr, c + dc);
            if (t >= 0 && (!b[t] || b[t][0] === them)) push(from, t);
          }
          if (type === 'K') this._castles(from, out);
          continue;
        }

        const dirs = type === 'R' ? ORTHO : type === 'B' ? DIAG : ORTHO.concat(DIAG);
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc, t;
          while ((t = at(rr, cc)) >= 0) {
            if (b[t]) {
              if (b[t][0] === them) push(from, t);
              break;
            }
            push(from, t);
            rr += dr; cc += dc;
          }
        }
      }
      return out;
    }

    _castles(kingFrom, out) {
      const us = this._turn, them = other(us), b = this._board;
      const home = us === 'w' ? 60 : 4;
      if (kingFrom !== home) return;
      const [kRight, qRight] = us === 'w' ? ['K', 'Q'] : ['k', 'q'];
      if (!this._castling[kRight] && !this._castling[qRight]) return;
      if (this._attacked(home, them)) return;

      if (this._castling[kRight] && b[home + 3] === us + 'R' && !b[home + 1] && !b[home + 2]
        && !this._attacked(home + 1, them) && !this._attacked(home + 2, them)) {
        out.push({ from: home, to: home + 2, piece: us + 'K', castle: 'K' });
      }
      if (this._castling[qRight] && b[home - 4] === us + 'R' && !b[home - 1] && !b[home - 2] && !b[home - 3]
        && !this._attacked(home - 1, them) && !this._attacked(home - 2, them)) {
        out.push({ from: home, to: home - 2, piece: us + 'K', castle: 'Q' });
      }
    }

    _legal() {
      const us = this._turn, them = other(us);
      return this._pseudo().filter((m) => {
        this._make(m);
        const ok = !this._attacked(this._kingSq(us), them);
        this._unmake();
        return ok;
      });
    }

    _make(m) {
      const b = this._board, us = this._turn;
      this._stack.push({
        move: m, castling: Object.assign({}, this._castling),
        ep: this._ep, half: this._half, full: this._full, san: null,
      });

      b[m.to] = m.promotion ? us + m.promotion : m.piece;
      b[m.from] = null;
      if (m.ep) b[m.to + (us === 'w' ? 8 : -8)] = null;
      if (m.castle === 'K') { b[m.from + 1] = b[m.from + 3]; b[m.from + 3] = null; }
      if (m.castle === 'Q') { b[m.from - 1] = b[m.from - 4]; b[m.from - 4] = null; }

      if (m.piece[1] === 'K') {
        if (us === 'w') this._castling.K = this._castling.Q = false;
        else this._castling.k = this._castling.q = false;
      }
      for (const s of [m.from, m.to]) {
        const right = ROOK_CORNERS[s];
        if (right) this._castling[right] = false;
      }

      this._ep = m.double ? (m.from + m.to) / 2 : -1;
      this._half = m.piece[1] === 'P' || m.captured ? 0 : this._half + 1;
      if (us === 'b') this._full++;
      this._turn = other(us);
    }

    _unmake() {
      const u = this._stack.pop();
      const m = u.move, b = this._board;
      const us = other(this._turn);

      b[m.from] = m.piece;
      b[m.to] = m.ep ? null : (m.captured || null);
      if (m.ep) b[m.to + (us === 'w' ? 8 : -8)] = m.captured;
      if (m.castle === 'K') { b[m.from + 3] = b[m.from + 1]; b[m.from + 1] = null; }
      if (m.castle === 'Q') { b[m.from - 4] = b[m.from - 1]; b[m.from - 1] = null; }

      this._castling = u.castling;
      this._ep = u.ep;
      this._half = u.half;
      this._full = u.full;
      this._turn = us;
    }

    _san(m, legal) {
      let san;
      if (m.castle) {
        san = m.castle === 'K' ? 'O-O' : 'O-O-O';
      } else {
        const type = m.piece[1];
        const to = sqName(m.to);
        if (type === 'P') {
          san = (m.captured ? FILES[m.from & 7] + 'x' : '') + to + (m.promotion ? '=' + m.promotion : '');
        } else {
          const rivals = legal.filter((x) => x !== m && x.piece === m.piece && x.to === m.to && x.from !== m.from);
          let dis = '';
          if (rivals.length) {
            const sameFile = rivals.some((x) => (x.from & 7) === (m.from & 7));
            const sameRank = rivals.some((x) => (x.from >> 3) === (m.from >> 3));
            if (!sameFile) dis = FILES[m.from & 7];
            else if (!sameRank) dis = String(8 - (m.from >> 3));
            else dis = sqName(m.from);
          }
          san = type + dis + (m.captured ? 'x' : '') + to;
        }
      }
      this._make(m);
      if (this.inCheck()) san += this._legal().length ? '+' : '#';
      this._unmake();
      return san;
    }

    _repKey() {
      // The en passant square only matters for repetition if the capture is actually available.
      const f = this.fen().split(' ');
      const epLive = this._ep >= 0 && this._legal().some((m) => m.ep);
      return `${f[0]} ${f[1]} ${f[2]} ${epLive ? f[3] : '-'}`;
    }

    _bumpRep(delta) {
      const k = this._repKey();
      const n = (this._reps.get(k) || 0) + delta;
      if (n > 0) this._reps.set(k, n); else this._reps.delete(k);
    }

    /** Node count to `depth`. Used to verify move generation against known values. */
    perft(depth) {
      if (depth === 0) return 1;
      const legal = this._legal();
      if (depth === 1) return legal.length;
      let n = 0;
      for (const m of legal) {
        this._make(m);
        n += this.perft(depth - 1);
        this._unmake();
      }
      return n;
    }
  }

  function normaliseSan(s) {
    return s.replace(/[+#?!]/g, '').replace(/0/g, 'O').replace(/=?([QRBN])$/, '=$1');
  }

  Chess.START_FEN = START_FEN;
  Chess.squareName = sqName;
  Chess.squareIndex = sqIndex;

  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
  else root.Chess = Chess;
})(typeof self !== 'undefined' ? self : this);
