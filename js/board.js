/*
 * Interactive board view. Knows nothing about chess rules: the owner tells it
 * where pieces are and which moves are allowed, and it reports moves back.
 *
 *   const view = new BoardView(el, { onMove: (from, to, promotion) => bool });
 *   view.set({ pieces, dests, turn, movable, lastMove, check });
 */
(function (root) {
  'use strict';

  const FILES = 'abcdefgh';
  const DRAG_THRESHOLD = 4; // px before a press turns into a drag
  const PROMOTION_ORDER = ['Q', 'N', 'R', 'B'];

  const nameOf = (i) => FILES[i & 7] + (8 - (i >> 3));
  const indexOf = (n) => (8 - Number(n[1])) * 8 + FILES.indexOf(n[0]);
  const isLight = (i) => (((i >> 3) + (i & 7)) & 1) === 0;

  class BoardView {
    constructor(el, opts = {}) {
      this.el = el;
      this.onMove = opts.onMove || (() => true);
      this.orientation = opts.orientation || 'w';
      this.state = { pieces: {}, dests: {}, turn: 'w', movable: 'w', lastMove: null, check: null, hint: null, arrow: null };
      this.selected = null;
      this.drag = null;
      this.pieceEls = new Map(); // square name -> element
      this.promo = null;

      el.classList.add('cb');
      el.innerHTML = '<div class="cb-squares"></div><div class="cb-pieces"></div>'
        + '<svg class="cb-arrows" viewBox="0 0 8 8" aria-hidden="true"></svg><div class="cb-overlay" hidden></div>';
      this.squaresEl = el.querySelector('.cb-squares');
      this.piecesEl = el.querySelector('.cb-pieces');
      this.overlayEl = el.querySelector('.cb-overlay');
      this.arrowsEl = el.querySelector('.cb-arrows');
      this.squareEls = [];
      for (let i = 0; i < 64; i++) {
        const s = document.createElement('div');
        this.squaresEl.appendChild(s);
        this.squareEls.push(s);
      }
      this._paintSquares();

      el.addEventListener('pointerdown', (e) => this._down(e));
      window.addEventListener('pointermove', (e) => this._move(e));
      window.addEventListener('pointerup', (e) => this._up(e));
      window.addEventListener('pointercancel', () => this._cancelDrag());
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ---------------------------------------------------------------- public

    set(next) {
      Object.assign(this.state, next);
      if (this.selected && !this._canMoveFrom(this.selected)) this.selected = null;
      this._syncPieces(next.animate !== false);
      this._paintHighlights();
    }

    /** Briefly mark a square red, e.g. where a rejected move was dropped. */
    flash(square) {
      const el = this._sqEl(square);
      el.classList.remove('wrong');
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add('wrong');
      el.addEventListener('animationend', () => el.classList.remove('wrong'), { once: true });
    }

    flip() {
      this.orientation = this.orientation === 'w' ? 'b' : 'w';
      this._paintSquares();
      this._syncPieces(false);
      this._paintHighlights();
    }

    // ---------------------------------------------------------------- geometry

    /** Visual cell (0..63, top-left first) for a square name, respecting orientation. */
    _cell(name) {
      const i = indexOf(name);
      return this.orientation === 'w' ? i : 63 - i;
    }

    _squareAt(clientX, clientY) {
      const r = this.el.getBoundingClientRect();
      const col = Math.floor(((clientX - r.left) / r.width) * 8);
      const row = Math.floor(((clientY - r.top) / r.height) * 8);
      if (col < 0 || col > 7 || row < 0 || row > 7) return null;
      const cell = row * 8 + col;
      return nameOf(this.orientation === 'w' ? cell : 63 - cell);
    }

    _place(el, name) {
      const cell = this._cell(name);
      el.style.transform = `translate(${(cell & 7) * 100}%, ${(cell >> 3) * 100}%)`;
    }

    // ---------------------------------------------------------------- rendering

    _paintSquares() {
      this.squareEls.forEach((s, cell) => {
        const name = nameOf(this.orientation === 'w' ? cell : 63 - cell);
        const idx = indexOf(name);
        s.className = 'cb-sq ' + (isLight(idx) ? 'light' : 'dark');
        s.dataset.square = name;
        s.innerHTML = '';
        // Ranks down the left edge, files along the bottom, like a printed board.
        if ((cell & 7) === 0) s.insertAdjacentHTML('beforeend', `<span class="cb-rank">${name[1]}</span>`);
        if ((cell >> 3) === 7) s.insertAdjacentHTML('beforeend', `<span class="cb-file">${name[0]}</span>`);
      });
    }

    _sqEl(name) {
      return this.squareEls[this._cell(name)];
    }

    _paintHighlights() {
      const { lastMove, check, hint } = this.state;
      for (const s of this.squareEls) s.classList.remove('last', 'selected', 'dest', 'capture', 'check', 'hover', 'hint');
      if (lastMove) {
        this._sqEl(lastMove.from).classList.add('last');
        this._sqEl(lastMove.to).classList.add('last');
      }
      if (check) this._sqEl(check).classList.add('check');
      if (hint) this._sqEl(hint).classList.add('hint');
      this._paintArrow();
      if (this.selected) {
        this._sqEl(this.selected).classList.add('selected');
        for (const to of this.state.dests[this.selected] || []) {
          this._sqEl(to).classList.add(this.state.pieces[to] ? 'capture' : 'dest');
        }
      }
    }

    /**
     * Draw state.arrow ({ from, to }) in board units: one square = 1. Knight moves
     * get an L (long leg first) so it is obvious which way the knight jumps.
     */
    _paintArrow() {
      const a = this.state.arrow;
      if (!a) { this.arrowsEl.innerHTML = ''; return; }
      const centre = (name) => {
        const cell = this._cell(name);
        return [(cell & 7) + 0.5, (cell >> 3) + 0.5];
      };
      const [x1, y1] = centre(a.from);
      const [x2, y2] = centre(a.to);
      const dx = x2 - x1, dy = y2 - y1;
      const pts = [[x1, y1]];
      const isKnight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
      if (isKnight) pts.push(Math.abs(dx) > Math.abs(dy) ? [x2, y1] : [x1, y2]);
      pts.push([x2, y2]);

      // Stop the shaft short of the tip so it doesn't poke through the head.
      const HEAD = 0.42, HALF = 0.24;
      const [px, py] = pts[pts.length - 2];
      const len = Math.hypot(x2 - px, y2 - py);
      const ux = (x2 - px) / len, uy = (y2 - py) / len;
      const tipX = x2 - ux * 0.08, tipY = y2 - uy * 0.08; // tip just inside the target square
      const baseX = tipX - ux * HEAD, baseY = tipY - uy * HEAD;
      const shaft = pts.slice(0, -1).concat([[baseX + ux * 0.02, baseY + uy * 0.02]]);
      const head = [[tipX, tipY], [baseX - uy * HALF, baseY + ux * HALF], [baseX + uy * HALF, baseY - ux * HALF]];
      const fmt = (p) => p.map((v) => v.toFixed(3)).join(',');
      this.arrowsEl.innerHTML = `<g class="cb-arrow"><polyline points="${shaft.map(fmt).join(' ')}"/>`
        + `<polygon points="${head.map(fmt).join(' ')}"/></g>`;
    }

    /**
     * Reconcile piece elements with state.pieces. Pieces that stay put are untouched;
     * a piece that disappeared from one square and appeared on another of the same kind
     * slides there. This handles moves, captures, castling, en passant and undo alike.
     */
    _syncPieces(animate) {
      const want = this.state.pieces;
      const old = this.pieceEls;
      const next = new Map();
      const orphans = [];

      for (const [sq, el] of old) {
        if (want[sq] === el.dataset.piece) next.set(sq, el);
        else orphans.push({ sq, el });
      }

      const arrivals = Object.keys(want).filter((sq) => !next.has(sq));
      for (const sq of arrivals) {
        const piece = want[sq];
        let best = -1, bestDist = Infinity;
        orphans.forEach((o, k) => {
          if (o.el.dataset.piece !== piece) return;
          const d = Math.abs(indexOf(o.sq) % 8 - indexOf(sq) % 8) + Math.abs((indexOf(o.sq) >> 3) - (indexOf(sq) >> 3));
          if (d < bestDist) { bestDist = d; best = k; }
        });

        let el;
        if (best >= 0) {
          el = orphans.splice(best, 1)[0].el;
          el.classList.toggle('anim', animate);
        } else {
          el = document.createElement('div');
          el.className = 'piece ' + piece;
          el.dataset.piece = piece;
          this._place(el, sq);
          this.piecesEl.appendChild(el);
          if (animate) {
            el.classList.add('appear');
            el.addEventListener('animationend', () => el.classList.remove('appear'), { once: true });
          }
        }
        this._place(el, sq);
        next.set(sq, el);
      }

      for (const { el } of orphans) {
        if (!animate) { el.remove(); continue; }
        el.classList.add('captured');
        setTimeout(() => el.remove(), 220);
      }

      if (!animate) for (const [sq, el] of next) { el.classList.remove('anim'); this._place(el, sq); }
      this.pieceEls = next;
    }

    // ---------------------------------------------------------------- input

    _canMoveFrom(sq) {
      const p = this.state.pieces[sq];
      const { movable, turn } = this.state;
      if (!p || p[0] !== turn) return false;
      if (movable !== 'both' && movable !== turn) return false;
      return (this.state.dests[sq] || []).length > 0;
    }

    _isDest(from, to) {
      return !!from && (this.state.dests[from] || []).includes(to);
    }

    _down(e) {
      if (e.button !== 0 || this.promo) return;
      const sq = this._squareAt(e.clientX, e.clientY);
      if (!sq) return;
      e.preventDefault();

      if (this.selected && this._isDest(this.selected, sq)) {
        this._attempt(this.selected, sq, true);
        return;
      }
      if (this._canMoveFrom(sq)) {
        const wasSelected = this.selected === sq;
        this.selected = sq;
        this._paintHighlights();
        this.drag = { from: sq, el: this.pieceEls.get(sq), x: e.clientX, y: e.clientY, started: false, wasSelected };
        this.el.setPointerCapture?.(e.pointerId);
        return;
      }
      this.selected = null;
      this._paintHighlights();
    }

    _move(e) {
      const d = this.drag;
      if (!d) return;
      if (!d.started) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
        d.started = true;
        d.el.classList.remove('anim');
        d.el.classList.add('dragging');
        this.el.classList.add('is-dragging');
      }
      const r = this.el.getBoundingClientRect();
      const size = r.width / 8;
      const x = e.clientX - r.left - size / 2;
      const y = e.clientY - r.top - size / 2;
      d.el.style.transform = `translate(${x}px, ${y}px)`;

      const over = this._squareAt(e.clientX, e.clientY);
      for (const s of this.squareEls) s.classList.remove('hover');
      if (over && this._isDest(d.from, over)) this._sqEl(over).classList.add('hover');
    }

    _up(e) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.el.classList.remove('is-dragging');
      d.el.classList.remove('dragging');

      if (!d.started) {
        // A plain click on the already-selected piece deselects it.
        if (d.wasSelected) { this.selected = null; this._paintHighlights(); }
        return;
      }
      const to = this._squareAt(e.clientX, e.clientY);
      if (to && this._isDest(d.from, to)) {
        this._attempt(d.from, to, false);
      } else {
        d.el.classList.add('anim');
        this._place(d.el, d.from);
        if (to !== d.from) { this.selected = null; }
        this._paintHighlights();
      }
    }

    _cancelDrag() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      this.el.classList.remove('is-dragging');
      d.el.classList.remove('dragging');
      this._place(d.el, d.from);
    }

    _attempt(from, to, animate) {
      const piece = this.state.pieces[from];
      const lastRank = piece[0] === 'w' ? '8' : '1';
      this.selected = null;
      if (piece[1] === 'P' && to[1] === lastRank) {
        if (!animate) this._placeTemp(from, to);
        this._askPromotion(from, to, piece[0]);
        return;
      }
      this._commit(from, to, undefined, animate);
    }

    _commit(from, to, promotion, animate) {
      const ok = this.onMove(from, to, promotion, { animate });
      if (!ok) this._snapBack(from);
    }

    /** Slide a piece that was dragged or provisionally placed back to its square. */
    _snapBack(from) {
      const el = this.pieceEls.get(from);
      if (el) { el.classList.add('anim'); this._place(el, from); }
      this._paintHighlights();
    }

    /** Leave a dropped pawn on its target square while the promotion picker is open. */
    _placeTemp(from, to) {
      const el = this.pieceEls.get(from);
      if (el) { el.classList.remove('anim'); this._place(el, to); }
    }

    _askPromotion(from, to, color) {
      const cell = this._cell(to);
      const col = cell & 7;
      const downward = (cell >> 3) === 0;
      this.promo = { from, to };
      this.overlayEl.hidden = false;
      this.overlayEl.innerHTML = '';
      PROMOTION_ORDER.forEach((type, k) => {
        const row = downward ? k : 7 - k;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cb-promo';
        b.style.left = col * 12.5 + '%';
        b.style.top = row * 12.5 + '%';
        b.setAttribute('aria-label', 'Promote to ' + { Q: 'queen', N: 'knight', R: 'rook', B: 'bishop' }[type]);
        b.innerHTML = `<span class="piece ${color}${type}"></span>`;
        b.addEventListener('click', (ev) => { ev.stopPropagation(); this._closePromotion(type); });
        this.overlayEl.appendChild(b);
      });
      this.overlayEl.onclick = () => this._closePromotion(null);
      this.overlayEl.querySelector('button').focus();
      this._paintHighlights();
    }

    _closePromotion(type) {
      const p = this.promo;
      this.promo = null;
      this.overlayEl.hidden = true;
      this.overlayEl.innerHTML = '';
      if (type) this._commit(p.from, p.to, type, false);
      else this._snapBack(p.from);
    }
  }

  root.BoardView = BoardView;
})(window);
