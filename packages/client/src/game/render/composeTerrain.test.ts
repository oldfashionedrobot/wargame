import { describe, expect, it } from 'vitest';
import { parseTerrainGrid } from '@vod/shared';
import { composeTerrain, propOffset } from './composeTerrain';

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
    expect(cellAt(northSouth, 2, 1)).toMatchObject({
      ground: 'ground_riverStraight',
      overlay: 'bridge_wood',
      overlayTurns: 0, // the deck is drawn running north to south
    });

    const eastWest = compose('..~..', '.-=-.', '..~..');
    expect(cellAt(eastWest, 2, 1)).toMatchObject({ overlay: 'bridge_wood', overlayTurns: 1 });
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
    expect(cellAt(cells, 2, 1).overlayTurns).toBe(0);
    expect(cellAt(cells, 3, 1).overlayTurns).toBe(0);
  });
});

describe('ground cover', () => {
  it('stands trees and spires on grass rather than replacing it', () => {
    const cells = compose('f^.');
    expect(cells[0][0].overlay).toBe('tree_default');
    expect(cells[0][1].overlay).toBe('stone_tallI');
    expect(cells[0][2].overlay).toBeUndefined();
    // All three are grass underneath, whatever is standing on them.
    for (const cell of cells[0]) expect(cell.ground).toBe('ground_grass');
  });

  // ⚠️ A unit stands in the middle of its tile, so a prop planted there is a
  // prop wearing a soldier.
  it('keeps props clear of the middle of the tile', () => {
    for (let col = 0; col < 8; col++) {
      for (let row = 0; row < 8; row++) {
        const { x, z } = propOffset(col, row);
        expect(Math.abs(x)).toBeGreaterThan(0.25);
        expect(Math.abs(z)).toBeGreaterThan(0.25);
      }
    }
  });

  it('puts the same prop in the same place every time', () => {
    expect(propOffset(3, 4)).toEqual(propOffset(3, 4));
  });

  it('does not stack every prop in the same corner', () => {
    const corners = new Set(
      Array.from({ length: 8 }, (_, i) => {
        const { x, z } = propOffset(i, i * 3);
        return `${Math.sign(x)},${Math.sign(z)}`;
      }),
    );
    expect(corners.size).toBeGreaterThan(1);
  });
});
