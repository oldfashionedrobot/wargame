import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Mirror Islands*, turned a quarter -- one of
 * its two-player Classic maps, though only about half symmetric. One island in
 * a ring of sea, crossed by a staggered river in its middle with a bridge at
 * either end of the stagger, and by a second river near the far end with a
 * single bridge: the far army's guns have one way out.
 */
export const mirrorIslands: GameMap = {
  id: 'mirror-islands',
  name: 'Mirror Islands',
  rows: [
    'ww..-.......www',
    'ww..-.......#ww',
    'wf-----#-----ww',
    'wf-...#.#.f.#fw',
    'w.#ff....#f.#fw',
    'w.#fffff..ff-fw',
    'w.-ffffff.^^-fw',
    'wf-fffff...^-fw',
    'wf-f.#f..^..-.w',
    'w.-.fff.#.---.w',
    'w.#.^^^.^.-.#fw',
    'w.-.^.#.^.-.^fw',
    'w.-.^.-...^.-.w',
    'ww-----------ww',
    'ww..-.....-.#ww',
    'ww~~=~~~..-..ww',
    'ww..-..~~~=~~ww',
    'ww..-.....-..ww',
    'ww.#-f..#.---ww',
    'w.#--ff.^^..-fw',
    'wf-ffff.^^^^-fw',
    'wf-ff.#.^^^.#fw',
    'w.#fff...^^f-fw',
    'w........^^--fw',
    'w~~~~~~~.---..w',
    'w...^^^~.-....w',
    'w.#.^^^~~=~~~~w',
    'wff.#....--...w',
    'wff.^.#ff.#f.#w',
    'w.#----#---f..w',
    'ww........-..ww',
    'www.......-..ww',
  ],
};
