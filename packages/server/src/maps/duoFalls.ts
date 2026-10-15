import type { GameMap } from './types';

/**
 * A long, winding country between two seas, cut twice by falls -- short rivers
 * running from sea to sea, each bridged where the road crosses. The road
 * snakes the whole length: up the west side, across to a narrow neck in the
 * east and up it, back west, and on to the far end -- so guns go the long way
 * round while foot and horse ford the falls.
 *
 * ⚠️ **Drawn from Advance Wars: Dual Strike's War Room map *Duo Falls***, at
 * its own size, by way of Advance Wars By Web's copy (awbw.amarriner.com) --
 * turned a quarter, since the original is wide and its armies start at its
 * narrow ends, which here are the near and far edges. Its cities, bases and
 * headquarters are the buildings. Changed only where the deployment zones need
 * it: each end reaches the board's edge, cleared to open ground, with the road
 * run on into it.
 *
 * ⚠️ **Not a rotation**, as the original is not.
 */
export const duoFalls: GameMap = {
  id: 'duo-falls',
  name: 'Duo Falls',
  rows: [
    'w..-.......ww',
    'w..-.......ww',
    'www-ff...#.ww',
    'ww.-f#.###..w',
    'ww.---#---.fw',
    'wwf-f#.###.fw',
    'wwf-.....#ffw',
    'w..-.#.fwfffw',
    'w.#-.#.fwffww',
    'w.#-f.fffffww',
    'w..-f.wwwwwww',
    'w~~=~~wwwwwww',
    'w..-..wwwwwww',
    'w.#-f..#.f.ww',
    'w..--------.w',
    'ww...#f#..-fw',
    'wwwwwwww.#-fw',
    'wwwwwwwww.-#w',
    'wwwwwwww.#-fw',
    'wwf.#f.#.f-fw',
    'wwf--------fw',
    'w.#-.#.f.#fww',
    'w.#-fwwwwwwww',
    'w~~=~wwwwwwww',
    'w..-.wwwwwwww',
    'wf#----..#f.w',
    'w.f..#-#.#.ww',
    'wwf..#-...^ww',
    'ww.f.#-#..^ww',
    'ww.f..-.#^www',
    'www.#f-f#.www',
    'ww....-.....w',
    'ww....-.....w',
  ],
};
