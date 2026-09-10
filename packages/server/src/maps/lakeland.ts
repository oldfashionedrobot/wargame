import type { GameMap } from './types';

/**
 * A lake with an island in it, mountains to the north and woods on both shores.
 *
 * The island is the interesting part for the tiler rather than for the game:
 * a single land tile ringed by water gives four cells that have water on all
 * four sides but land on one diagonal — the inner corner a neighbour mask alone
 * cannot see. Nothing but infantry can reach it, so it is scenery with a
 * footnote.
 *
 * There is no bridge and none is needed: the lake stops short of both edges, so
 * going round is the wide way and fording is the short one. The pond off to the
 * east is a single tile with no water neighbours at all — the one shape a lake
 * never produces.
 */
export const lakeland: GameMap = {
  id: 'lakeland',
  name: 'Lakeland',

  // . plains   - road   = bridge   ~ river   ^ mountain   f forest
  // rows[0] is the bottom of the screen.
  rows: [
    '............',
    '..ff.....~..',
    '..ff........',
    '...~~~~~~...',
    '..~~~~~~~~..',
    '..~~~.~~~~..',
    '..~~~~~~~~..',
    '...~~~~~~...',
    '......ffff..',
    '....^.......',
    '...^^^......',
    '....^^......',
  ],

  units: [
    { at: { col: 0, row: 0 }, type: 'infantry', owner: 0 },
    { at: { col: 1, row: 0 }, type: 'cavalry', owner: 0 },
    { at: { col: 2, row: 0 }, type: 'artillery', owner: 0 },
    { at: { col: 11, row: 11 }, type: 'infantry', owner: 1 },
    { at: { col: 10, row: 11 }, type: 'cavalry', owner: 1 },
    { at: { col: 9, row: 11 }, type: 'artillery', owner: 1 },
  ],
};
