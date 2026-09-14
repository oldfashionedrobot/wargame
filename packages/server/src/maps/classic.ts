import type { GameMap } from './types';

/**
 * A river splits the board, crossed by one bridge, with mountains flanking the
 * approach on the far side and forest on the near one.
 *
 * The terrain is doing work rather than decorating: infantry can ford the
 * river at a cost, cavalry and artillery cannot and must take the bridge; the
 * mountains are cheap on foot, most of a turn on a horse and shut to
 * artillery; the road down the middle is the only ground artillery crosses
 * cheaply.
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
};
