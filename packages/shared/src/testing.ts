// Test fixtures. Kept in src/ so tests can import it, and out of index.ts so it
// is not part of the package's public surface -- server/ and client/ have no
// reason to build game states by hand.
import type { GameState, Unit } from './types';

export interface UnitSpec {
  id: string;
  col: number;
  row: number;
  owner?: string;
  movementRange?: number;
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
    grid: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 'land' as const)),
    players: [
      { id: 'blue', name: 'Blue Army', color: 'blue' },
      { id: 'red', name: 'Red Army', color: 'red' },
    ],
    units: units.map((u): Unit => ({
      id: u.id,
      position: { col: u.col, row: u.row },
      facing: 'south',
      movementRange: u.movementRange ?? 3,
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
