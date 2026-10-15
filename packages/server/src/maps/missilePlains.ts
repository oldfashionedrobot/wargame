import type { GameMap } from './types';

/**
 * Three ridges across the board, each broken by a single gap, and the gaps
 * staggered -- so wheels zigzag from one to the next while foot climbs
 * straight over. Between the ridges, open fields studded with buildings, so
 * cover is everywhere and the stoutest of it is somewhere a gun can stand.
 *
 * ⚠️ **Drawn from Advance Wars: Dual Strike's War Room map *Missile Plains***,
 * at its own size, by way of Advance Wars By Web's copy (awbw.amarriner.com).
 * Its pipes are the ridges, their seams the gaps, and its cities, bases and
 * silos the buildings. Changed only where the deployment zones need it: each
 * army's corner is cleared to open ground, and a road runs from the near zone
 * up through the first gap to the road beyond.
 *
 * ⚠️ **Not a rotation**, as the original is not: both armies start on the west
 * side, and the east is lakes and buildings neither owns.
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
