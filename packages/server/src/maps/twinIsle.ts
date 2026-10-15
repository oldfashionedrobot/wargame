import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Twin Isle*, turned half round. Two islands,
 * each a ridge of hills ringed by road, joined by one neck of buildings across
 * the sea -- the only way from one to the other for anything, and the ground
 * the game is about. Near enough a rotation.
 */
export const twinIsle: GameMap = {
  id: 'twin-isle',
  name: 'Twin Isle',
  rows: [
    'wwwwwww....-.....wwwww',
    'www.ff.....-.....f..fw',
    'wwwf---------------#.w',
    'www#-#^^^^##^^^##^#-fw',
    'www#-#^^^^^^^^^^^^#-fw',
    'wwwf----------------#w',
    'wwwf..fff..ffff.##fffw',
    'wwwwwwww..###.wwwwwwww',
    'wwwwwwww.###..wwwwwwww',
    'w.#.f..fff..ff..fffwww',
    'w#----------------.www',
    'wf-#^^^^^^^^^^^^#-#www',
    'w.-#^^##^^^^##^^#-#www',
    'w.#---------------.www',
    'wffff.....-....ffffwww',
    'wwwww.....-....wwwwwww',
  ],
  zoneStarts: [7, 5],
};
