import type { GameMap } from './types';

/**
 * A lake with an island in the middle of it, and a pond off to one side.
 *
 * The island is the point: it is ringed by water, and what water costs is what
 * the board is about. Infantry wades in at 2 and crosses in a single turn.
 * Cavalry pays 3, which is most of its budget, so it arrives in **two** turns
 * and spends the night between them standing in open water at zero defence --
 * measured, not assumed. Artillery cannot enter at any price and never reaches
 * the island at all.
 *
 * ⚠️ **This used to be a wall and is now a toll**, because `horse` went from
 * `null` to 3 in the river row. The island was "ground cavalry cannot reach at
 * any price"; it is now "ground cavalry reaches exposed and late", which is a
 * better shape -- a price rather than a rule -- but it is a different board
 * from the one this map was drawn for.
 *
 * Everything else goes round. The lake leaves a lane down each flank, which is
 * what keeps the board crossable for wheels without a bridge on it anywhere.
 *
 * ⚠️ **The pond sits clear of both deployment zones, and has to.** It was one
 * row further out, inside the far player's, where `wheels` cannot enter at any
 * price -- so an army that put a gun on that square stranded it before the
 * first turn. Nothing caught it while boards were validated against a single
 * formation, because the one army in existence happened not to stand there;
 * `maps.test.ts` now checks every square a player may fill. Row 8 is not an
 * alternative: it touches the lake and would be absorbed into it.
 */
export const lakeland: GameMap = {
  id: 'lakeland',
  name: 'Lakeland',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '............',
    '..f......f..',
    '...~~~~~~...',
    '..~~~~~~~~..',
    '..~~~..~~~..',
    '..~~~..~~~..',
    '..~~~~~~~~..',
    '...~~~~~~...',
    '............',
    '..^..~...^..',
    '............',
    '............',
  ],
};
