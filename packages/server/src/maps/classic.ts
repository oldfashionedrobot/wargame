import type { GameMap } from './types';

/**
 * A river splits the board and one bridge crosses it, with woods on the near
 * approach and high ground on the far one.
 *
 * The terrain is doing work rather than decorating: infantry can ford the river
 * anywhere at a cost, cavalry and artillery cannot and must take the bridge, so
 * the crossing is the whole board. The road down the middle is the only ground
 * artillery moves over cheaply, and it runs straight through that crossing.
 */
export const classic: GameMap = {
  id: 'classic',
  name: 'Bridgehead',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '.....--.....',
    '..f..--..f..',
    '..f..--..f..',
    '.....--.....',
    '.....--.....',
    '~~~~~==~~~~~',
    '.....--.....',
    '..^..--..^..',
    '..^..--..^..',
    '.....--.....',
    '....f--f....',
    '.....--.....',
  ],
};
