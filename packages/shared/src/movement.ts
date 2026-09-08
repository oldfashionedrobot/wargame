import { coordinateKey, isWithinGrid } from './coordinate';
import { getTerrain } from './data/terrain';
import type { MovementType } from './data/unitTypes';
import { getTileAt, getUnitAt } from './queries';
import type { Coordinate, GameState, Unit } from './types';

export interface Movement {
  /**
   * Where this unit may legally **stop** -- the overlay. Excludes its own
   * tile and any tile another unit is standing on.
   */
  reachable: Coordinate[];
  /**
   * The cheapest route to a destination, walked back through predecessors --
   * not a second search. `null` for a tile the search never settled.
   *
   * Answers for any *settled* tile, which is a larger set than `reachable`:
   * a friendly unit's tile can be routed through even though nobody may stop
   * on it. "May I stop here" is `reachable`'s question, not this one.
   *
   * The route to the unit's own tile is `[position]` -- the single-element
   * path that costs 0.
   */
  pathTo(destination: Coordinate): Coordinate[] | null;
}

interface Settled {
  coordinate: Coordinate;
  cost: number;
  /** Key of the tile this was reached from; `null` only for the origin. */
  from: string | null;
}

function neighborsOf(coordinate: Coordinate): Coordinate[] {
  return [
    { col: coordinate.col + 1, row: coordinate.row },
    { col: coordinate.col - 1, row: coordinate.row },
    { col: coordinate.col, row: coordinate.row + 1 },
    { col: coordinate.col, row: coordinate.row - 1 },
  ];
}

/**
 * One search, two outputs: where a unit may stop, and how it gets anywhere it
 * settled.
 *
 * **The budget and movement type are arguments, not lookups.** Resolving them
 * from `getUnitType` is the caller's job -- there are two. A search that did
 * it would make every test here name a real unit type to get a budget,
 * coupling tests about the search to catalog values, so tuning cavalry's
 * range would break tests that have nothing to do with cavalry.
 *
 * **It relaxes rather than settling once.** A neighbour already recorded more
 * expensively is lowered and re-queued, which is Bellman-Ford relaxation over
 * a FIFO queue -- correct for any non-negative costs, not only uniform ones.
 * A priority queue would make each node final the first time it is popped,
 * which is easier to reason about but no more correct, and buys no speed
 * worth having: the explored region is bounded by the *budget*, not the
 * board, so a range-6 unit touches a few dozen tiles on a map of any size.
 * If settles-once is ever wanted, the shape is a bucket queue indexed
 * `0..budget` rather than a heap -- the costs are small bounded integers.
 *
 * Collision follows Advance Wars: an enemy blocks the tile *and* the route; a
 * friend blocks only the tile, and can be walked through.
 */
export function exploreMovement(
  state: GameState,
  unit: Unit,
  movementRange: number,
  movementType: MovementType,
): Movement {
  const gridHeight = state.grid.length;
  const gridWidth = state.grid[0]?.length ?? 0;

  // Everything the search touched, keyed by coordinate -- Coordinate has no
  // value equality in JS. This is the map `pathTo` walks; `reachable` is
  // derived from it once, at the end. Filtering the map itself instead would
  // make a route *through* a friendly unit unfindable.
  const settled = new Map<string, Settled>();
  settled.set(coordinateKey(unit.position), { coordinate: unit.position, cost: 0, from: null });
  const queue: Coordinate[] = [unit.position];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const currentKey = coordinateKey(current);
    const currentCost = settled.get(currentKey)?.cost ?? 0;
    if (currentCost >= movementRange) continue; // nothing left to spend

    for (const next of neighborsOf(current)) {
      if (!isWithinGrid(next, gridWidth, gridHeight)) continue;

      const occupant = getUnitAt(state, next);
      if (occupant && occupant.owner !== unit.owner) continue;

      const tile = getTileAt(state, next);
      if (!tile) continue;
      const cost = getTerrain(tile).cost[movementType];
      if (cost === null) continue; // impassable to this unit, not merely dear

      // Checked per step, not once at the top: with costs above 1, having
      // budget left over does not mean the next tile fits inside it.
      const nextCost = currentCost + cost;
      if (nextCost > movementRange) continue;

      const key = coordinateKey(next);
      const known = settled.get(key);
      if (known !== undefined && known.cost <= nextCost) continue;

      settled.set(key, { coordinate: next, cost: nextCost, from: currentKey });
      queue.push(next);
    }
  }

  return {
    reachable: [...settled.values()]
      // `from === null` is the origin, and only the origin: cost 0 is minimal,
      // so nothing ever relaxes it into having a predecessor. It stays in the
      // map because every path chain terminates there.
      .filter((entry) => entry.from !== null)
      .map((entry) => entry.coordinate)
      .filter((coordinate) => !getUnitAt(state, coordinate)),

    pathTo(destination) {
      let cursor: string | null = coordinateKey(destination);
      if (!settled.has(cursor)) return null;

      // Terminates because every terrain costs at least 1 to enter, so a
      // predecessor is always strictly cheaper than what points at it and a
      // cycle cannot form. The terrain table has a test for that.
      const path: Coordinate[] = [];
      while (cursor !== null) {
        const entry: Settled | undefined = settled.get(cursor);
        if (!entry) return null;
        path.unshift(entry.coordinate);
        cursor = entry.from;
      }
      return path;
    },
  };
}
