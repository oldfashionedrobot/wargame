import type { GameMap } from './types';

/**
 * A lake with an island in the middle of it, and a pond off to one side.
 *
 * The island is the point: it is ringed by water, and water is the one terrain
 * only `foot` may enter. So infantry can take and hold ground that cavalry and
 * artillery cannot reach at any price -- the sharpest thing the cost table can
 * say, on a board built to say it.
 *
 * Everything else goes round. The lake leaves a lane down each flank, which is
 * what keeps the board crossable for wheels without a bridge on it anywhere.
 */
export const lakeland: GameMap = {
  id: 'lakeland',
  name: 'Lakeland',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '....................',
    '....................',
    '..ff............ff..',
    '....................',
    '.......~~~~~~.......',
    '.....~~~~~~~~~~.....',
    '....~~~~~~~~~~~~....',
    '....~~~~~~~~~~~~....',
    '....~~~~~..~~~~~....',
    '....~~~~~..~~~~~....',
    '....~~~~~~~~~~~~....',
    '....~~~~~~~~~~~~....',
    '.....~~~~~~~~~~.....',
    '.......~~~~~~.......',
    '....................',
    '..^^............^^..',
    '....................',
    '.........~..........',
    '....................',
    '....................',
  ],
};
