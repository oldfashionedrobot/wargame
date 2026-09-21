import type { GameMap } from './types';

/**
 * A river splits the board and one bridge crosses it, with woods on the near
 * approach and high ground on the far one.
 *
 * The terrain is doing work rather than decorating: infantry fords the river
 * anywhere cheaply, cavalry can wade it but pays most of a turn to do so, and
 * artillery cannot cross at all -- so the bridge is the whole board for the
 * guns and a shortcut worth guarding for everyone else. The road down the
 * middle is the only ground artillery moves over cheaply, and it runs straight
 * through that crossing.
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
