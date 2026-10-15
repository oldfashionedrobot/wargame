import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Duo Falls*, turned a quarter so that its
 * narrow ends, where the armies start, are the near and far edges. A long,
 * winding country between two seas, cut twice by falls -- short rivers from sea
 * to sea, each bridged where the road crosses. The road snakes the whole length
 * through a narrow neck in the east, so guns go the long way round while foot
 * and horse ford.
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
