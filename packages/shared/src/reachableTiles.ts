import { coordinateKey, isWithinGrid } from './coordinate';
import { getUnitAt } from './queries';
import type { Coordinate, GameState, Unit } from './types';

function neighborsOf(coordinate: Coordinate): Coordinate[] {
  return [
    { col: coordinate.col + 1, row: coordinate.row },
    { col: coordinate.col - 1, row: coordinate.row },
    { col: coordinate.col, row: coordinate.row + 1 },
    { col: coordinate.col, row: coordinate.row - 1 },
  ];
}

// Placeholder movement model: every tile costs 1 to enter, terrain is
// ignored entirely. A plain BFS is correct here specifically because every
// edge has the same cost -- once terrain-aware cost enters the picture this
// has to become a Dijkstra/uniform-cost search instead.
//
// The budget arrives as an argument rather than being read off the unit,
// which is deliberate: it lives on the unit's UnitType now, and a search that
// looked it up would make every test here name a real unit type to get one --
// coupling tests about the *search* to catalog values, so tuning cavalry's
// range would break tests that have nothing to do with cavalry. Resolving it
// is the caller's job; there are two.
//
// Enemy-occupied tiles are fully impassable (can't enter or pass through).
// Friendly-occupied tiles can be passed through but aren't valid stopping
// points -- matches how Advance Wars handles unit collision.
export function getReachableTiles(
  state: GameState,
  unit: Unit,
  movementRange: number,
): Coordinate[] {
  const gridHeight = state.grid.length;
  const gridWidth = state.grid[0]?.length ?? 0;

  // Keyed by coordinateKey because Coordinate has no value equality in JS, but
  // the coordinate is carried alongside its cost so nothing ever has to parse a
  // key back into numbers.
  const visited = new Map<string, { coordinate: Coordinate; cost: number }>();
  visited.set(coordinateKey(unit.position), { coordinate: unit.position, cost: 0 });
  const queue: Coordinate[] = [unit.position];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const currentCost = visited.get(coordinateKey(current))?.cost ?? 0;
    if (currentCost >= movementRange) continue;

    for (const next of neighborsOf(current)) {
      if (!isWithinGrid(next, gridWidth, gridHeight)) continue;

      const occupant = getUnitAt(state, next);
      if (occupant && occupant.owner !== unit.owner) continue;

      const nextCost = currentCost + 1;
      const key = coordinateKey(next);
      const known = visited.get(key);
      if (known !== undefined && known.cost <= nextCost) continue;

      visited.set(key, { coordinate: next, cost: nextCost });
      queue.push(next);
    }
  }

  visited.delete(coordinateKey(unit.position));
  return [...visited.values()]
    .map((entry) => entry.coordinate)
    .filter((coordinate) => !getUnitAt(state, coordinate));
}
