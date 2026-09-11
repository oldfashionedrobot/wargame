import type { TileType } from '@vod/shared';
import type { TerrainModel } from './terrainModels';

/** A quarter turn about y — the increment every ground model is turned by. */
export const QUARTER_TURN = Math.PI / 2;

/**
 * Something standing *on* a tile rather than being it, placed relative to the
 * tile's centre.
 *
 * Every field is filled in by the tiler rather than looked up when drawing.
 * That is the point: where a thing stands, which way it faces and how big it
 * is are all decisions about the *board*, and keeping them here leaves the
 * drawing code with nothing to decide and no table of its own to consult.
 */
export interface Prop {
  model: TerrainModel;
  /** Offset from the tile centre, in tile widths. */
  x: number;
  z: number;
  /**
   * Rotation about y, in radians — free rather than quarter turns. A boulder
   * has no grain, and scatter that snaps to the axes reads as a grid.
   */
  rotation: number;
  /** Uniform scale. */
  scale: number;
}

/**
 * What to draw on one tile: a ground model, turned to suit its neighbours, and
 * whatever stands on it.
 */
export interface TerrainCell {
  ground: TerrainModel;
  /** Quarter turns about y, applied to the ground model. */
  turns: number;
  /** Often empty; a peak carries a whole scatter of them. */
  props: Prop[];
  /**
   * Extra height a unit stands at, *above* the ground model's own top.
   *
   * Nearly always absent: a unit stands on the ground, and how high the ground
   * is gets measured from the model rather than stated here. This exists for
   * the one case where you stand on something that is not ground -- a bridge
   * deck, a walkable surface partway up a prop.
   */
  standOn?: number;
}

/**
 * How high anything a unit stands on may be.
 *
 * ⚠️ `screenToTile` intersects `y = 0` rather than picking a mesh, while the
 * camera looks down at 38.6 degrees — so a surface at height `h` draws `1.25h`
 * tiles away from the tile it belongs to. At 0.25 that is a third of a tile and
 * goes unnoticed; at 0.5 it is a click landing on the neighbour.
 *
 * ⚠️ Binds the **surface** — `topOf(ground) + standOn` — and not either half on
 * its own, which is why `warnIfTooTall` checks it there rather than here: only
 * the renderer knows what a model measures. The half a cell *declares* is
 * tested here too, but passing both halves separately is not the same as
 * passing their sum.
 */
export const MAX_STAND_HEIGHT = 0.25;

/**
 * Where a bridge's planking sits, measured up from the ground it stands on --
 * the same frame `standOn` is in. The model's railings reach 0.35 in that
 * frame, which is why its own top is no use as a standing height.
 */
const BRIDGE_DECK = 0.15;

// --- what a peak is strewn with ---------------------------------------------

/**
 * The loose stone scattered over a mountain tile.
 *
 * ⚠️ `stone_*` and not `rock_*`, which are the same shapes in `dirt` -- the
 * exact brown of every road and riverbank on the board. And small ones: the
 * pad underneath is what says *raised*, so these only have to say *rocky*.
 * They are all one `stone` material, the pad's own, so however many are
 * scattered they merge into a group that already exists. The count buys
 * geometry and never a draw call.
 */
// ⚠️ None wider than 0.43, which is what `RUBBLE_RING` is solved against. Add
// a broader one and the scatter starts hanging off the rim.
const RUBBLE: TerrainModel[] = [
  'stone_smallA',
  'stone_smallB',
  'stone_smallC',
  'stone_smallE',
  'stone_smallI',
  'stone_smallFlatB',
];

const RUBBLE_COUNT = 6;

/**
 * The ring the scatter sits on, and how small each stone is drawn.
 *
 * ⚠️ These four numbers are squeezed between two edges and there is not much
 * room between them. Outward: a stone must stay *on its own tile*, or it hangs
 * over the rim and floats at pad height above the grass beyond. Inward:
 * `KEEP_CLEAR`, because a unit stands at the centre.
 *
 * ⚠️ The outward bound has to hold at the **worst case, not the likely one**.
 * `RING + SPREAD` is the furthest a stone's centre goes and `SCALE + GROWTH`
 * the largest it is drawn, so the binding sum is `0.32 + 0.43/2 × 0.8 = 0.492`
 * against a half-width of 0.5. An earlier 0.07 spread put that sum at 0.502 —
 * over — and the test still passed, because hitting it needs three independent
 * draws at their extremes at once and no board is big enough to roll that.
 *
 * The inward edge is the softer of the two. These are ground clutter a fifth of
 * a tile tall, so a horse standing among them still reads — unlike a tree,
 * which is why that one is pushed to a corner rather than ringed.
 */
const RUBBLE_RING = 0.26;
const RUBBLE_SPREAD = 0.06;
const RUBBLE_SCALE = 0.5;
const RUBBLE_GROWTH = 0.3;
export const KEEP_CLEAR = 0.24;

/** The furthest from centre a stone is ever placed, and the largest it is drawn. */
export const RUBBLE_MAX_REACH = RUBBLE_RING + RUBBLE_SPREAD;
export const RUBBLE_MAX_SCALE = RUBBLE_SCALE + RUBBLE_GROWTH;

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
      return { ground: 'ground_riverCornerSmall', turns: INNER_CORNER[land[0][0]], props: [] };
    }
  }

  const chosen = WATER[mask];
  return { ground: chosen.model, turns: chosen.turns, props: [] };
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

/**
 * A deterministic stream of values in `[0, 1)` for one tile.
 *
 * One `hash` answers one question, and a scatter asks six per stone. Same tile,
 * same stream, every time — terrain is composed fresh on every scene build, so
 * anything drawn from this has to come out identical or the board reshuffles
 * itself whenever the canvas remounts.
 */
function seeded(col: number, row: number): () => number {
  let state = hash(col, row) | 1;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519);
    state = (state + 0x6d2b79f5) | 0;
    return ((state >>> 8) & 0xffffff) / 0x1000000;
  };
}

/**
 * Loose stone around the rim of a peak, in a ring rather than at a corner.
 *
 * A ring is what makes it read as ground the tile is *made of* instead of one
 * object sitting on it -- and it keeps the middle clear for a unit without
 * having to reason about which corner is free. Spaced by index and then nudged,
 * so the stones neither sit at even intervals nor pile up on one side.
 */
function rubble(col: number, row: number): Prop[] {
  const next = seeded(col, row);

  return Array.from({ length: RUBBLE_COUNT }, (_, i) => {
    const angle = ((i + next() * 0.7) / RUBBLE_COUNT) * 2 * Math.PI;
    const radius = RUBBLE_RING + next() * RUBBLE_SPREAD;

    return {
      model: RUBBLE[Math.floor(next() * RUBBLE.length)],
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rotation: next() * 2 * Math.PI,
      scale: RUBBLE_SCALE + next() * RUBBLE_GROWTH,
    };
  });
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
        // Centred and square to the road, unlike everything else that stands
        // on a tile -- a bridge is the one prop that has somewhere it must be.
        props: [
          {
            model: 'bridge_wood',
            x: 0,
            z: 0,
            rotation: bridgeTurns(grid, col, row) * QUARTER_TURN,
            scale: 1,
          },
        ],
        // The deck, not the railings. The model's own top is the handrail, and
        // nobody walks on that -- so this is the one height in the renderer
        // read off the art by eye rather than measured from it.
        standOn: BRIDGE_DECK,
      };
    case 'road': {
      const chosen = ROAD[neighbourMask(grid, col, row, isRoad, false)];
      return { ground: chosen.model, turns: chosen.turns, props: [] };
    }
    case 'forest':
      return {
        ground: 'ground_grass',
        turns: 0,
        props: [{ model: 'tree_default', ...propOffset(col, row), rotation: 0, scale: 1 }],
      };
    // A stone pad strewn with loose stone, rather than one boulder in a field.
    // The pad is ground, so how high a unit stands on it is measured off the
    // model rather than stated; the rubble is only there to say what the
    // ground is made of.
    case 'mountain':
      return { ground: 'cliff_blockQuarter_stone', turns: 0, props: rubble(col, row) };
    default:
      return { ground: 'ground_grass', turns: 0, props: [] };
  }
}

/** Every cell's models, worked out once -- terrain does not change in a match. */
export function composeTerrain(grid: TileType[][]): TerrainCell[][] {
  return grid.map((cells, row) => cells.map((_, col) => baseCell(grid, col, row)));
}

/**
 * Where a single tall prop stands within its tile — a tree, and only a tree.
 *
 * ⚠️ Never the middle: a unit stands there, and a tree planted in the centre is
 * a tree wearing a soldier. Pushed toward a corner rather than ringed the way
 * rubble is, because one object cannot make a ring and a tree is tall enough
 * that the half of the tile it occupies has to be a half the unit is not in.
 */
function propOffset(col: number, row: number): { x: number; z: number } {
  const h = hash(col, row);
  const corner = h % 4;
  const jitter = ((h >> 3) % 5) / 100; // a hair off the diagonal, so rows do not line up
  const d = 0.28 + jitter;

  return {
    x: corner === 0 || corner === 3 ? -d : d,
    z: corner === 0 || corner === 1 ? -d : d,
  };
}
