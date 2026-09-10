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

  units: [
    { at: { col: 0, row: 0 }, type: 'infantry', owner: 0 },
    { at: { col: 1, row: 0 }, type: 'cavalry', owner: 0 },
    { at: { col: 3, row: 0 }, type: 'artillery', owner: 0 },
    { at: { col: 9, row: 9 }, type: 'infantry', owner: 1 },
    { at: { col: 8, row: 9 }, type: 'cavalry', owner: 1 },
    { at: { col: 6, row: 9 }, type: 'artillery', owner: 1 },
  ],
};
