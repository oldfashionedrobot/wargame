import type { GameMap } from './types';

/**
 * A river splits the board, crossed by one bridge, with mountains flanking the
 * approach on the far side and forest on the near one.
 *
 * The terrain is doing work rather than decorating: infantry can ford the
 * river at a cost, cavalry and artillery cannot and must take the bridge; the
 * mountains are closed to anything but foot; the road down the middle is the
 * only ground artillery crosses cheaply.
 */
export const classic: GameMap = {
  id: 'classic',
  name: 'Bridgehead',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '...--...',
    '..f--f..',
    '..f--f..',
    '~~~==~~~',
    '..^--^..',
    '..^--^..',
    '...--...',
    '...--...',
  ],

  // Order decides ids: each owner's units are numbered as they appear, so
  // these are blue-1..blue-3 and red-1..red-3.
  units: [
    { at: { col: 0, row: 0 }, type: 'infantry', owner: 0 },
    { at: { col: 1, row: 0 }, type: 'cavalry', owner: 0 },
    { at: { col: 2, row: 0 }, type: 'artillery', owner: 0 },
    { at: { col: 7, row: 7 }, type: 'infantry', owner: 1 },
    { at: { col: 6, row: 7 }, type: 'cavalry', owner: 1 },
    { at: { col: 5, row: 7 }, type: 'artillery', owner: 1 },
  ],
};
