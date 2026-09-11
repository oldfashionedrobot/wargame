import { describe, expect, it } from 'vitest';
import { parseTerrainGrid } from '@vod/shared';
import { KEEP_CLEAR, MAX_STAND_HEIGHT, QUARTER_TURN, composeTerrain } from './composeTerrain';

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
  it('stands a tree on grass and strews a stone pad with rubble', () => {
    const cells = compose('f^.');
    expect(cells[0][0].ground).toBe('ground_grass');
    expect(cells[0][0].props.map((p) => p.model)).toEqual(['tree_default']);

    // A mountain raises its own ground, so how high a unit stands on it is
    // measured off that model rather than stated anywhere.
    expect(cells[0][1].ground).toBe('cliff_blockQuarter_stone');
    expect(cells[0][1].standOn).toBeUndefined();
    // Several small stones, not one large thing: the pad says *raised* and
    // these only have to say *rocky*.
    expect(cells[0][1].props.length).toBeGreaterThan(1);
    expect(cells[0][1].props.every((p) => p.model.startsWith('stone_small'))).toBe(true);

    expect(cells[0][2].props).toEqual([]);
  });

  // Merging groups by material, so a scatter of six costs the geometry and
  // none of the draw calls -- but only while they all share the pad's stone.
  it('scatters a peak with more than one kind of stone', () => {
    const kinds = new Set(
      compose('^')
        .flat()[0]
        .props.map((p) => p.model),
    );
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('turns and sizes each stone differently', () => {
    const props = compose('^').flat()[0].props;
    expect(new Set(props.map((p) => p.rotation)).size).toBeGreaterThan(1);
    expect(new Set(props.map((p) => p.scale)).size).toBeGreaterThan(1);
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
  // prop wearing a soldier. Checked over a whole board of peaks and woods,
  // because the scatter is the thing that could drift inward and it differs
  // per tile.
  it('keeps every prop clear of the middle of the tile', () => {
    const cells = compose(...Array.from({ length: 12 }, () => '^f^f^f^f^f^f'));
    for (const cell of cells.flat()) {
      for (const prop of cell.props) {
        expect(Math.hypot(prop.x, prop.z)).toBeGreaterThanOrEqual(KEEP_CLEAR);
      }
    }
  });

  // ⚠️ The other edge the scatter is squeezed against. A peak's pad ends at the
  // tile boundary, so a stone that reaches past it hangs in the air over
  // whatever is next door -- at pad height, which is exactly where a floating
  // rock is obvious. Measured off the art rather than guessed; see RUBBLE.
  const WIDEST_STONE = 0.43;

  it('keeps every stone on its own tile', () => {
    const cells = compose(...Array.from({ length: 12 }, () => '^^^^^^^^^^^^'));
    for (const cell of cells.flat()) {
      for (const prop of cell.props) {
        const reach = Math.max(Math.abs(prop.x), Math.abs(prop.z));
        expect(reach + (WIDEST_STONE / 2) * prop.scale).toBeLessThanOrEqual(0.5);
      }
    }
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
    // came from the tile's position and not from the terrain type.
    const row = compose('^^^^^^^^');
    const layouts = new Set(row[0].map((cell) => JSON.stringify(cell.props)));
    expect(layouts.size).toBe(8);
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
