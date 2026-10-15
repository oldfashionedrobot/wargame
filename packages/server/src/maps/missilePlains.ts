import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Missile Plains*, cut down. Three ridges
 * across the board, each with one gap, staggered -- and one road threading all
 * three, so wheels zigzag from gap to gap while foot climbs straight over.
 * Both armies start on the west, as in the original, so the zones are declared.
 */
export const missilePlains: GameMap = {
  id: 'missile-plains-16',
  name: 'Missile Plains',
  rows: [
    '..-.............',
    '..-.......ww..f.',
    '..-.......ww.ff.',
    '^^-^^^^^^^^^^^^^',
    '..-#.........f..',
    '..------------..',
    'ff.......f.f.-#f',
    '^^^^^^^^^^^^^-^^',
    '.f.....f.ww.#-..',
    '......#..ww..-..',
    '.....---------..',
    '^^^^^-^^^^^^^^^^',
    'f...#-.....ww...',
    'ff...-.....ww...',
    '.....-..........',
    '.....-.....f....',
  ],
  zoneStarts: [0, 0],
};
