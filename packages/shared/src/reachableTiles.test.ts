import { describe, expect, it } from 'bun:test';
import { getReachableTiles } from './reachableTiles';
import { makeState, unitAt } from './testing';
import type { UnitSpec } from './testing';
import type { Coordinate, GameState } from './types';

const has = (tiles: Coordinate[], col: number, row: number) =>
  tiles.some((t) => t.col === col && t.row === row);

// The budget is an argument to the search, not a property of the fixture --
// so these tests state the number they are about, and stay unaffected by
// tuning any unit type's range in the catalog.
const reachable = (state: GameState, id: string, movementRange = 3) =>
  getReachableTiles(state, unitAt(state, id), movementRange);

describe('getReachableTiles', () => {
  it('excludes the unit its own tile -- which is what makes clicking it a deselect', () => {
    const state = makeState(7, [{ id: 'b1', col: 3, row: 3 }]);
    expect(has(reachable(state, 'b1'), 3, 3)).toBe(false);
  });

  it('reaches exactly the tiles within the movement budget', () => {
    const state = makeState(9, [{ id: 'b1', col: 4, row: 4 }]);
    const tiles = reachable(state, 'b1', 2);
    expect(has(tiles, 4, 2)).toBe(true); // 2 away
    expect(has(tiles, 5, 5)).toBe(true); // 2 away, diagonal by two orthogonal steps
    expect(has(tiles, 4, 1)).toBe(false); // 3 away
  });

  it('does not leave the grid', () => {
    // The board size is named once and every expectation derives from it, so
    // this says "the whole board, whatever size that is" rather than
    // repeating a literal the fixture already decided.
    const SIZE = 3;
    const state = makeState(SIZE, [{ id: 'b1', col: 0, row: 0 }]);
    const tiles = reachable(state, 'b1', SIZE * SIZE); // more budget than board
    expect(tiles).toHaveLength(SIZE * SIZE - 1); // everything except its own tile
    const inside = (t: Coordinate) => t.col >= 0 && t.col < SIZE && t.row >= 0 && t.row < SIZE;
    expect(tiles.every(inside)).toBe(true);
  });

  // Advance Wars' collision model, and the half people get wrong: an enemy
  // blocks the tile *and* the route; a friend blocks only the tile.
  describe('unit collision', () => {
    it('cannot enter an enemy-occupied tile', () => {
      const state = makeState(7, [
        { id: 'b1', col: 3, row: 3 },
        { id: 'r1', col: 3, row: 4, owner: 'red' },
      ]);
      expect(has(reachable(state, 'b1'), 3, 4)).toBe(false);
    });

    // A one-wide corridor, so the only route to (0,2) runs through (0,1).
    const corridor = (blocker: UnitSpec) =>
      makeState({ cols: 1, rows: 3 }, [{ id: 'b1', col: 0, row: 0 }, blocker]);

    it('cannot pass through an enemy either -- it blocks the route', () => {
      const tiles = reachable(corridor({ id: 'r1', col: 0, row: 1, owner: 'red' }), 'b1');
      expect(has(tiles, 0, 1)).toBe(false);
      expect(has(tiles, 0, 2)).toBe(false); // unreachable: the enemy blocks the way
    });

    it('can pass through a friendly unit', () => {
      const tiles = reachable(corridor({ id: 'b2', col: 0, row: 1 }), 'b1');
      expect(has(tiles, 0, 2)).toBe(true);
    });

    it('but cannot stop on a friendly unit -- pass-through, not a destination', () => {
      const state = makeState(7, [
        { id: 'b1', col: 3, row: 3 },
        { id: 'b2', col: 3, row: 4 },
      ]);
      expect(has(reachable(state, 'b1'), 3, 4)).toBe(false);
    });
  });

  it('is pure -- the state it was given is untouched', () => {
    const state = makeState(5, [{ id: 'b1', col: 2, row: 2 }]);
    const before = JSON.stringify(state);
    reachable(state, 'b1');
    expect(JSON.stringify(state)).toBe(before);
  });
});
