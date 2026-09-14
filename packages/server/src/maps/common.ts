import type { GameMap } from './types';

/**
 * A road up the middle, high ground on both flanks, and open field everywhere
 * else.
 *
 * The other open board with the opposite road: this one runs the length of the
 * play, so it is the fast way *at* the enemy rather than the fast way across
 * your own line. Artillery that takes it arrives first and arrives exposed.
 *
 * The flanking hills are 4 stars of cover apiece and shut to wheels outright,
 * so each is a strong position that no gun can ever hold -- which is the trade
 * the terrain table exists to make, stated four times on one board.
 */
export const common: GameMap = {
  id: 'common',
  name: 'The Common',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '.........--.........',
    '.........--.........',
    '...ff....--....ff...',
    '.........--.........',
    '.........--.........',
    '..^^.....--.....^^..',
    '..^^.....--.....^^..',
    '.........--.........',
    '.........--.........',
    '.........--.........',
    '.........--.........',
    '.........--.........',
    '.........--.........',
    '..^^.....--.....^^..',
    '..^^.....--.....^^..',
    '.........--.........',
    '.........--.........',
    '...ff....--....ff...',
    '.........--.........',
    '.........--.........',
  ],
};
