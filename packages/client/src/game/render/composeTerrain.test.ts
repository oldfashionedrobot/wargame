import { describe, expect, it } from 'vitest';
import { parseTerrainGrid } from '@vod/shared';
import {
  DOODAD_MAX_REACH,
  DOODAD_OVERHANG,
  DOODAD_MAX_SCALE,
  KEEP_CLEAR,
  MAX_STAND_HEIGHT,
  QUARTER_TURN,
  composeTerrain,
} from './composeTerrain';

// The pure half of the tiler: a grid of terrain in, a grid of atlas indices
// out. No Babylon, so the mask arithmetic and the tables are testable even
// though nothing that draws them is.
//
// ⚠️ `rows[0]` is the row nearest the camera, so these fixtures read bottom-up
// exactly as a map file does.
const compose = (...rows: string[]) => composeTerrain(parseTerrainGrid(rows));
const cellAt = (cells: ReturnType<typeof compose>, col: number, row: number) => cells[row][col];

describe('roads', () => {
  // The sheet's 4x4 is structured -- rows carry the north/south bits, columns
  // the east/west ones -- so these spot-checks are enough to catch a table
  // transcribed a row or a column out.
  it('picks the junction each neighbourhood calls for', () => {
    const cells = compose(
      '..-..', // 0
      '.---.', // 1
      '..-..', // 2
    );
    expect(cells[1][2].ground).toBe('ground_pathCross'); // crossroads: road on all four
    expect(cells[1][1].ground).toBe('ground_pathEnd'); // road only to the east
    expect(cells[1][3].ground).toBe('ground_pathEnd'); // road only to the west
    expect(cells[0][2].ground).toBe('ground_pathEnd'); // road only to the north
    expect(cells[2][2].ground).toBe('ground_pathEnd'); // road only to the south
  });

  it('draws a corner where a road turns, and a straight where it does not', () => {
    const cells = compose(
      '.--', // 0
      '.-.', // 1
    );
    expect(cells[0][1].ground).toBe('ground_pathBend'); // north and east: a corner
    expect(cells[0][2].ground).toBe('ground_pathEnd'); // west only: an end
    expect(cells[1][1].ground).toBe('ground_pathEnd'); // south only: an end
  });

  // The board's edge is *not* road, so a road running to it stops rather than
  // trailing off -- the opposite of what water does.
  it('ends a road at the edge of the board', () => {
    expect(compose('--')[0][0].ground).toBe('ground_pathEnd'); // east only
  });
});

describe('water', () => {
  // The rule that outlives the tileset: no sprite index appears here, only the
  // shape of the shoreline, so this still holds if the art is replaced.
  it('puts the shore on the side the land is on', () => {
    const cells = compose(
      '...', // 0  land
      '~~~', // 1  water
      '...', // 2  land
    );
    // Land north and south, water east and west: a channel across the board.
    // The model is drawn running north-south, so this one is turned.
    expect(cellAt(cells, 1, 1)).toMatchObject({ ground: 'ground_riverStraight', turns: 1 });
  });

  it('runs off the edge of the board rather than growing a shore along it', () => {
    const cells = compose(
      '...', // 0
      '~~~', // 1
      '...', // 2
    );
    // The west end is the board edge, which counts as more water, so this is
    // the same tile as the middle rather than an end cap.
    expect(cellAt(cells, 0, 1)).toEqual(cellAt(cells, 1, 1));
  });

  it('wraps a lake in its nine-slice', () => {
    const cells = compose(
      '.....', // 0
      '.~~~.', // 1
      '.~~~.', // 2
      '.~~~.', // 3
      '.....', // 4
    );
    expect(cellAt(cells, 2, 2).ground).toBe('ground_riverOpen'); // no land at all
    // One model, four turns -- which is the whole reason this is cheaper in
    // three dimensions than it was as sprites.
    // The model banks to the south at rest, so each edge is one more turn.
    expect(cellAt(cells, 2, 1)).toMatchObject({ ground: 'ground_riverSide', turns: 0 }); // land south
    expect(cellAt(cells, 1, 2)).toMatchObject({ ground: 'ground_riverSide', turns: 1 }); // land west
    expect(cellAt(cells, 2, 3)).toMatchObject({ ground: 'ground_riverSide', turns: 2 }); // land north
    expect(cellAt(cells, 3, 2)).toMatchObject({ ground: 'ground_riverSide', turns: 3 }); // land east
    expect(cellAt(cells, 1, 3)).toMatchObject({ ground: 'ground_riverCorner', turns: 2 }); // land west and north
    expect(cellAt(cells, 3, 3)).toMatchObject({ ground: 'ground_riverCorner', turns: 3 }); // land north and east
  });

  // An island: water on all four sides of its neighbours, land on one
  // diagonal, which is the case a four-neighbour mask alone cannot see.
  it('rounds the four corners around an island', () => {
    // Two rings of water, or the cells beside the island would also touch the
    // outer shore and never reach the all-four-sides case at all.
    const cells = compose(
      '.......', // 0
      '.~~~~~.', // 1
      '.~~~~~.', // 2
      '.~~.~~.', // 3  <- the island, at col 3
      '.~~~~~.', // 4
      '.~~~~~.', // 5
      '.......', // 6
    );
    for (const [col, row] of [
      [2, 4],
      [4, 4],
      [2, 2],
      [4, 2],
    ]) {
      expect(cellAt(cells, col, row).ground).toBe('ground_riverCornerSmall');
    }
    // All four, and each turned differently -- one model covers the lot.
    expect(
      new Set([
        cellAt(cells, 2, 4).turns,
        cellAt(cells, 4, 4).turns,
        cellAt(cells, 2, 2).turns,
        cellAt(cells, 4, 2).turns,
      ]).size,
    ).toBe(4);
    // Straight out from the island is *not* a corner: the island is an
    // orthogonal neighbour there, so those cells take a shoreline instead.
    expect(cellAt(cells, 3, 2).ground).toBe('ground_riverSide');
  });

  // The sprite sheet had nothing for this and fell back to a hard blue square.
  // The kit draws it.
  it('draws a pond with no water neighbours at all', () => {
    expect(compose('...', '.~.', '...')[1][1].ground).toBe('ground_riverTile');
  });
});

describe('bridges', () => {
  // A bridge is water with a road over it, so it belongs to both families.
  // Leaving it out of the water one makes every river dead-end at its crossing.
  it('does not break the river it crosses', () => {
    const cells = compose(
      '..-..', // 0
      '~~=~~', // 1
      '..-..', // 2
    );
    // The water either side reads as a continuous channel, not as two stubs.
    expect(cellAt(cells, 1, 1).ground).toBe('ground_riverStraight');
    expect(cellAt(cells, 3, 1).ground).toBe('ground_riverStraight');
  });

  // The deck stands *on* the water, so the ground beneath it is still river --
  // which is why the underside the sprite sheet needed a second pass for does
  // not arise at all here.
  it('stands a deck on the water, turned the way the road runs', () => {
    const northSouth = compose('..-..', '~~=~~', '..-..');
    expect(cellAt(northSouth, 2, 1).ground).toBe('ground_riverStraight');
    expect(cellAt(northSouth, 2, 1).props).toEqual([
      // The deck is drawn spanning east to west, so a north-south road turns it.
      { model: 'bridge_wood', x: 0, z: 0, rotation: QUARTER_TURN, scale: 1 },
    ]);

    const eastWest = compose('..~..', '.-=-.', '..~..');
    expect(cellAt(eastWest, 2, 1).props[0]).toMatchObject({
      model: 'bridge_wood',
      rotation: 0,
    });
  });

  // A two-lane crossing gives its bridge cells masks 7 and 13 rather than 5
  // and 10, because each lane sees the other beside it -- so orientation
  // cannot be read off the road mask, and asks about strictly-road neighbours.
  it('runs a two-lane deck the way the road does, not the way the mask says', () => {
    const cells = compose(
      '..--..', // 0
      '~~==~~', // 1
      '..--..', // 2
    );
    expect(cellAt(cells, 2, 1).props[0].rotation).toBe(QUARTER_TURN);
    expect(cellAt(cells, 3, 1).props[0].rotation).toBe(QUARTER_TURN);
  });
});

describe('ground cover', () => {
  it('stands a tree on grass and a mesa on a mountain', () => {
    const cells = compose('f^.');
    expect(cells[0][0].ground).toBe('ground_grass');
    // One tree, and which one is the tile's own business -- see the variety
    // tests below.
    expect(cells[0][0].props).toHaveLength(1);
    expect(cells[0][0].props[0].model.startsWith('tree_')).toBe(true);

    // ⚠️ A mountain does **not** raise its ground: the tile stays flat grass
    // and a rock stands on it, which is the whole shape of the thing. How high
    // a unit ends up is the rock's own top, so it is pointed at rather than
    // stated -- `standOnProp`, never `standOn`.
    const peak = cells[0][1];
    expect(peak.ground).toBe('ground_grass');
    expect(peak.props).toHaveLength(1);
    expect(peak.standOnProp).toBe(0);
    expect(peak.standOn).toBeUndefined();
    // Centred, unlike everything else that stands on a tile, because a unit
    // stands on top of it.
    expect({ x: peak.props[0].x, z: peak.props[0].z }).toEqual({ x: 0, z: 0 });

    // ⚠️ Plains are no longer bare -- they carry scenery. What they never carry
    // is a tree or a stone, because both of those say something about the tile
    // and scenery says nothing.
    const onPlains = cells[0][2].props.map((prop) => prop.model);
    expect(onPlains).not.toContain('tree_default');
    expect(onPlains.some((model) => model.startsWith('stone_'))).toBe(false);
  });

  // The only height in the renderer that is stated rather than measured, and
  // the reason is that a bridge's own top is its handrail.
  it('stands a unit on the bridge deck, not on the water under it', () => {
    const cells = compose('..-..', '~~=~~', '..-..');
    expect(cells[1][2].standOn).toBeGreaterThan(0);
    expect(cells[1][1].standOn).toBeUndefined(); // the water beside it is not walked on
  });

  // The ceiling binds whatever is stated here just as it binds the models --
  // see terrainHeights.test.ts for the other half.
  it('never stands a unit higher than picking can absorb', () => {
    const cells = compose('f^-~=', '.~^-.', '=-~^f');
    for (const row of cells) {
      for (const cell of row) {
        expect(cell.standOn ?? 0).toBeLessThanOrEqual(MAX_STAND_HEIGHT);
      }
    }
  });

  // ⚠️ A unit stands in the middle of its tile, so a prop planted there is a
  // prop wearing a soldier. Checked over a board carrying every kind of
  // scatter there is -- peaks, woods and open ground -- because each is placed
  // by different arithmetic and any of them could drift inward.
  it('keeps every prop clear of the middle of the tile', () => {
    const cells = compose(...Array.from({ length: 12 }, () => '^f.^f.^f.^f.'));
    for (const cell of cells.flat()) {
      cell.props.forEach((prop, i) => {
        // ⚠️ Except the one a unit stands *on top of*. A mesa is centred
        // precisely because the unit ends up above it rather than beside it,
        // and holding it to the keep-clear would be holding it to the opposite
        // of what it is for.
        if (i === cell.standOnProp) return;
        expect(Math.hypot(prop.x, prop.z)).toBeGreaterThanOrEqual(KEEP_CLEAR);
      });
    }
  });

  // ⚠️ A bound, but a loose one: plains are flat, so a tuft leaning onto the
  // tile beside it has no drop to float over. It still has to be a bound,
  // because "a bit over the edge" and "halfway onto next door" are different
  // things. Solved from the constants, not sampled.
  const WIDEST_DOODAD = 0.41;

  it('lets a doodad lean over its edge, but only barely', () => {
    const reach = DOODAD_MAX_REACH + (WIDEST_DOODAD / 2) * DOODAD_MAX_SCALE;
    expect(reach).toBeLessThanOrEqual(0.5 + DOODAD_OVERHANG);
    expect(reach).toBeGreaterThan(0.5); // or the allowance is dead and should go
  });

  // A bridge is the exception, and deliberately so: it spans its tile, and a
  // unit stands on its deck rather than beside it.
  it('centres a bridge instead', () => {
    const deck = compose('..-..', '~~=~~', '..-..')[1][2].props[0];
    expect({ x: deck.x, z: deck.z }).toEqual({ x: 0, z: 0 });
  });

  it('puts the same props in the same places every time', () => {
    expect(compose('^')).toEqual(compose('^'));
    expect(compose('.f.')[0][1].props).toEqual(compose('.f.')[0][1].props);
  });

  it('does not lay every tile out identically', () => {
    // Same terrain, different coordinates -- so anything shared between these
    // came from the tile's position and not from the terrain type. Woodland
    // rather than peaks: a mesa is one centred rock and has only its turn to
    // vary, while a tree varies in shape, place, turn and size.
    const row = compose('ffffffff');
    const layouts = new Set(row[0].map((cell) => JSON.stringify(cell.props)));
    expect(layouts.size).toBe(8);
  });

  // ⚠️ *Light* is the brief and the thing that could quietly stop being true.
  // Every tile carrying something reads as a feature rather than as scenery,
  // and a bare board is what this was added to fix -- so both ends are held.
  it('scatters open ground thinly, leaving most of it bare', () => {
    const plains = compose(...Array.from({ length: 14 }, () => '..............')).flat();
    const carrying = plains.filter((cell) => cell.props.length > 0).length;
    const share = carrying / plains.length;

    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.55);
  });

  it('puts at most one doodad on a tile', () => {
    const plains = compose(...Array.from({ length: 10 }, () => '..........')).flat();
    expect(Math.max(...plains.map((cell) => cell.props.length))).toBe(1);
  });

  it('uses more than one kind, and turns and sizes them differently', () => {
    const props = compose(...Array.from({ length: 10 }, () => '..........'))
      .flat()
      .flatMap((cell) => cell.props);

    expect(new Set(props.map((p) => p.model)).size).toBeGreaterThan(1);
    expect(new Set(props.map((p) => p.rotation)).size).toBeGreaterThan(1);
    expect(new Set(props.map((p) => p.scale)).size).toBeGreaterThan(1);
  });

  // Scenery, not terrain: a tile with a flower on it plays exactly like one
  // without, so nothing about the cell may differ but its props.
  it('leaves a decorated tile otherwise identical to a bare one', () => {
    const plains = compose(...Array.from({ length: 8 }, () => '........')).flat();
    const bare = plains.find((cell) => cell.props.length === 0);
    const decorated = plains.find((cell) => cell.props.length > 0);

    expect({ ...bare, props: [] }).toEqual({ ...decorated, props: [] });
  });

  // A wood used to be one shape stamped repeatedly. Six shapes, each turned and
  // sized, is what stops a forest reading as wallpaper.
  it('draws a wood out of more than one kind of tree', () => {
    const trees = compose(...Array.from({ length: 8 }, () => 'ffffffff'))
      .flat()
      .flatMap((cell) => cell.props);

    expect(new Set(trees.map((t) => t.model)).size).toBeGreaterThan(1);
    expect(new Set(trees.map((t) => t.rotation)).size).toBeGreaterThan(1);
    expect(new Set(trees.map((t) => t.scale)).size).toBeGreaterThan(1);
    expect(trees.every((t) => t.model.startsWith('tree_'))).toBe(true);
  });

  it('does not stack every tree in the same corner', () => {
    const corners = new Set(
      compose('ffffffff', 'ffffffff')
        .flat()
        .map(({ props }) => `${Math.sign(props[0].x)},${Math.sign(props[0].z)}`),
    );
    expect(corners.size).toBeGreaterThan(1);
  });
});
