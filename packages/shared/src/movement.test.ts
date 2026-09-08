import { describe, expect, it } from 'bun:test';
import { exploreMovement } from './movement';
import { makeState, unitAt } from './testing';
import type { UnitSpec } from './testing';
import type { Coordinate, GameState } from './types';

const has = (tiles: Coordinate[], col: number, row: number) =>
  tiles.some((t) => t.col === col && t.row === row);

const at = (col: number, row: number): Coordinate => ({ col, row });

// The budget and movement type are arguments to the search, not properties of
// the fixture -- so these tests state the numbers they are about and stay
// unaffected by tuning any unit type in the catalog.
const explore = (state: GameState, id: string, movementRange = 3, movementType = 'foot' as const) =>
  exploreMovement(state, unitAt(state, id), movementRange, movementType);

const reachable = (state: GameState, id: string, movementRange = 3) =>
  explore(state, id, movementRange).reachable;

describe('exploreMovement: where a unit may stop', () => {
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
    const SIZE = 3;
    const state = makeState(SIZE, [{ id: 'b1', col: 0, row: 0 }]);
    const tiles = reachable(state, 'b1', SIZE * SIZE); // more budget than board
    expect(tiles).toHaveLength(SIZE * SIZE - 1); // everything except its own tile
    const inside = (t: Coordinate) => t.col >= 0 && t.col < SIZE && t.row >= 0 && t.row < SIZE;
    expect(tiles.every(inside)).toBe(true);
  });

  it('is pure -- the state it was given is untouched', () => {
    const state = makeState(5, [{ id: 'b1', col: 2, row: 2 }]);
    const before = JSON.stringify(state);
    explore(state, 'b1');
    expect(JSON.stringify(state)).toBe(before);
  });
});

// Advance Wars' collision model, and the half people get wrong: an enemy
// blocks the tile *and* the route; a friend blocks only the tile.
describe('exploreMovement: unit collision', () => {
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

describe('exploreMovement: terrain costs', () => {
  // Row 0 is all road, row 1 all forest. Foot pays 1 either way, wheels pay 1
  // on road and 3 in forest -- so the same budget buys very different ground.
  const stripes = ['-----', 'fffff'];

  it('spends the terrain table, not one point per tile', () => {
    const state = makeState(stripes, [{ id: 'b1', col: 0, row: 0 }]);
    const onRoad = explore(state, 'b1', 3, 'wheels').reachable;
    expect(has(onRoad, 3, 0)).toBe(true); // three road tiles, 1 each
    expect(has(onRoad, 4, 0)).toBe(false); // a fourth would be 4

    // The same three points buy one tile of forest and no more.
    expect(has(onRoad, 0, 1)).toBe(true); // one forest tile costs 3
    expect(has(onRoad, 1, 1)).toBe(false); // two would be 6
  });

  it('refuses terrain its movement type cannot enter at all', () => {
    // A mountain wall across the middle: foot may cross it, wheels may not.
    const state = makeState(['...', '^^^', '...'], [{ id: 'b1', col: 1, row: 0 }]);
    expect(has(explore(state, 'b1', 4, 'foot').reachable, 1, 2)).toBe(true);
    expect(has(explore(state, 'b1', 4, 'wheels').reachable, 1, 2)).toBe(false);
    expect(has(explore(state, 'b1', 4, 'wheels').reachable, 1, 1)).toBe(false);
  });

  it('takes the cheap way round rather than the short way through', () => {
    // Two forests sit between the unit and its target on the top row. For
    // wheels that direct line costs 3+3+1 = 7; the road below costs five
    // steps at 1 each. With a budget of 5 the long way is the only way, and
    // it is also genuinely cheaper -- which is what `pathTo` should prefer.
    const state = makeState(['-ff-', '----'], [{ id: 'b1', col: 0, row: 0 }]);
    const path = explore(state, 'b1', 5, 'wheels').pathTo(at(3, 0));
    expect(path).toEqual([at(0, 0), at(0, 1), at(1, 1), at(2, 1), at(3, 1), at(3, 0)]);
    expect(path?.every((step) => step.row === 1 || step.col === 0 || step.col === 3)).toBe(true);
  });
});

describe('exploreMovement: pathTo', () => {
  it('returns a step-by-step route to a reachable tile', () => {
    const state = makeState(5, [{ id: 'b1', col: 0, row: 0 }]);
    const path = explore(state, 'b1', 3).pathTo(at(2, 0));
    expect(path).toEqual([at(0, 0), at(1, 0), at(2, 0)]);
  });

  it('starts where the unit is and ends where it was asked', () => {
    const state = makeState(5, [{ id: 'b1', col: 1, row: 1 }]);
    const path = explore(state, 'b1', 3).pathTo(at(2, 2));
    expect(path?.[0]).toEqual(at(1, 1));
    expect(path?.[path.length - 1]).toEqual(at(2, 2));
  });

  it('is a single tile for the unit its own position -- the wait-in-place shape', () => {
    const state = makeState(5, [{ id: 'b1', col: 2, row: 2 }]);
    expect(explore(state, 'b1', 3).pathTo(at(2, 2))).toEqual([at(2, 2)]);
  });

  it('is null for a tile the search never settled', () => {
    const state = makeState(9, [{ id: 'b1', col: 0, row: 0 }]);
    expect(explore(state, 'b1', 2).pathTo(at(8, 8))).toBeNull();
  });

  // The distinction the search is easiest to get wrong: a friendly unit's
  // tile is settled but not reachable, and a route to the tile *beyond* it
  // has to run through it. Filtering the map rather than the output would
  // make this unfindable.
  it('routes through a friendly unit to reach the tile behind it', () => {
    const state = makeState({ cols: 1, rows: 3 }, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'b2', col: 0, row: 1 },
    ]);
    const movement = explore(state, 'b1', 3);
    expect(has(movement.reachable, 0, 1)).toBe(false); // cannot stop on b2
    expect(movement.pathTo(at(0, 2))).toEqual([at(0, 0), at(0, 1), at(0, 2)]);
  });

  it('never returns a route longer than the budget allows', () => {
    const state = makeState(9, [{ id: 'b1', col: 4, row: 4 }]);
    const movement = explore(state, 'b1', 2);
    for (const tile of movement.reachable) {
      // On plains, foot pays 1 a tile, so steps and cost coincide here.
      expect(movement.pathTo(tile)!.length - 1).toBeLessThanOrEqual(2);
    }
  });
});
