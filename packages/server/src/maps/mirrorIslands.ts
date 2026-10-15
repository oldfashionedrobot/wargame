import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Mirror Islands*, cut down. A staggered
 * river across the middle, bridged at either end of the stagger, and a ring
 * road on each side of it. Each half is the other turned.
 */
export const mirrorIslands: GameMap = {
  id: 'mirror-islands-16',
  name: 'Mirror Islands',
  rows: [
    '....-..........',
    '....-..........',
    '.f-----#-----..',
    '..-ffffff.^^-f.',
    '..-.^...^...-f.',
    '..-----------..',
    '....-.....-.#..',
    '~~~~=~~~..-....',
    '....-..~~~=~~~~',
    '..#.-.....-....',
    '..-----------..',
    '.f-ffff.^^^^-f.',
    '..-fff...^^f-f.',
    '..-----#-----..',
    '..........-....',
    '..........-....',
  ],
};
