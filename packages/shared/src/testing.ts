// Test fixtures. Kept in src/ so tests can import it, and out of index.ts so it
// is not part of the package's public surface -- server/ and client/ have no
// reason to build game states by hand.
import type { UnitTypeId } from './data/unitTypes';
import type { GameState, Unit } from './types';

export interface UnitSpec {
  id: string;
  col: number;
  row: number;
  owner?: string;
  /** Defaults to infantry. What it buys -- movement range today -- is read
   *  from the catalog, so a search test wanting a particular budget passes
   *  one to the search rather than picking a type that happens to have it. */
  unitTypeId?: UnitTypeId;
  hasActed?: boolean;
}

/**
 * A board with the units you name and nothing else.
 *
 * A number gives a square board; `{ cols, rows }` gives anything else -- a
 * one-wide corridor is the shape that makes "can this unit pass through that
 * one" answerable without a wall of surrounding tiles.
 *
 * Two players, 'blue' and 'red', with blue to move. Everything a test cares
 * about is a named argument, so the interesting part of a fixture is visible
 * at the call site rather than buried in defaults.
 */
export function makeState(
  size: number | { cols: number; rows: number },
  units: UnitSpec[],
  currentTurn = 'blue',
): GameState {
  const { cols, rows } = typeof size === 'number' ? { cols: size, rows: size } : size;
  return {
    // grid is indexed [row][col]
    grid: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'plains' as const)),
    players: [
      { id: 'blue', name: 'Blue Army', color: 'blue' },
      { id: 'red', name: 'Red Army', color: 'red' },
    ],
    units: units.map((u): Unit => ({
      id: u.id,
      position: { col: u.col, row: u.row },
      facing: 'south',
      unitTypeId: u.unitTypeId ?? 'infantry',
      owner: u.owner ?? 'blue',
      hasActed: u.hasActed ?? false,
    })),
    currentTurn,
  };
}

export const unitAt = (state: GameState, id: string): Unit => {
  const unit = state.units.find((u) => u.id === id);
  if (!unit) throw new Error(`no unit ${id} in fixture`);
  return unit;
};
