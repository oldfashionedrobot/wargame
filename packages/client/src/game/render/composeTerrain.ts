import { orthogonalNeighbours } from '@vod/shared';
import type { Coordinate, TileType } from '@vod/shared';
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
   * For when you stand **partway up** a prop rather than on it: a bridge deck,
   * with the railings carrying on above. Declared, because no measurement can
   * find a surface that is not the model's top.
   */
  standOn?: number;
  /**
   * The prop a unit stands on **top of**, by index.
   *
   * ⚠️ Preferred over `standOn` wherever it applies, and for the usual reason:
   * the height comes out of the model rather than out of a number beside it, so
   * swapping the art moves the unit with it. A mesa is exactly this -- a rock on
   * an ordinary tile, and its top is where you stand.
   *
   * At most one of these two means anything for a given cell.
   */
  standOnProp?: number;
}

/**
 * How high anything a unit stands on may be.
 *
 * ⚠️ **This used to be a picking limit and is now a legibility one**, which is
 * the more interesting constraint and the one that binds sooner. `screenToTile`
 * tries every surface height the board has rather than a single ground plane,
 * so a click on a peak finds the peak however tall it is — that is no longer
 * what caps this.
 *
 * What caps it is the camera. At 38.6 degrees above the horizontal a surface at
 * height `h` *draws* `1.25h` tiles up-screen of the tile it belongs to, and past
 * about half a tile it starts visually occupying its neighbour whether or not
 * the click lands right. A block spike put this at a full tile and tile identity
 * fell apart on sight; half of that is comfortable.
 *
 * ⚠️ Binds the **surface** — `topOf(ground) + standOn` — and not either half on
 * its own, which is why `warnIfTooTall` checks it there rather than here: only
 * the renderer knows what a model measures. The half a cell *declares* is
 * tested here too, but passing both halves separately is not the same as
 * passing their sum.
 */
export const MAX_STAND_HEIGHT = 0.5;

/**
 * Where a bridge's planking sits, measured up from the ground it stands on --
 * the same frame `standOn` is in. The model's railings reach 0.35 in that
 * frame, which is why its own top is no use as a standing height.
 */
const BRIDGE_DECK = 0.15;

// --- woodland ---------------------------------------------------------------

/**
 * ⚠️ Six shapes rather than one, and they cost nothing: every entry is painted
 * `woodBark` and `leafsGreen`, the two materials a single tree already brought,
 * so they merge into groups the board has. The kit's pines would each add two
 * more, which is why none is here.
 */
const TREES: TerrainModel[] = [
  'tree_default',
  'tree_oak',
  'tree_tall',
  'tree_fat',
  'tree_thin',
  'tree_cone',
];

/** Trees per tile of woodland, however the wood happens to be shaped. */
const TREES_PER_TILE = 5;

/**
 * How the trees are sized and spaced.
 *
 * ⚠️ **`TREE_SCALE` is the number the board's whole sense of scale turns on.**
 * Measured from the kit, a tree model is 1.15--1.71 tall while a unit is
 * 0.39--0.64, so at the size they were first drawn a wood stood **two to four
 * times higher than the army walking through it**. That is the "landscape units
 * stand inside" read, and it is arithmetic rather than taste.
 *
 * ⚠️ A second thing falls out of the same number and was never measured: a prop
 * of height `h` draws `h / tan θ` tiles up-screen, so a tree at the old scale
 * hid two and a half tiles behind it. `MAX_STAND_HEIGHT` did not catch that,
 * because it bounds surfaces a unit stands *on* and nobody stands on a tree.
 *
 * `TREE_SPAN` keeps a trunk off its tile's edge, so a canopy reaching into the
 * next square stays a canopy. `TREE_SPACING` is measured **across tile
 * boundaries**, which is the whole reason a wood is scattered as one shape
 * rather than a tile at a time.
 */
const TREE_SCALE = 0.34;
const TREE_SCALE_VARIANCE = 0.12;
const TREE_SPAN = 0.84;
const TREE_SPACING = 0.22;
const SCATTER_ATTEMPTS = 20;

/**
 * Forest tiles grouped into the woods they actually form.
 *
 * Four-connected, matching `neighbourMask` and every other neighbourhood
 * question in this module: two woods touching at a corner only are two woods.
 *
 * ⚠️ A group's first entry is its **scan-order** first, and that is what seeds
 * the scatter -- so a wood comes out identical whatever order the flood fill
 * happens to walk it in, which is the same determinism `seeded` exists for.
 */
function woodlands(grid: TileType[][]): Coordinate[][] {
  const seen = new Set<string>();
  const groups: Coordinate[][] = [];

  grid.forEach((cellRow, row) =>
    cellRow.forEach((_, col) => {
      if (at(grid, col, row) !== 'forest' || seen.has(`${col},${row}`)) return;

      const group: Coordinate[] = [{ col, row }];
      seen.add(`${col},${row}`);

      // The group is its own queue: walk it with an index and let it grow
      // underneath, which needs no second array and no non-null assertion.
      for (let head = 0; head < group.length; head++) {
        const tile = group[head];
        for (const { col: c, row: r } of orthogonalNeighbours(tile)) {
          if (at(grid, c, r) !== 'forest' || seen.has(`${c},${r}`)) continue;
          seen.add(`${c},${r}`);
          group.push({ col: c, row: r });
        }
      }

      groups.push(group);
    }),
  );

  return groups;
}

/**
 * Scatters one wood across every tile it covers.
 *
 * ⚠️ **The wood is the unit of placement, not the tile.** Placed tile by tile,
 * every square gets the same count in the same ring, and a forest reads as one
 * pattern stamped repeatedly -- which is exactly what it did. Sampling over the
 * whole group, and rejecting on a spacing measured **between tiles as well as
 * within them**, is what lets a wood look like a single thing that happens to
 * cover several squares.
 *
 * ⚠️ `KEEP_CLEAR` survives all of it, and is the one bound with no give: a unit
 * may stand on any of these tiles, so the middle of every one of them stays
 * empty however the wood is shaped.
 */
function scatterWood(group: Coordinate[], cells: TerrainCell[][]): void {
  const anchor = group[0];
  const next = seeded(anchor.col, anchor.row);
  // Trunks in board coordinates, because spacing has to see across tile edges.
  const trunks: { x: number; z: number }[] = [];

  const plant = (tile: Coordinate, required: boolean): void => {
    let crowded: Prop | null = null;

    for (let attempt = 0; attempt < SCATTER_ATTEMPTS; attempt++) {
      const x = (next() - 0.5) * TREE_SPAN;
      const z = (next() - 0.5) * TREE_SPAN;
      const tree: Prop = {
        model: TREES[Math.floor(next() * TREES.length)],
        x,
        z,
        // Free variety: a tree has no front, so a turn costs nothing and stops
        // a wood reading as one shape stamped repeatedly.
        rotation: next() * 2 * Math.PI,
        scale: TREE_SCALE + next() * TREE_SCALE_VARIANCE,
      };

      if (Math.hypot(x, z) < KEEP_CLEAR) continue;
      crowded ??= tree;

      const room = trunks.every(
        (t) => Math.hypot(t.x - (tile.col + x), t.z - (tile.row + z)) >= TREE_SPACING,
      );
      if (!room) continue;

      trunks.push({ x: tile.col + x, z: tile.row + z });
      cells[tile.row][tile.col].props.push(tree);
      return;
    }

    // ⚠️ A square of woodland is never left bare. If twenty tries could not find
    // room, take the best candidate that at least cleared the centre: two
    // trunks standing close is a thicket, while an empty forest tile is a hole
    // the player can see and the terrain underneath is lying about.
    if (required && crowded) {
      trunks.push({ x: tile.col + crowded.x, z: tile.row + crowded.z });
      cells[tile.row][tile.col].props.push(crowded);
    }
  };

  // ⚠️ **Round robin, not random draws.** Handing each tree to a randomly chosen
  // tile of the group is a multinomial, and its spread is plainly visible:
  // measured over a four-by-four wood it left 2 trees on one square and 7 on
  // another against a target of 5. One pass per tree, each visiting every tile
  // once, makes the counts even by construction and leaves the randomness where
  // it earns something -- where in a tile a trunk lands, and which candidates
  // the spacing turns away.
  //
  // ⚠️ The starting tile rotates each pass, because the visiting order is not
  // neutral: whichever tile goes last has every neighbour's trunk already down
  // to dodge, so a fixed order thins the same squares every time.
  //
  // The first pass is the required one, which is what keeps a square of
  // woodland from ever coming out bare.
  for (let pass = 0; pass < TREES_PER_TILE; pass++) {
    for (let i = 0; i < group.length; i++) {
      plant(group[(i + pass) % group.length], pass === 0);
    }
  }
}

// --- peaks -----------------------------------------------------------------

/**
 * A mountain is a **mesa standing on an ordinary tile**, not raised ground.
 *
 * ⚠️ Which means the tile under it stays flat grass and only the rock rises.
 * That is the difference between this and the elevated block it replaced, and
 * it is the better trade: a block fills its square and so keeps every overlay
 * flush, but it reads as masonry. A rock does not fill a square -- the hover
 * and range tints sit at the mesa's height and float past its sloping edges --
 * and it reads as terrain, which is worth more.
 */
const MESA: TerrainModel = 'rock_largeF';

// --- what grows on open ground ----------------------------------------------

/**
 * Scattered over plains, thinly, so a field of them is not one flat green.
 *
 * ⚠️ Nothing here is terrain and none of it means anything — a tile with a
 * flower on it plays exactly like one without. That is the whole brief, and it
 * is why the scatter is **light**: a doodad on every tile would read as a
 * feature and invite someone to wonder what it does.
 *
 * ⚠️ None wider than 0.41, which is what `DOODAD_RING` is solved against.
 */
const DOODADS: TerrainModel[] = [
  'grass',
  'grass_large',
  'grass_leafs',
  'plant_bushSmall',
  'flower_purpleA',
];

/** Roughly a third of open tiles carry one. The rest stay bare on purpose. */
const DOODAD_CHANCE = 0.35;

/**
 * `KEEP_CLEAR` holds the inward side: a unit stands at the tile's centre.
 *
 * ⚠️ The outward side is deliberately loose. Plains sit at the board's own
 * level, so a tuft leaning a few hundredths onto the flat tile next door is
 * what grass does -- there is no drop for it to float over. `DOODAD_OVERHANG`
 * is how far that may go, and it exists to let these be drawn big enough to
 * read, which at the size they started was the whole problem.
 */
/**
 * How close to a tile's centre a prop may stand.
 *
 * ⚠️ Binds anything a unit shares its tile with, and **not** anything a unit
 * stands on top of -- a mesa sits dead centre on purpose, as does a bridge.
 */
export const KEEP_CLEAR = 0.24;

const DOODAD_RING = 0.25;
const DOODAD_SPREAD = 0.05;
const DOODAD_SCALE = 0.95;
const DOODAD_GROWTH = 0.35;
export const DOODAD_OVERHANG = 0.08;

export const DOODAD_MAX_REACH = DOODAD_RING + DOODAD_SPREAD;
export const DOODAD_MAX_SCALE = DOODAD_SCALE + DOODAD_GROWTH;

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
function neighbourMask(
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
 * Nothing, or one small thing, on open ground.
 *
 * ⚠️ The roll comes off the *same* stream that then places it, so a tile that
 * draws a blank consumes only one value. That is deliberate and worth not
 * "tidying": it means changing `DOODAD_CHANCE` reshuffles which tiles carry
 * something without also reshuffling what the survivors carry.
 */
function doodad(col: number, row: number): Prop[] {
  const next = seeded(col, row);
  if (next() > DOODAD_CHANCE) return [];

  // A free angle rather than a ring: there is only one of these, so it has
  // nothing to space itself against.
  const angle = next() * 2 * Math.PI;
  const radius = DOODAD_RING + next() * DOODAD_SPREAD;

  return [
    {
      model: DOODADS[Math.floor(next() * DOODADS.length)],
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rotation: next() * 2 * Math.PI,
      scale: DOODAD_SCALE + next() * DOODAD_GROWTH,
    },
  ];
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
      // Left empty here and filled by `scatterWood` once every cell exists: a
      // wood is placed across the tiles it covers, not one tile at a time.
      return { ground: 'ground_grass', turns: 0, props: [] };
    case 'mountain':
      return {
        ground: 'ground_grass',
        turns: 0,
        // Centred, because a unit stands on top of it -- the one prop besides a
        // bridge with somewhere it must be. Turned for variety; a rock has no
        // front.
        props: [
          { model: MESA, x: 0, z: 0, rotation: (hash(col, row) % 4) * QUARTER_TURN, scale: 1 },
        ],
        standOnProp: 0,
      };
    default:
      return { ground: 'ground_grass', turns: 0, props: doodad(col, row) };
  }
}

/** Every cell's models, worked out once -- terrain does not change in a match. */
export function composeTerrain(grid: TileType[][]): TerrainCell[][] {
  const cells = grid.map((cellRow, row) => cellRow.map((_, col) => baseCell(grid, col, row)));
  // Woods come second, because one is scattered across the tiles it covers and
  // so cannot be worked out until every cell it covers exists.
  for (const group of woodlands(grid)) scatterWood(group, cells);
  return cells;
}
