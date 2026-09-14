import type { GameMap } from './types';

/**
 * A road network closed into a figure of eight. No water and no high ground:
 * every tile is passable to everything, so the only thing shaping a move is
 * what it costs.
 *
 * Which makes this the board artillery actually likes. A gun pays 2 to cross
 * plains and 1 on a road, so the ladder is worth going out of your way for --
 * and the two enclosed blocks are what stop that being a straight line.
 */
export const crossroads: GameMap = {
  id: 'crossroads',
  name: 'Crossroads',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  rows: [
    '....--....',
    '..f.--.f..',
    '..f.--.f..',
    '----------',
    '....--....',
    '....--....',
    '----------',
    '..f.--.f..',
    '..f.--.f..',
    '....--....',
  ],
};
