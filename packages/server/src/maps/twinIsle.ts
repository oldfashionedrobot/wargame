import type { GameMap } from './types';

/**
 * Two islands, each a ridge of hills ringed by road, joined by one neck of
 * buildings across the sea between them -- the only way from one to the other
 * for anything, and the ground the game is about.
 *
 * ⚠️ **Drawn from Advance Wars: Dual Strike's War Room map *Twin Isle***, at its
 * own size, by way of Advance Wars By Web's copy (awbw.amarriner.com), turned
 * half round so that blue's island is the near one. Its cities, bases and
 * headquarters are the buildings. Changed only where the deployment zones need
 * it: each island reaches the board's edge where its army stands, cleared to
 * open ground, with a road down to it from the ring.
 *
 * ⚠️ **Near enough a rotation**, as the original is: each island is the other
 * turned, apart from where their buildings and woods stand.
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
