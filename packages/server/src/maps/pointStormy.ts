import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Point Stormy*, turned half round. A ring of
 * land round a bay, open on one side, so the way from one army to the other is
 * the long way round; the far headquarters stands on a point out into the bay.
 * The zones are declared toward the headquarters.
 */
export const pointStormy: GameMap = {
  id: 'point-stormy',
  name: 'Point Stormy',
  rows: [
    'wwwwwwwwwwww...-......www',
    'wwwwwwwwww^f...-......www',
    'wwwwwwww...ffff-.....ffww',
    'wwwwww.....ffww-ff.....fw',
    'wwww...##-------#.#.^^.#w',
    'www-------.....#.#.#..#ww',
    'wwf-ff#...www..f#.#.wwwww',
    'wff-^^.#wwwwww......wwwww',
    'wff-^^wwwwwwwwwwwwwwwwwww',
    'wff-^^wwwwwwwwwwwwwwwwwww',
    'w.f-.^wwwwwwwwwwwwww...ww',
    'w#-##wwwwwwwwwwwwww#.#..w',
    'w.-..wwwwwwwwwwww..-#.#.w',
    '#.-#.f.wwwwwwwwww.#-f...w',
    'f#-.ff.wwwwwwwwww..-fffww',
    'f.-##ff.ww.#.#fww..-#ffww',
    'ff-fwwf.ww#####.ww#-#ff.w',
    'f.-fff..ww..#...ww#-..f.w',
    'f.-..f......-...w..-....w',
    'f.-##.#....f-#....f-.fff.',
    '..------------------fffff',
    '...ffff..........#..fffff',
  ],
  zoneStarts: [12, 7],
};
