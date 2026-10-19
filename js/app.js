/*
 * App wiring: one Chess game on one BoardView, plus captured pieces, the move
 * strip and take-back. Both sides are played from this device for now; the
 * trainer's scripted opponent will plug in here.
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const boardEl = $('#board');
  const game = new Chess();
  let redo = []; // moves taken back, replayable with → until a new move is made

  const view = new BoardView(boardEl, { onMove: playFromBoard, onPremove: setPremove });

  // ---------------------------------------------------------------- sound

  /*
   * Sounds are decoded once into Web Audio buffers: playing a buffer starts within
   * a few ms, where an <audio> element adds 100-300 ms on phones. If fetch/decoding
   * is unavailable (e.g. opened from file://) it falls back to <audio>.
   */
  const Sound = (() => {
    const FILES = { move: 'sounds/move.mp3', capture: 'sounds/capture.mp3', check: 'sounds/check.mp3' };
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = AC ? new AC({ latencyHint: 'interactive' }) : null;
    const buffers = {};
    const fallback = {};

    for (const [name, src] of Object.entries(FILES)) {
      const el = new Audio(src);
      el.preload = 'auto';
      fallback[name] = el;
      if (!ctx) continue;
      fetch(src)
        .then((r) => r.arrayBuffer())
        .then((data) => new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail)))
        .then((buf) => { buffers[name] = buf; })
        .catch(() => { /* keep the <audio> fallback */ });
    }

    // Browsers start audio suspended; resume it inside the first real gesture so the
    // first move's sound isn't lost or late.
    const unlock = () => { if (ctx && ctx.state !== 'running') ctx.resume(); };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, unlock, { capture: true });

    function play(name) {
      const buf = buffers[name];
      if (buf && ctx.state === 'running') {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start();
        return;
      }
      const a = fallback[name];
      try {
        a.currentTime = 0;
        a.play().catch(() => { /* blocked until the first tap; nothing to do */ });
      } catch (_) { /* audio unavailable */ }
    }

    return {
      // Check outranks capture, capture outranks a plain move: one sound per move.
      forMove(move) {
        if (!move) return;
        if (/[+#]$/.test(move.san)) play('check');
        else if (move.flags.includes('c')) play('capture');
        else play('move');
      },
      takeback() { play('move'); },
    };
  })();

  // ---------------------------------------------------------------- trainer state

  // The opponent "thinks" for about a second, varied slightly so it doesn't feel mechanical.
  const opponentDelay = () => 900 + Math.random() * 400;

  let side = null;      // the player's colour; always drawn at the bottom
  let opening = null;   // the line being drilled
  let hintLevel = 0;    // hint presses on the current move: 1 = piece, 2 = piece + arrow
  let hintsUsed = {};   // ply index -> highest hint level used on that move (for the review)
  let ended = false;    // game finished (End game, mate or draw); the review is showing
  let premove = null;   // { from, to } queued while the opponent thinks
  let opponentTimer = 0;
  let reviewTimer = 0;

  const sameSan = (a, b) => a.replace(/[+#]/g, '') === b.replace(/[+#]/g, '');

  /** Number of opening plies played exactly as in the book. */
  function bookLength() {
    if (!opening) return 0;
    const h = game.history();
    let i = 0;
    while (i < h.length && i < opening.moves.length && sameSan(h[i], opening.moves[i])) i++;
    return i;
  }
  /** True while every move so far is book and the line still has moves left. */
  const inBook = () => !!opening && bookLength() === game.history().length && game.history().length < opening.moves.length;
  const expected = () => (inBook() ? opening.moves[game.history().length] : undefined);
  const playerMovesMade = () => {
    const n = game.history().length;
    return side === 'w' ? Math.ceil(n / 2) : Math.floor(n / 2);
  };

  const canPlay = () => !!opening && !ended && !game.isGameOver() && game.turn() === side;
  const canPremove = () => !!opening && !ended && !game.isGameOver() && game.turn() !== side;

  function setPremove(pm) {
    premove = pm && canPremove() ? pm : null;
    view.set({ premove });
  }

  /** Play the queued premove now that it's the player's turn. Returns whether it was legal. */
  function runPremove() {
    const pm = premove;
    premove = null;
    if (!pm || !canPlay()) { view.set({ premove: null }); return false; }
    if (playFromBoard(pm.from, pm.to, 'Q', { animate: true })) return true;
    view.set({ premove: null });
    return false;
  }

  /** What the board should show for hints right now: { hint: square, arrow: { from, to } }. */
  function hintState() {
    const want = expected();
    if (!hintLevel || !want || !canPlay()) return { hint: null, arrow: null };
    const m = game.moves().find((x) => sameSan(x.san, want));
    if (!m) return { hint: null, arrow: null };
    return { hint: m.from, arrow: hintLevel >= 2 ? { from: m.from, to: m.to } : null };
  }

  /** Hint button: first press shows the piece, second press shows where it goes. */
  function hint() {
    if (!canPlay() || !expected()) return;
    hintLevel = Math.min(2, hintLevel + 1);
    view.set(hintState());
    paintButtons();
  }

  /** Forget hint use for moves that are no longer on the board (after Back). */
  function pruneHints() {
    const n = game.history().length;
    for (const k of Object.keys(hintsUsed)) if (Number(k) >= n) delete hintsUsed[k];
  }

  // ---------------------------------------------------------------- moves

  /** Any legal move is allowed. Leaving the book is recorded, not blocked. */
  function playFromBoard(from, to, promotion, { animate }) {
    if (!canPlay()) return false;
    const want = expected();
    const ply = game.history().length;
    const m = game.move({ from, to, promotion });
    if (!m) return false;

    if (want && hintLevel) hintsUsed[ply] = hintLevel;
    hintLevel = 0;
    redo = [];
    Sound.forMove(m);
    render(animate);

    if (want && !sameSan(m.san, want)) {
      toast(`Out of book. The line continues ${moveLabel(ply, want)}.`);
    } else if (want && ply + 1 === opening.moves.length) {
      toast('Line complete. Play on, or end the game for a review.');
    }
    afterMove();
    return true;
  }

  const moveLabel = (ply, san) => `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}${san}`;

  /** After any forward step: the game may be over, otherwise the opponent replies. */
  function afterMove() {
    clearTimeout(opponentTimer);
    clearTimeout(reviewTimer);
    if (!opening || ended) return;
    if (game.isGameOver()) {
      ended = true;
      reviewTimer = setTimeout(showReview, 700);
      paintButtons();
      return;
    }
    if (game.turn() === side || redo.length) return;
    opponentTimer = setTimeout(() => {
      // Book move while the game is still in the line, the engine's choice after that.
      const want = expected();
      const m = want ? game.move(want) : game.move(game.bestMove({ depth: 3 }).san);
      Sound.forMove(m);
      render(true);
      if (!runPremove()) afterMove();
    }, opponentDelay());
  }

  /** Back: undo to the position before the player's previous move. */
  function takeBack() {
    if (!opening || !playerMovesMade()) return;
    clearTimeout(opponentTimer);
    clearTimeout(reviewTimer);
    clearOverlays();
    ended = false;
    premove = null;
    do {
      redo.push(game.undo().san);
    } while (game.turn() !== side);
    hintLevel = 0;
    pruneHints();
    Sound.takeback();
    render(true);
  }

  /** Forward: replay the player's move and the reply that followed it. */
  function replay() {
    if (!redo.length || ended) return;
    premove = null;
    let m;
    do {
      m = game.move(redo.pop());
    } while (redo.length && game.turn() !== side);
    hintLevel = 0;
    Sound.forMove(m);
    render(true);
    afterMove();
  }

  function endGame() {
    if (!opening || ended) return;
    clearTimeout(opponentTimer);
    ended = true;
    premove = null;
    render(false);
    showReview();
  }

  // ---------------------------------------------------------------- rendering

  function render(animate) {
    view.set(Object.assign({
      pieces: game.pieces(),
      dests: canPlay() ? game.dests() : {},
      turn: game.turn(),
      movable: side || 'none',
      lastMove: game.lastMove(),
      check: game.checkSquare(),
      premovable: canPremove(),
      premoveDests: canPremove() ? game.premoveDests(side) : {},
      premove,
      animate,
    }, hintState()));
    renderCaptures();
    renderMoves();
    renderIdea();
    paintButtons();
  }

  function paintButtons() {
    $('#undo').disabled = !opening || playerMovesMade() === 0;
    $('#forward').disabled = redo.length === 0 || ended;
    $('#end').hidden = !opening || ended;
    const h = $('#hint');
    h.disabled = !canPlay() || !expected() || hintLevel >= 2;
    h.dataset.level = String(hintLevel);
    h.setAttribute('aria-label', hintLevel === 0 ? 'Hint: show the piece to move' : 'Hint: show where it goes');
  }

  const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
  const ORDER = ['P', 'N', 'B', 'R', 'Q'];

  function renderCaptures() {
    const taken = { w: [], b: [] }; // pieces each side has captured
    for (const m of game.historyVerbose()) if (m.captured) taken[m.piece[0]].push(m.captured);

    // Advantage comes from what is on the board, so promotions count correctly.
    let material = 0;
    for (const p of Object.values(game.pieces())) material += (p[0] === 'w' ? 1 : -1) * VALUE[p[1]];

    const bottom = view.orientation;
    const top = bottom === 'w' ? 'b' : 'w';
    paintStrip($('#strip-top'), top, taken[top], material);
    paintStrip($('#strip-bottom'), bottom, taken[bottom], material);
  }

  function paintStrip(el, color, pieces, material) {
    let html = '';
    for (const type of ORDER) {
      const n = pieces.filter((p) => p[1] === type).length;
      if (!n) continue;
      html += '<span class="group">' + `<span class="piece ${pieces.find((p) => p[1] === type)}"></span>`.repeat(n) + '</span>';
    }
    const lead = color === 'w' ? material : -material;
    if (lead > 0) html += `<span class="adv">+${lead}</span>`;
    el.innerHTML = html;
    el.setAttribute('aria-label', `Pieces captured by ${color === 'w' ? 'White' : 'Black'}`);
  }

  function renderMoves() {
    const list = $('#moves');
    const sans = game.history();
    let html = '';
    sans.forEach((san, i) => {
      if (i % 2 === 0) html += `<li class="no">${i / 2 + 1}.</li>`;
      html += `<li class="mv${i === sans.length - 1 ? ' latest' : ''}">${san}</li>`;
    });
    list.innerHTML = html;
    list.scrollLeft = list.scrollWidth;
  }

  // ---------------------------------------------------------------- ideas

  let ideasOn = true;
  try { ideasOn = localStorage.getItem('ot-ideas') !== '0'; } catch (_) { /* storage blocked */ }

  function toggleIdeas() {
    ideasOn = !ideasOn;
    try { localStorage.setItem('ot-ideas', ideasOn ? '1' : '0'); } catch (_) { /* storage blocked */ }
    renderIdea();
  }

  /** Explain the move just played (or introduce the opening before the first move). */
  function renderIdea() {
    $('.game').classList.toggle('ideas-on', ideasOn);
    const btn = $('#ideas-btn');
    btn.setAttribute('aria-pressed', String(ideasOn));
    btn.setAttribute('aria-label', ideasOn ? 'Hide move explanations' : 'Explain each move');
    if (!ideasOn) return;

    const head = $('#idea-move'), text = $('#idea-text'), src = $('#idea-src');
    if (!opening) {
      head.textContent = '';
      text.textContent = 'Pick an opening and the idea behind each move will appear here.';
      src.innerHTML = '';
      return;
    }
    const n = game.history().length;
    const book = bookLength();
    if (n === 0) {
      head.innerHTML = `${esc(opening.title)}<span>${esc(opening.variation)}</span>`;
      text.textContent = opening.intro;
    } else {
      const i = n - 1;
      const mine = (i % 2 ? 'b' : 'w') === side;
      head.innerHTML = `${esc(moveLabel(i, game.history()[i]))}<span>${mine ? 'your move' : 'opponent'}${i >= book ? ' · out of book' : ''}</span>`;
      if (i < book) text.textContent = opening.ideas[i] || '';
      else if (book >= opening.moves.length) text.textContent = 'That was the last book move. From here you\'re playing on your own.';
      else if (i === book) text.textContent = `The book move was ${moveLabel(i, opening.moves[i])}. ${opening.ideas[i]}`;
      else text.textContent = `The game left the book at ${moveLabel(book, game.history()[book])}. The opponent is now choosing its own moves.`;
    }
    const s = opening.source;
    src.innerHTML = s
      ? `${s.kind === 'line' ? 'Line as given in' : 'Read more:'} <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`
      : '';
  }

  // ---------------------------------------------------------------- overlays

  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function clearOverlays() {
    boardEl.querySelectorAll('.chooser, .picker, .review').forEach((el) => el.remove());
  }

  /** Overlays sit on the board; stop their presses from reaching it. */
  function overlay(cls, html, label) {
    clearOverlays();
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', label);
    el.innerHTML = html;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    boardEl.appendChild(el);
    return el;
  }

  let toastTimer = 0;
  function toast(text) {
    let el = boardEl.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      boardEl.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // Step 1: colour.
  function showChooser() {
    clearTimeout(opponentTimer);
    clearTimeout(reviewTimer);
    opening = null;
    ended = false;
    premove = null;
    view.clearAnnotations();
    const el = overlay('chooser', '<p>Play as</p><div class="choices">'
      + '<button class="choice" type="button" data-color="w"><span class="piece wK"></span>White</button>'
      + '<button class="choice" type="button" data-color="b"><span class="piece bK"></span>Black</button>'
      + '</div>', 'Choose your colour');
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('.choice');
      if (!btn) return;
      side = btn.dataset.color;
      if (view.orientation !== side) view.flip();
      game.reset();
      redo = [];
      render(false);
      showPicker();
    });
    el.querySelector('.choice').focus();
  }

  // Step 2: opening. Families first (Vienna, Caro-Kann); tap one for its variations.
  // Typing searches every variation for the chosen colour directly.
  const BACK_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

  function variationButton(o, i, withFamily) {
    return `<li><button class="pick" type="button" data-v="${i}">
      <span class="pick-name">${esc(withFamily ? o.title : o.name)}</span>
      <span class="pick-meta">${esc(o.eco)} · ${esc(o.variation)}</span>
      <span class="pick-line">${esc(preview(o.moves))}</span>
    </button></li>`;
  }

  function showPicker(query = '') {
    const el = overlay('picker', `
      <div class="picker-head">
        <button class="picker-back" type="button" aria-label="Change colour">${BACK_ICON}</button>
        <span>Openings for ${side === 'w' ? 'White' : 'Black'}</span>
      </div>
      <input class="picker-search" id="opening-search" type="search" placeholder="Search openings" autocomplete="off" spellcheck="false" aria-label="Search openings">
      <ul class="picker-list" id="opening-list"></ul>`, 'Choose an opening');

    const input = el.querySelector('input');
    const list = el.querySelector('ul');
    const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const families = FAMILIES.filter((f) => f.side === side);
    let shown = [];   // variations currently listed (search mode)

    const paint = () => {
      const terms = norm(input.value).split(' ').filter(Boolean);
      if (!terms.length) {
        shown = [];
        list.innerHTML = families.map((f, i) => `<li><button class="pick family" type="button" data-f="${i}">
            <span class="pick-name">${esc(f.name)}</span>
            <span class="pick-meta">${esc(f.eco)} · ${f.variations.length} variation${f.variations.length === 1 ? '' : 's'}</span>
            <span class="pick-sum">${esc(f.summary)}</span>
          </button></li>`).join('');
        return;
      }
      shown = OPENINGS.filter((o) => o.side === side).filter((o) => {
        const hay = norm(`${o.familyName} ${o.name} ${o.variation} ${o.eco} ${o.line}`);
        return terms.every((t) => hay.includes(t));
      });
      list.innerHTML = shown.length
        ? shown.map((o, i) => variationButton(o, i, true)).join('')
        : `<li class="picker-empty">No openings match “${esc(input.value.trim())}”</li>`;
    };

    input.addEventListener('input', paint);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (shown.length) startOpening(shown[0]);
        else if (!input.value.trim() && families.length) showFamily(families[0], '');
      }
      if (e.key === 'Escape') showChooser();
    });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.pick');
      if (!b) return;
      if (b.dataset.f !== undefined) showFamily(families[Number(b.dataset.f)], input.value);
      else startOpening(shown[Number(b.dataset.v)]);
    });
    el.querySelector('.picker-back').addEventListener('click', showChooser);
    input.value = query;
    paint();
    input.focus({ preventScroll: true });
  }

  function showFamily(f, query) {
    const el = overlay('picker', `
      <div class="picker-head">
        <button class="picker-back" type="button" aria-label="All openings">${BACK_ICON}</button>
        <span>${esc(f.name)}</span>
      </div>
      <p class="picker-sum">${esc(f.summary)}</p>
      <ul class="picker-list">${f.variations.map((o, i) => variationButton(o, i, false)).join('')}</ul>`, `${f.name} variations`);
    el.querySelector('.picker-back').addEventListener('click', () => showPicker(query));
    el.querySelector('ul').addEventListener('click', (e) => {
      const b = e.target.closest('.pick');
      if (b) startOpening(f.variations[Number(b.dataset.v)]);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') showPicker(query); });
    el.querySelector('.pick').focus();
  }

  function preview(moves) {
    let out = '';
    for (let i = 0; i < Math.min(moves.length, 6); i++) out += (i % 2 ? ' ' : `${i ? ' ' : ''}${i / 2 + 1}. `) + moves[i];
    return moves.length > 6 ? out + ' …' : out;
  }

  // Step 3: drill the line.
  function startOpening(o) {
    opening = o;
    clearOverlays();
    game.reset();
    redo = [];
    hintLevel = 0;
    hintsUsed = {};
    ended = false;
    premove = null;
    view.clearAnnotations();
    render(false);
    toast(o.title);
    afterMove();
  }

  // ---------------------------------------------------------------- review

  /** How the player did in the opening: one row per own move inside the line. */
  function openingReport() {
    const h = game.history();
    const line = opening.moves;
    const book = bookLength();
    const rows = [];
    let total = 0;
    for (let i = side === 'w' ? 0 : 1; i < line.length; i += 2) {
      total++;
      if (i >= h.length || i > book) continue;
      if (i === book) rows.push({ i, status: 'left', played: h[i], book: line[i] });
      else rows.push({ i, status: hintsUsed[i] ? 'hint' : 'book', played: h[i], level: hintsUsed[i] });
    }
    const clean = rows.filter((r) => r.status === 'book').length;
    const hinted = rows.filter((r) => r.status === 'hint').length;
    const left = rows.find((r) => r.status === 'left');
    let verdict, detail;
    if (left) {
      verdict = `Left the book on move ${Math.floor(left.i / 2) + 1}`;
      detail = `You played ${moveLabel(left.i, left.played)}. ${opening.title} continues ${moveLabel(left.i, left.book)}.`;
    } else if (book >= line.length) {
      verdict = hinted ? 'Opening complete' : 'Perfect opening';
      detail = hinted
        ? `${clean} of ${total} moves from memory, ${hinted} with a hint.`
        : `All ${total} book moves played from memory.`;
    } else {
      verdict = 'Opening unfinished';
      detail = `You played ${rows.length} of ${total} book moves before the game ended.`;
    }
    return { rows, clean, total, verdict, detail, left };
  }

  function gameResultText() {
    const o = game.outcome();
    if (o.reason === 'checkmate') return `Checkmate · ${o.result === '1-0' ? 'White' : 'Black'} wins`;
    if (o.over) return `Draw by ${o.reason}`;
    return `Game ended after ${Math.ceil(game.history().length / 2)} moves`;
  }

  function showReview() {
    const r = openingReport();
    const rowHtml = r.rows.map((row) => {
      const label = esc(moveLabel(row.i, row.played));
      if (row.status === 'book') return `<li class="rv-row ok"><span class="rv-mark">✓</span><span class="rv-mv">${label}</span><span class="rv-note">Book</span></li>`;
      if (row.status === 'hint') return `<li class="rv-row hint"><span class="rv-mark">?</span><span class="rv-mv">${label}</span><span class="rv-note">Book, ${row.level >= 2 ? 'with the arrow hint' : 'with the piece hint'}</span></li>`;
      return `<li class="rv-row miss"><span class="rv-mark">✗</span><span class="rv-mv">${label}</span><span class="rv-note">Book: ${esc(moveLabel(row.i, row.book))}</span></li>`
        + `<li class="rv-idea">${esc(opening.ideas[row.i])}</li>`;
    }).join('');

    const el = overlay('review', `
      <p class="rv-result">${esc(gameResultText())}</p>
      <div class="rv-score"><b>${r.clean}<span>/${r.total}</span></b><div><p class="rv-verdict">${esc(r.verdict)}</p><p class="rv-detail">${esc(r.detail)}</p></div></div>
      <p class="rv-title">${esc(opening.title)} · your moves</p>
      <ol class="rv-list">${rowHtml || '<li class="rv-empty">You didn\'t play any moves in the opening.</li>'}</ol>
      <div class="rv-actions">
        ${game.isGameOver() ? '' : '<button class="choice" type="button" data-act="back">Back to game</button>'}
        <button class="choice" type="button" data-act="again">Try again</button>
        <button class="choice" type="button" data-act="new">New opening</button>
      </div>`, 'Game review');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.choice');
      if (!b) return;
      if (b.dataset.act === 'back') { clearOverlays(); ended = false; render(false); afterMove(); }
      else if (b.dataset.act === 'again') startOpening(opening);
      else showChooser();
    });
    el.querySelector('.choice').focus();
  }

  // ---------------------------------------------------------------- input

  $('#undo').addEventListener('click', takeBack);
  $('#forward').addEventListener('click', replay);
  $('#hint').addEventListener('click', hint);
  $('#ideas-btn').addEventListener('click', toggleIdeas);
  $('#end').addEventListener('click', endGame);

  // ← take back, → replay, H hint, I ideas (not while typing in the search box).
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); takeBack(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); replay(); }
    else if (e.key === 'h' || e.key === 'H') hint();
    else if (e.key === 'i' || e.key === 'I') toggleIdeas();
  });

  // ---------------------------------------------------------------- boot

  function start(saved) {
    const o = saved && OPENINGS.find((x) => x.id === saved.openingId);
    if (o && saved.side === o.side) {
      side = o.side;
      opening = o;
      if (view.orientation !== side) view.flip();
      (saved.moves || []).forEach((s) => game.move(s));
      hintsUsed = saved.hintsUsed || {};
      render(false);
      afterMove();
      return;
    }
    render(false);
    showChooser();
  }

  window.claude?.hot?.snapshot?.(() => (opening ? { side, openingId: opening.id, moves: game.history(), hintsUsed } : {}));
  if (window.claude?.hot?.ready) window.claude.hot.ready(start);
  else start(window.claude?.hot?.data ?? {});
})();
