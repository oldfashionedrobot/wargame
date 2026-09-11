import type { TileType } from '@vod/shared';
import type { TerrainModel } from './terrainModels';

/**
 * What to draw on one tile: a ground model, turned to suit its neighbours, and
 * optionally something standing on it.
 */
export interface TerrainCell {
  ground: TerrainModel;
  /** Quarter turns about y, applied to the ground model. */
  turns: number;
  overlay?: TerrainModel;
  /** Quarter turns for the overlay, where it has an orientation of its own. */
  overlayTurns?: number;
}

// --- the kit, by the shape of a neighbourhood -------------------------------
//
// A quarter turn is free in three dimensions, so sixteen masks need six models
// rather than sixteen sprites. Each entry is the model plus how many turns take
// it from the orientation it was drawn in to the one this mask wants.
//
// ⚠️ Base orientations are measured, not guessed -- see the rotation probe in
// the commit that introduced this. Getting one wrong turns a shoreline inland.

interface Turned {
  model: TerrainModel;
  turns: number;
}

// A turn about y carries north to east, east to south, and so on, so a model's
// entries are one cycle of whatever it was drawn as. The base orientations
// below were **measured** off the geometry, not guessed: `riverStraight` runs
// north-south at rest, `riverSide` banks to the south, `riverCorner` opens
// north and west, `riverEnd` enters from the north. Guessing them the first
// time produced a river in disconnected segments.

/**
 * Water as a **body**: the mask counts water neighbours, so a model is named
 * for where the *land* is. All sixteen covered, with nothing to fall back on --
 * which the sprite sheet could not manage.
 */
const WATER: Record<number, Turned> = {
  15: { model: 'ground_riverOpen', turns: 0 }, // no land at all
  0: { model: 'ground_riverTile', turns: 0 }, // a pond, land on every side

  11: { model: 'ground_riverSide', turns: 0 }, // land south
  7: { model: 'ground_riverSide', turns: 1 }, // land west
  14: { model: 'ground_riverSide', turns: 2 }, // land north
  13: { model: 'ground_riverSide', turns: 3 }, // land east

  9: { model: 'ground_riverCorner', turns: 0 }, // land east and south
  3: { model: 'ground_riverCorner', turns: 1 }, // land south and west
  6: { model: 'ground_riverCorner', turns: 2 }, // land west and north
  12: { model: 'ground_riverCorner', turns: 3 }, // land north and east

  5: { model: 'ground_riverStraight', turns: 0 }, // land east and west
  10: { model: 'ground_riverStraight', turns: 1 }, // land north and south

  1: { model: 'ground_riverEnd', turns: 0 }, // water only to the north
  2: { model: 'ground_riverEnd', turns: 1 },
  4: { model: 'ground_riverEnd', turns: 2 },
  8: { model: 'ground_riverEnd', turns: 3 },
};

/**
 * Roads as **connectors**, which is the only thing a road ever is -- so unlike
 * water there is no second reading of a neighbourhood to disambiguate. Same
 * rotation structure, measured the same way.
 */
const ROAD: Record<number, Turned> = {
  15: { model: 'ground_pathCross', turns: 0 },
  0: { model: 'ground_pathTile', turns: 0 },

  11: { model: 'ground_pathSplit', turns: 0 }, // no road south
  7: { model: 'ground_pathSplit', turns: 1 }, // no road west
  14: { model: 'ground_pathSplit', turns: 2 }, // no road north
  13: { model: 'ground_pathSplit', turns: 3 }, // no road east

  9: { model: 'ground_pathBend', turns: 0 }, // north and west
  3: { model: 'ground_pathBend', turns: 1 }, // north and east
  6: { model: 'ground_pathBend', turns: 2 }, // south and east
  12: { model: 'ground_pathBend', turns: 3 }, // south and west

  5: { model: 'ground_pathStraight', turns: 0 }, // north to south
  10: { model: 'ground_pathStraight', turns: 1 }, // east to west

  1: { model: 'ground_pathEnd', turns: 0 }, // road only to the north
  2: { model: 'ground_pathEnd', turns: 1 },
  4: { model: 'ground_pathEnd', turns: 2 },
  8: { model: 'ground_pathEnd', turns: 3 },
};

/** Water on all four sides but land on one diagonal, by which diagonal. */
const INNER_CORNER: Record<'nw' | 'ne' | 'se' | 'sw', number> = {
  ne: 0, // where the nub is drawn
  se: 1,
  sw: 2,
  nw: 3,
};

// --- neighbourhoods ---------------------------------------------------------

const at = (grid: TileType[][], col: number, row: number): TileType | undefined => grid[row]?.[col];

const isRoad = (tile: TileType | undefined): boolean => tile === 'road' || tile === 'bridge';
// A bridge is water with a road over it, so it is *both* families. Leaving it
// out of this one makes every river dead-end at its own crossing.
const isWater = (tile: TileType | undefined): boolean => tile === 'river' || tile === 'bridge';

/**
 * How a cell's four orthogonal neighbours stand: `N=1, E=2, S=4, W=8`, set
 * where the neighbour belongs to the same family.
 *
 * `offBoard` decides what the edge of the map counts as, and the two families
 * want different answers: water treats it as more water, so a river runs
 * cleanly off the board rather than growing a shoreline along it, while a road
 * treats it as land and ends.
 */
export function neighbourMask(
  grid: TileType[][],
  col: number,
  row: number,
  same: (tile: TileType | undefined) => boolean,
  offBoard: boolean,
): number {
  const test = (c: number, r: number): boolean => {
    const tile = at(grid, c, r);
    return tile === undefined ? offBoard : same(tile);
  };

  // Row increases north, so `row + 1` is the tile above on screen.
  return (
    (test(col, row + 1) ? 1 : 0) |
    (test(col + 1, row) ? 2 : 0) |
    (test(col, row - 1) ? 4 : 0) |
    (test(col - 1, row) ? 8 : 0)
  );
}

function waterCell(grid: TileType[][], col: number, row: number): TerrainCell {
  const mask = neighbourMask(grid, col, row, isWater, true);

  // Water on every side: the only thing left that can distinguish this cell is
  // a diagonal, and exactly one land diagonal is a corner the kit has drawn.
  // Two or more has no model, so it stays open water.
  if (mask === 15) {
    const land = (
      [
        ['nw', -1, 1],
        ['ne', 1, 1],
        ['se', 1, -1],
        ['sw', -1, -1],
      ] as const
    ).filter(([, dc, dr]) => {
      const tile = at(grid, col + dc, row + dr);
      return tile !== undefined && !isWater(tile);
    });
    if (land.length === 1) {
      return { ground: 'ground_riverCornerSmall', turns: INNER_CORNER[land[0][0]] };
    }
  }

  const chosen = WATER[mask];
  return { ground: chosen.model, turns: chosen.turns };
}

/**
 * Which way a bridge runs.
 *
 * ⚠️ Not read off the road mask, which would seem to be the same question and
 * is not: a road two tiles wide gives its bridge cells masks 7 and 13 rather
 * than 5 and 10, because each lane sees the other beside it. Asking only about
 * *strictly* road neighbours ignores the lane next door and answers correctly
 * however wide the crossing is.
 */
function bridgeTurns(grid: TileType[][], col: number, row: number): number {
  const road = (c: number, r: number): boolean => at(grid, c, r) === 'road';
  const northSouth = road(col, row + 1) || road(col, row - 1);
  // The deck is drawn spanning east to west, so a road running north to south
  // is the one that turns it. Unlike the ground models this could not be read
  // off a bounding box -- a bridge is near enough square -- so it is settled by
  // looking at the board.
  return northSouth ? 1 : 0;
}

/**
 * Deterministic, so nothing reshuffles whenever the scene rebuilds.
 *
 * ⚠️ Mixed rather than a bare XOR of two multiples. `col * a ^ row * b` cancels
 * to zero wherever the two products agree in the low bits, which on a diagonal
 * put every prop in the same corner -- a test caught it, and only because it
 * sampled a diagonal.
 */
function hash(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return Math.abs(h ^ (h >>> 16));
}

function baseCell(grid: TileType[][], col: number, row: number): TerrainCell {
  const tile = at(grid, col, row);

  switch (tile) {
    case 'river':
      return waterCell(grid, col, row);
    // A bridge is a deck standing on water, so the ground beneath it is
    // whatever the river would have been -- which is why the underside the
    // sprite sheet needed a second pass for simply does not arise here.
    case 'bridge':
      return {
        ...waterCell(grid, col, row),
        overlay: 'bridge_wood',
        overlayTurns: bridgeTurns(grid, col, row),
      };
    case 'road': {
      const chosen = ROAD[neighbourMask(grid, col, row, isRoad, false)];
      return { ground: chosen.model, turns: chosen.turns };
    }
    case 'forest':
      return { ground: 'ground_grass', turns: 0, overlay: 'tree_default' };
    case 'mountain':
      return { ground: 'ground_grass', turns: 0, overlay: 'stone_tallI' };
    default:
      return { ground: 'ground_grass', turns: 0 };
  }
}

/** Every cell's models, worked out once -- terrain does not change in a match. */
export function composeTerrain(grid: TileType[][]): TerrainCell[][] {
  return grid.map((cells, row) => cells.map((_, col) => baseCell(grid, col, row)));
}

/**
 * Where a prop stands within its tile.
 *
 * ⚠️ Never the middle: a unit stands there, and a tree planted in the centre is
 * a tree wearing a soldier. Pushed toward a corner by the same hash that picks
 * grass, so the scatter is varied but never moves between renders.
 */
export function propOffset(col: number, row: number): { x: number; z: number } {
  const h = hash(col, row);
  const corner = h % 4;
  const jitter = ((h >> 3) % 5) / 100; // a hair off the diagonal, so rows do not line up
  const d = 0.28 + jitter;

  return {
    x: corner === 0 || corner === 3 ? -d : d,
    z: corner === 0 || corner === 1 ? -d : d,
  };
}
