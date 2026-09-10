import { describe, expect, it } from 'vitest';
import { parseTerrainGrid } from '@vod/shared';
import { composeTerrain } from './composeTerrain';

// The pure half of the tiler: a grid of terrain in, a grid of atlas indices
// out. No Babylon, so the mask arithmetic and the tables are testable even
// though nothing that draws them is.
//
// ⚠️ `rows[0]` is the row nearest the camera, so these fixtures read bottom-up
// exactly as a map file does.
const compose = (...rows: string[]) => composeTerrain(parseTerrainGrid(rows));
const groundAt = (cells: ReturnType<typeof compose>, col: number, row: number) =>
  cells[row][col].ground;

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
    expect(groundAt(cells, 2, 1)).toBe(146); // crossroads: road on all four
    expect(groundAt(cells, 1, 1)).toBe(109); // road only to the east
    expect(groundAt(cells, 3, 1)).toBe(111); // road only to the west
    expect(groundAt(cells, 2, 0)).toBe(162); // road only to the north
    expect(groundAt(cells, 2, 2)).toBe(126); // road only to the south
  });

  it('draws a corner where a road turns, and a straight where it does not', () => {
    const cells = compose(
      '.--', // 0
      '.-.', // 1
    );
    expect(groundAt(cells, 1, 0)).toBe(163); // north and east: a corner
    expect(groundAt(cells, 2, 0)).toBe(111); // west only: an end
    expect(groundAt(cells, 1, 1)).toBe(126); // south only: an end
  });

  // The board's edge is *not* road, so a road running to it stops rather than
  // trailing off -- the opposite of what water does.
  it('ends a road at the edge of the board', () => {
    expect(groundAt(compose('--'), 0, 0)).toBe(109); // east only
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
    expect(groundAt(cells, 1, 1)).toBe(57);
    expect(cells[1][1].turns).toBe(1); // the only channel drawn runs the other way
  });

  it('runs off the edge of the board rather than growing a shore along it', () => {
    const cells = compose(
      '...', // 0
      '~~~', // 1
      '...', // 2
    );
    // The west end is the board edge, which counts as more water, so this is
    // the same tile as the middle rather than an end cap.
    expect(groundAt(cells, 0, 1)).toBe(groundAt(cells, 1, 1));
  });

  it('wraps a lake in its nine-slice', () => {
    const cells = compose(
      '.....', // 0
      '.~~~.', // 1
      '.~~~.', // 2
      '.~~~.', // 3
      '.....', // 4
    );
    expect(groundAt(cells, 2, 2)).toBe(37); // open water in the middle
    expect(groundAt(cells, 1, 3)).toBe(18); // land north and west
    expect(groundAt(cells, 2, 3)).toBe(19); // land north
    expect(groundAt(cells, 3, 3)).toBe(20); // land north and east
    expect(groundAt(cells, 1, 1)).toBe(54); // land south and west
    expect(groundAt(cells, 3, 1)).toBe(56); // land south and east
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
    expect(groundAt(cells, 2, 4)).toBe(92); // island on its south-east diagonal
    expect(groundAt(cells, 4, 4)).toBe(93); // island south-west
    expect(groundAt(cells, 2, 2)).toBe(91); // island north-east
    expect(groundAt(cells, 4, 2)).toBe(90); // island north-west
    // Straight out from the island is *not* a corner: the island is an
    // orthogonal neighbour there, so those cells take a shoreline instead.
    expect(groundAt(cells, 3, 2)).toBe(19); // island to its north
  });

  // Nothing was drawn for a pond with no water neighbours, so it falls back to
  // open water: a hard-edged square, and visibly so rather than silently.
  it('falls back to open water where the sheet has no tile', () => {
    expect(groundAt(compose('...', '.~.', '...'), 1, 1)).toBe(37);
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
    expect(groundAt(cells, 1, 1)).toBe(57);
    expect(groundAt(cells, 3, 1)).toBe(57);
  });

  it('runs the deck the way the road does', () => {
    const northSouth = compose('..-..', '~~=~~', '..-..');
    expect(groundAt(northSouth, 2, 1)).toBe(166);

    const eastWest = compose('..~..', '.-=-.', '..~..');
    expect(groundAt(eastWest, 2, 1)).toBe(130);
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
    expect(groundAt(cells, 2, 1)).toBe(166);
    expect(groundAt(cells, 3, 1)).toBe(166);
  });

  // The east-west deck is drawn a tile and a half tall, so it overhangs the
  // water below it. The only rule where a neighbour's decision reaches in.
  it('shows the underside of an east-west deck in the water beneath it', () => {
    const cells = compose(
      '..~..', // 0  <- beneath the deck
      '.-=-.', // 1
      '..~..', // 2
    );
    expect(groundAt(cells, 2, 0)).toBe(148);
    // And not above it, which sees only its own shoreline.
    expect(groundAt(cells, 2, 2)).not.toBe(148);
  });

  it('leaves the water alone under a north-south deck', () => {
    const cells = compose('..-..', '~~=~~', '..-..');
    expect(groundAt(cells, 2, 0)).not.toBe(148);
  });
});

describe('ground cover', () => {
  it('stands trees and peaks on grass rather than replacing it', () => {
    const cells = compose('f^.');
    expect(cells[0][0].overlay).toBe(112);
    expect(cells[0][1].overlay).toBe(5);
    expect(cells[0][2].overlay).toBeUndefined();
    // All three are grass underneath, whatever is standing on them.
    for (const cell of cells[0]) expect(cell.ground).toBeLessThan(3);
  });

  // Deterministic, or the field reshuffles every time the mesh rebuilds.
  it('picks the same grass for the same tile every time', () => {
    const rows = ['....', '....', '....'];
    expect(compose(...rows)).toEqual(compose(...rows));
  });

  it('does not make every tile the same grass', () => {
    const cells = compose('.'.repeat(20), '.'.repeat(20), '.'.repeat(20));
    const used = new Set(cells.flat().map((cell) => cell.ground));
    expect(used.size).toBeGreaterThan(1);
  });
});
