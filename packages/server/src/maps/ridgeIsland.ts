import type { GameMap } from './types';

/**
 * From Advance Wars: Dual Strike's *Ridge Island*, cut down. A ring road round
 * ridges of hills, and a bay in two opposite corners. The zones are declared,
 * each toward its own end of the ring.
 */
export const ridgeIsland: GameMap = {
  id: 'ridge-island-16',
  name: 'Ridge Island',
  rows: [
    '...........-wwww',
    '...........-wwww',
    '....ff..#..-.www',
    '....f......-f.ww',
    '..----------f^..',
    'f.-....^^ff-f^^.',
    'f.-..ff^^^^-^^^.',
    '..-.f^fffff-#ff.',
    '..-#^^..ff.-..f.',
    '..-.^f.....-..f.',
    '.f----------....',
    'f..f^ff..-...f..',
    'ww.^^f...-..ff..',
    'www^^f.#.-fff...',
    'wwww.....-......',
    'wwww.....-......',
  ],
  zoneStarts: [2, 4],
};
