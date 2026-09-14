import type { GameMap } from './types';

/**
 * Open ground with a road straight across it and a single rise in the middle.
 *
 * The set had nothing that played as a field: every other board is cut up by
 * water or funnelled by road, so every fight on them happens at a crossing.
 * Here there is nowhere to funnel anyone, and the only cover is two woods and
 * the hill -- which makes it the board for finding out what the units do when
 * the terrain stops doing it for them.
 *
 * ⚠️ The road is across rather than along, so it is a **lateral** road: it
 * helps you redeploy along your own line far more than it helps you advance.
 * That is what stops open ground simply favouring whoever charges first.
 */
export const meadow: GameMap = {
  id: 'meadow',
  name: 'Meadow',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '............',
    '..ff........',
    '..ff........',
    '............',
    '............',
    '------------',
    '....^^^^....',
    '.....^^.....',
    '............',
    '........ff..',
    '........ff..',
    '............',
  ],
};
