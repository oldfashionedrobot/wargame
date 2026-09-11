import { describe, expect, it } from 'bun:test';
import { exploreMovement, validatePath } from './movement';
import { makeState, route, unitAt } from './testing';
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
    // The count is what makes "exactly" mean something: 4 tiles one step out,
    // 8 two steps out. Spot checks alone would pass an implementation that
    // also admitted an extra ring.
    expect(tiles).toHaveLength(12);
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
    // Cheapest to (1,1) is road to (1,0) then down into forest: 1 + 3 = 4.
    expect(has(onRoad, 1, 1)).toBe(false);
  });

  it('refuses terrain its movement type cannot enter at all', () => {
    // A mountain wall across the middle: foot may cross it, wheels may not.
    const state = makeState(['...', '^^^', '...'], [{ id: 'b1', col: 1, row: 0 }]);
    expect(has(explore(state, 'b1', 4, 'foot').reachable, 1, 2)).toBe(true);
    expect(has(explore(state, 'b1', 4, 'wheels').reachable, 1, 2)).toBe(false);
    expect(has(explore(state, 'b1', 4, 'wheels').reachable, 1, 1)).toBe(false);
  });

  // Expensive and impassable are different answers, and the mountain is where
  // that difference is tuned. Written against cavalry's real range, because
  // what decides anything is the ratio of the climb to the budget, not the 4.
  it('lets a horse onto a mountain, but only from close by', () => {
    const HORSE_RANGE = 5;
    // One peak on an open row, approached from the west end. Only its distance
    // changes between the cases.
    const climbs = (row: string) => {
      const state = makeState([row], [{ id: 'b1', col: 0, row: 0 }]);
      return has(explore(state, 'b1', HORSE_RANGE, 'horse').reachable, row.indexOf('^'), 0);
    };

    expect(climbs('.^..')).toBe(true); // alongside already: the climb is 4 of 5
    expect(climbs('..^.')).toBe(true); // one step of approach: 1 + 4 exactly
    expect(climbs('...^')).toBe(false); // two steps: 2 + 4 is over the budget

    // Wheels are still refused outright, at any distance and any budget --
    // costly and impassable did not collapse into the same thing.
    const beside = makeState(['.^..'], [{ id: 'b1', col: 0, row: 0 }]);
    expect(has(explore(beside, 'b1', 99, 'wheels').reachable, 1, 0)).toBe(false);
  });

  it('takes the cheap way round rather than the short way through', () => {
    // Two forests sit between the unit and its target on the top row. For
    // wheels the direct line costs 3+3+1 = 7 across three steps; the road
    // below costs 1 five times.
    //
    // The budget is 7 on purpose, so *both* routes are affordable and the
    // search has to actually prefer the cheaper one. An earlier version used
    // 5, which put the direct line out of reach -- the test could only fail
    // by finding no route at all, never by picking the expensive one, which
    // is the thing its name claims to check.
    const state = makeState(['-ff-', '----'], [{ id: 'b1', col: 0, row: 0 }]);
    const path = explore(state, 'b1', 7, 'wheels').pathTo(at(3, 0));
    expect(path).toEqual([at(0, 0), at(0, 1), at(1, 1), at(2, 1), at(3, 1), at(3, 0)]);
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
    // Without this the loop body is skipped entirely if `reachable` ever
    // regresses to empty, and the test passes by having asserted nothing.
    expect(movement.reachable).toHaveLength(12);
    for (const tile of movement.reachable) {
      // On plains, foot pays 1 a tile, so steps and cost coincide here.
      expect(movement.pathTo(tile)!.length - 1).toBeLessThanOrEqual(2);
    }
  });
});

// The server checks the route it was told rather than deriving one, so this
// is the enforcement half of movement. Its reasons are diagnostics -- a
// client picking destinations from `reachable` and paths from `pathTo`
// cannot trip them.
describe('validatePath', () => {
  const board = (map: string[] | number, units: UnitSpec[]) => {
    const state = makeState(map, units);
    return (path: Coordinate[], range = 3, type = 'foot' as const) =>
      validatePath(state, unitAt(state, 'b1'), path, range, type);
  };

  it('accepts a walkable route within budget', () => {
    const walk = board(5, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk(route(at(0, 0), at(2, 0)))).toBeNull();
  });

  it('accepts standing still -- one tile, no cost', () => {
    const walk = board(5, [{ id: 'b1', col: 2, row: 2 }]);
    expect(walk([at(2, 2)])).toBeNull();
  });

  it('refuses an empty path', () => {
    const walk = board(5, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk([])).toBe('path is empty');
  });

  it('refuses a path that starts somewhere else', () => {
    const walk = board(5, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk(route(at(1, 1), at(1, 2)))).toBe('path does not start at the unit');
  });

  it('refuses a jump between non-adjacent tiles', () => {
    const walk = board(5, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk([at(0, 0), at(0, 2)])).toMatch(/jumps from \(0,0\) to \(0,2\)/);
  });

  it('refuses a diagonal step, which is a jump by another name', () => {
    const walk = board(5, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk([at(0, 0), at(1, 1)])).toMatch(/jumps/);
  });

  it('refuses a path that doubles back over itself', () => {
    const walk = board(5, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk([at(0, 0), at(1, 0), at(0, 0)])).toMatch(/revisits \(0,0\)/);
  });

  it('refuses a route that costs more than the budget', () => {
    const walk = board(9, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk(route(at(0, 0), at(4, 0)))).toBe('move exceeds movement range');
  });

  // The same terrain table the search spends -- entryCost decides both.
  it('refuses terrain this movement type cannot cross', () => {
    const walk = board(['.^.', '...'], [{ id: 'b1', col: 1, row: 1 }]);
    expect(walk([at(1, 1), at(1, 0)], 4, 'wheels')).toBe('wheels cannot cross mountain');
    expect(walk([at(1, 1), at(1, 0)], 4, 'foot')).toBeNull();
  });

  it('charges terrain rather than one point per tile', () => {
    // Three forest tiles cost a horse 6, well over a budget of 4.
    const walk = board(['ffff'], [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk(route(at(0, 0), at(3, 0)), 4, 'horse')).toBe('move exceeds movement range');
    expect(walk(route(at(0, 0), at(2, 0)), 4, 'horse')).toBeNull();
  });

  it('refuses walking into an enemy', () => {
    const walk = board(5, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'r1', col: 1, row: 0, owner: 'red' },
    ]);
    expect(walk(route(at(0, 0), at(1, 0)))).toMatch(/\(1,0\) is held by an enemy/);
  });

  it('walks through a friend but refuses to stop on one', () => {
    const walk = board({ cols: 1, rows: 3 }, [
      { id: 'b1', col: 0, row: 0 },
      { id: 'b2', col: 0, row: 1 },
    ]);
    expect(walk(route(at(0, 0), at(0, 2)))).toBeNull(); // through
    expect(walk(route(at(0, 0), at(0, 1)))).toMatch(/\(0,1\) is occupied/); // onto
  });

  it('refuses a path that leaves the board', () => {
    const walk = board(3, [{ id: 'b1', col: 0, row: 0 }]);
    expect(walk([at(0, 0), at(-1, 0)])).toMatch(/\(-1,0\) is off the board/);
  });

  // The two halves have to agree, or the overlay offers moves the server
  // refuses. They share entryCost precisely so this cannot drift.
  it('accepts every route pathTo builds to a reachable tile', () => {
    const state = makeState(['..f.', '.^..', '....'], [{ id: 'b1', col: 0, row: 0 }]);
    const unit = unitAt(state, 'b1');
    const movement = exploreMovement(state, unit, 4, 'foot');
    expect(movement.reachable.length).toBeGreaterThan(0);
    for (const tile of movement.reachable) {
      expect(validatePath(state, unit, movement.pathTo(tile)!, 4, 'foot')).toBeNull();
    }
  });
});
