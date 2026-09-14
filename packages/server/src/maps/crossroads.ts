import type { GameMap } from './types';

/**
 * A ring road with a junction at its heart and four spurs running off it.
 *
 * No water and no mountains: everything here is about the road network. It
 * closes into a figure of eight, which is enough to produce every junction a
 * 4-bit autotiler can draw except an isolated stub — two crossroads, all four
 * T-junctions, corners on the loop, and dead ends in three directions.
 */
export const crossroads: GameMap = {
  id: 'crossroads',
  name: 'Crossroads',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  // rows[0] is the bottom of the screen.
  rows: [
    '.....-....',
    '.....-.ff.',
    '.....-....',
    '..----....',
    '.---.-....',
    '..--.-....',
    '..-------.',
    '.ff..-....',
    '.....-....',
    '..........',
  ],
};
