import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Little Lion*, turned a quarter. The armies
 * start in opposite corners with ridges and lakes between them, so the zones
 * are declared toward the corners.
 */
export const littleLion: GameMap = {
  id: 'little-lion',
  name: 'Little Lion',
  rows: [
    '-.........#wwwwwww',
    '-..........===.#.w',
    '-^#..f#ww=wwww.#.w',
    '-^^^^..ff.wwwww..w',
    '--ff^.^^^.wwwwww=w',
    '#-ff^ff..f===#ww=w',
    '.-ff^^^^^fwww=ww..',
    '.-..f...^fwww=w##.',
    'w-#..ww...fwwf..ff',
    'w-#..ww.^.#ww.^^^^',
    'w-...ww.^.#wwf.^^^',
    'w-..fww.^f#www..f^',
    'w-wwwww.^f--------',
    'w-wwwww.^^^^^^^^f-',
    'w-.wwww.f------^^#',
    'w-#www#f.-wwww--##',
    'w-#www--------....',
    'w------#..........',
  ],
  zoneStarts: [0, 8],
};
