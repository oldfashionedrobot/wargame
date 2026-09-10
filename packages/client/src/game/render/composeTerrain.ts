import type { TileType } from '@vod/shared';

/**
 * What to draw on one tile: a ground sprite, optionally turned, and optionally
 * something standing on it.
 */
export interface TerrainCell {
  ground: number;
  /** Quarter turns applied to the ground sprite's UVs. */
  turns: number;
  overlay?: number;
}

// --- the atlas, by role -----------------------------------------------------

const GRASS = [0, 1, 2] as const; // plain, tufts, flowers
const OPEN_WATER = 37;
const TREES = 112;
const MOUNTAIN = 5;

// Deck sprites. A bridge is drawn as road over water, so it takes its own
// tile rather than a masked road one.
const BRIDGE_NORTH_SOUTH = 166;
const BRIDGE_EAST_WEST = 130;
/** The underside an east-west deck overhangs into the water south of it. */
const BRIDGE_UNDERSIDE = 148;

/**
 * Road by neighbour mask, and the sheet's own 4x4 layout is the reason this is
 * trustworthy rather than sixteen guesses: its rows encode the north/south
 * bits (none, S, N+S, N) and its columns the east/west ones (none, E, E+W, W),
 * so every entry below is `108 + row*18 + col` for exactly one mask.
 */
const ROAD: Record<number, number> = {
  0: 108,
  2: 109,
  10: 110,
  8: 111,
  4: 126,
  6: 127,
  14: 128,
  12: 129,
  5: 144,
  7: 145,
  15: 146,
  13: 147,
  1: 162,
  3: 163,
  11: 164,
  9: 165,
};

/**
 * Water by neighbour mask. The nine-slice is laid out spatially on the sheet —
 * 18/19/20 over 36/37/38 over 54/55/56 — so these read straight off it.
 *
 * ⚠️ Only twelve of the sixteen exist. The four stubs (a water cell with one
 * water neighbour, ending a river in open ground) have no art, and neither has
 * `0`, a pond with no water neighbours at all. Those fall back to open water,
 * which is a hard-edged blue square — visible, and deliberately so.
 */
const WATER: Record<number, { tile: number; turns: number }> = {
  6: { tile: 18, turns: 0 }, // land north and west
  14: { tile: 19, turns: 0 }, // land north
  12: { tile: 20, turns: 0 }, // land north and east
  7: { tile: 36, turns: 0 }, // land west
  15: { tile: 37, turns: 0 }, // open
  13: { tile: 38, turns: 0 }, // land east
  3: { tile: 54, turns: 0 }, // land south and west
  11: { tile: 55, turns: 0 }, // land south
  9: { tile: 56, turns: 0 }, // land south and east
  5: { tile: 57, turns: 0 }, // a channel running north to south
  // ⚠️ No horizontal channel was drawn, and it is the commonest shape of all --
  // every tile of a river crossing the board is this. Turning the vertical one
  // is what fills the gap; water detail carries a quarter turn without complaint.
  10: { tile: 57, turns: 1 },
};

/** Water on all four sides but land on one diagonal, by which diagonal. */
const INNER_CORNER = { nw: 90, ne: 91, se: 92, sw: 93 } as const;

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

/**
 * Which way a bridge runs.
 *
 * ⚠️ Not read off the road mask, which would seem to be the same question and
 * is not: a road two tiles wide gives its bridge cells masks 7 and 13 rather
 * than 5 and 10, because each lane sees the other beside it. Asking only about
 * *strictly* road neighbours ignores the lane next door and answers correctly
 * however wide the crossing is.
 */
function bridgeTile(grid: TileType[][], col: number, row: number): number {
  const road = (c: number, r: number): boolean => at(grid, c, r) === 'road';
  const northSouth = road(col, row + 1) || road(col, row - 1);
  return northSouth ? BRIDGE_NORTH_SOUTH : BRIDGE_EAST_WEST;
}

/** Deterministic, so the field does not reshuffle whenever the mesh rebuilds. */
function grassTile(col: number, row: number): number {
  const hash = (col * 73856093) ^ (row * 19349663);
  const weighted = Math.abs(hash) % 100;
  if (weighted < 70) return GRASS[0];
  return weighted < 90 ? GRASS[1] : GRASS[2];
}

function waterCell(grid: TileType[][], col: number, row: number): TerrainCell {
  const mask = neighbourMask(grid, col, row, isWater, true);

  // Water on every side: the only thing left that can distinguish this cell is
  // a diagonal, and exactly one land diagonal is a corner the sheet has drawn.
  // Two or more has no art, so it stays open water.
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
    if (land.length === 1) return { ground: INNER_CORNER[land[0][0]], turns: 0 };
  }

  const chosen = WATER[mask];
  return chosen ? { ground: chosen.tile, turns: chosen.turns } : { ground: OPEN_WATER, turns: 0 };
}

function baseCell(grid: TileType[][], col: number, row: number): TerrainCell {
  const tile = at(grid, col, row);

  switch (tile) {
    case 'river':
      return waterCell(grid, col, row);
    case 'bridge':
      return { ground: bridgeTile(grid, col, row), turns: 0 };
    case 'road':
      return { ground: ROAD[neighbourMask(grid, col, row, isRoad, false)], turns: 0 };
    case 'forest':
      return { ground: grassTile(col, row), turns: 0, overlay: TREES };
    case 'mountain':
      return { ground: grassTile(col, row), turns: 0, overlay: MOUNTAIN };
    default:
      return { ground: grassTile(col, row), turns: 0 };
  }
}

/**
 * The east–west deck is drawn a tile and a half tall, so the water beneath one
 * shows its underside rather than its own shoreline.
 *
 * A second pass because this is the one rule where a *neighbour's* decision
 * reaches into this cell — everything else a tile needs, it can see for itself.
 * Precedence, while there is only one of these: the underside beats the water
 * mask, and nothing beats the underside.
 */
function bridgeUnderside(grid: TileType[][], col: number, row: number): TerrainCell | null {
  if (at(grid, col, row) !== 'river') return null;
  if (at(grid, col, row + 1) !== 'bridge') return null;

  return bridgeTile(grid, col, row + 1) === BRIDGE_EAST_WEST
    ? { ground: BRIDGE_UNDERSIDE, turns: 0 }
    : null;
}

/** Every cell's sprite, worked out once — terrain does not change in a match. */
export function composeTerrain(grid: TileType[][]): TerrainCell[][] {
  return grid.map((cells, row) =>
    cells.map((_, col) => bridgeUnderside(grid, col, row) ?? baseCell(grid, col, row)),
  );
}
