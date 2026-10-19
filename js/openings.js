/*
 * Opening book. Each entry is one line in SAN, played from the start position.
 * `side` is the colour the player trains as; the trainer plays the other side.
 *
 * `ideas[i]` explains `moves[i]`. They are written for this trainer from general
 * opening principles, not quoted. `source` says what an external reference covers:
 *   kind 'line'    - the reference gives this move sequence
 *   kind 'reading' - background on the opening; not checked against this exact line
 */
(function (root) {
  'use strict';

  const OPENINGS = [
    {
      id: 'vienna',
      name: 'Vienna Game',
      variation: 'Vienna Gambit, 5.Nf3 Be7',
      eco: 'C29',
      side: 'w',
      line: 'e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Be7 d4 O-O Bd3 f5 exf6 Bxf6 O-O',
      intro: 'White develops the queen\'s knight first so the f-pawn stays free, then strikes with f4 for open lines and quick development.',
      ideas: [
        'Claims the centre and opens lines for the queen and the light-squared bishop.',
        'Black takes an equal share of the centre and stops White from playing e4–e5 for free.',
        'The Vienna move. The knight develops and guards e4, but unlike 2.Nf3 it leaves the f-pawn free to advance to f4.',
        'Black\'s most active reply: it develops and attacks e4, getting ready to hit back with ...d5.',
        'The Vienna Gambit. Like a King\'s Gambit with Nc3 already played: White attacks e5 to open the f-file and gain central space.',
        'Black counters in the centre instead of grabbing the pawn. Taking with 3...exf4 would allow 4.e5, chasing the knight away.',
        'White takes on e5. The pawn gains space and takes the f6 square away from Black\'s knight.',
        'The knight jumps to a strong central square, supported by the d5 pawn, and hits White\'s knight on c3.',
        'Develops, protects the e5 pawn and prepares d4 to build a broad centre.',
        'Quiet development: the bishop clears the way for Black to castle.',
        'White builds the centre, supports e5 a second time and opens the diagonal for the c1 bishop.',
        'Black gets the king to safety before the centre opens up.',
        'Develops towards the kingside and adds pressure on the knight on e4.',
        'Shores up the e4 knight with a pawn so it can\'t be easily chased or exchanged.',
        'En passant. White removes the pawn that guarded e4 and opens the f-file for the rook once White castles.',
        'The bishop recaptures and lands on an open diagonal aimed at d4.',
        'White castles, putting the king safe and a rook straight onto the open f-file.',
      ],
      source: { kind: 'reading', label: 'Wikipedia: Vienna Game', url: 'https://en.wikipedia.org/wiki/Vienna_Game' },
    },
    {
      id: 'caro-kann',
      name: 'Caro-Kann Defence',
      variation: 'Classical, 4...Bf5',
      eco: 'B18',
      side: 'b',
      line: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3 Qxd3 e6',
      intro: 'A solid defence: Black challenges e4 with ...d5 backed by ...c6, and gets the light-squared bishop out before closing the position with ...e6.',
      ideas: [
        'Claims the centre and opens lines for the queen and the light-squared bishop.',
        'The Caro-Kann. ...c6 prepares ...d5, so if White ever takes on d5 Black recaptures with a pawn and keeps a foothold in the centre. Unlike the French (1...e6), it doesn\'t shut in the light-squared bishop.',
        'White takes the full centre with two pawns.',
        'The point of 1...c6: Black challenges e4 straight away.',
        'White defends e4 by developing a piece rather than pushing past it.',
        'Black releases the tension. With White\'s e-pawn gone, Black gets an easy, solid position with no weaknesses.',
        'The knight recaptures on a strong central square.',
        'The Classical Variation. The bishop comes out before ...e6 locks it in, and it attacks the knight on e4.',
        'The knight steps away, gaining time by attacking the bishop.',
        'The bishop retreats but keeps its place on the b1–h7 diagonal.',
        'White threatens h4–h5 to harass the bishop on g6, and grabs space on the kingside.',
        'Makes room on h7, so when White plays h5 the bishop can drop back without being trapped.',
        'Develops and eyes e5, where the knight would attack the bishop on g6.',
        'Covers e5 so White\'s knight can\'t jump in, and keeps ...Ngf6 for next.',
        'White gains more space, fixes Black\'s kingside pawns and forces the bishop off g6.',
        'The bishop retreats to h7, still aiming down the same diagonal.',
        'White offers to swap off Black\'s best minor piece, the bishop that has been active since move 4.',
        'Black takes rather than let the bishop be shut in on h7.',
        'The queen recaptures on a central square. From here White usually develops with Bf4 or Bd2 and castles queenside.',
        'With the bishop already outside the pawn chain, ...e6 costs nothing: it frees the f8 bishop and builds a solid centre.',
      ],
      source: { kind: 'line', label: 'Wikipedia: Caro–Kann Defence', url: 'https://en.wikipedia.org/wiki/Caro%E2%80%93Kann_Defence' },
    },
  ].map((o) => Object.assign(o, { moves: o.line.split(' ') }));

  if (typeof module !== 'undefined' && module.exports) module.exports = OPENINGS;
  else root.OPENINGS = OPENINGS;
})(typeof self !== 'undefined' ? self : this);
