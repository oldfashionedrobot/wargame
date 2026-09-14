import type { GameMap } from './types';

/**
 * A river splits the board and one bridge crosses it, with woods on the near
 * approach and high ground on the far one.
 *
 * The terrain is doing work rather than decorating: infantry can ford the river
 * anywhere at a cost, cavalry and artillery cannot and must take the bridge, so
 * the crossing is the whole board. The road down the middle is the only ground
 * artillery moves over cheaply, and it runs straight through that crossing.
 *
 * ⚠️ Sixteen units funnelling through two tiles is the point rather than an
 * oversight -- everything else here is arranged to make that one decision
 * expensive to get wrong.
 */
export const classic: GameMap = {
  id: 'classic',
  name: 'Bridgehead',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '.........--.........',
    '.........--.........',
    '...ff....--....ff...',
    '...ff....--....ff...',
    '.........--.........',
    '..f......--......f..',
    '..f......--......f..',
    '.........--.........',
    '....f....--....f....',
    '.........--.........',
    '~~~~~~~~~==~~~~~~~~~',
    '.........--.........',
    '...^^....--....^^...',
    '...^^....--....^^...',
    '.........--.........',
    '..^......--......^..',
    '.........--.........',
    '.....f...--...f.....',
    '.........--.........',
    '.........--.........',
  ],
};
