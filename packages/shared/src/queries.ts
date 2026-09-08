import { coordinatesEqual } from './coordinate';
import type { TileType } from './data/terrain';
import type { Coordinate, GameState, Player, Unit } from './types';

export function getUnitAt(state: GameState, coordinate: Coordinate): Unit | undefined {
  return state.units.find((unit) => coordinatesEqual(unit.position, coordinate));
}

/**
 * The terrain under a coordinate, or `undefined` off the board -- the same
 * shape `getUnitAt` answers with, so "nothing there" reads the same way for
 * both. The grid is indexed `[row][col]`.
 */
export function getTileAt(state: GameState, coordinate: Coordinate): TileType | undefined {
  return state.grid[coordinate.row]?.[coordinate.col];
}

export function getCurrentPlayer(state: GameState): Player {
  const player = state.players.find((p) => p.id === state.currentTurn);
  if (!player) throw new Error(`no player found for currentTurn ${state.currentTurn}`);
  return player;
}
