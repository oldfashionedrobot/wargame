import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Long Road*, turned half round. A road
 * winding the length of a narrow coast, crossing one-tile channels on short
 * bridges, with the armies in opposite corners -- so the zones are declared.
 */
export const longRoad: GameMap = {
  id: 'long-road',
  name: 'Long Road',
  rows: [
    'fffff..........',
    '.#.#--------...',
    '#----wwww#.##.w',
    'f-wwwww#wwwfwww',
    'w-wwffw=wwwwwww',
    'f------------ww',
    'w.#w=wf#fw=w-.w',
    'w.ww#wwwww#w-#w',
    'w.wwwwwwww=w-ww',
    'w.fww#....---.w',
    'w.www..w=w-.w=w',
    'w#....#w#w-.w.w',
    'wwf.ww=www-#w#w',
    'wwwffw.##w-ww.w',
    'wff.www=ww-=.#w',
    'ww.fwww----wwww',
    'f..-----wwwwwww',
    '#.#-.#wwwwwwwww',
    '..--......wwwww',
    '..........wwwww',
  ],
  zoneStarts: [5, 0],
};
