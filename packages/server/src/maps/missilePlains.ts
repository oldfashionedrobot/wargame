import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Missile Plains*. Three ridges across the
 * board, each broken by a single gap, and the gaps staggered -- so wheels
 * zigzag from one to the next while foot climbs straight over. Between them,
 * open fields studded with buildings.
 *
 * ⚠️ **Not a rotation**, as the original is not: both armies start on the west
 * side, so the zones are declared.
 */
export const missilePlains: GameMap = {
  id: 'missile-plains',
  name: 'Missile Plains',
  rows: [
    '..-.......#.#.......',
    '..-........#wwww..f.',
    '#.-.#.#.f.#.wwww.ff.',
    '^#-#.#.#.f.#.wwff...',
    '^^-^^^^^^^^^^^^^^^^^',
    '..-..www.f.#.#.#.f.#',
    '..-------.#.#.#.#.#.',
    'ff....www#.f.#.f.#.f',
    'ffff...ww.f.#.#.#.#.',
    '^^^^^^^^^^^^^^^^^.^^',
    '.f.#.#.f.#.ww.ww.-..',
    '#.#.#.#.#..w----.-..',
    '.#.#.f.f.#---ww---..',
    '#.#.#.#.f...wff...ff',
    '^^^^^.^^^^^^^^^^^^^^',
    '^.#..-#...ww.#.#.#..',
    'f..#.--.^ww.#.f.#.#.',
    'ff#.#.--------.#.#..',
    '....---...ww#.#.#.#.',
    '..........ff.#.f.#..',
  ],
  zoneStarts: [0, 0],
};
