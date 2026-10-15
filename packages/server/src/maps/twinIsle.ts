import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Twin Isle*, turned half round and cut down.
 * Two shores of a strait, each a ridge inside a ring road, joined by one neck
 * -- the only way across for anything. Each half is the other turned.
 */
export const twinIsle: GameMap = {
  id: 'twin-isle-16',
  name: 'Twin Isle',
  rows: [
    '........-.......',
    '..f.....-....f..',
    '.f--------------',
    '..-.^^^^#^^^^^.-',
    '..-.^^^^^^^^^^.-',
    '.f--------------',
    '.f..ff..fff...ff',
    'wwwwww..#..wwwww',
    'wwwwww.#...wwwww',
    '..f..ff..ff.fff.',
    '--------------..',
    '-.^^^^^^^^^^.-..',
    '-.^^^^^#^^^^.-..',
    '--------------..',
    'fff....-.....ff.',
    '.......-........',
  ],
};
