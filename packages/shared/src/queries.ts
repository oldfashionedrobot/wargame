import { coordinatesEqual, orthogonalNeighbours } from './coordinate';
import type { TileType } from './data/terrain';
import type { Coordinate, GameState, Player, Unit } from './types';

export function getUnit(state: GameState, unitId: string): Unit | undefined {
  return state.units.find((unit) => unit.id === unitId);
}

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

/**
 * Would `unit` be in contact standing at `coordinate` -- is an enemy on one of
 * the four tiles beside it?
 *
 * ⚠️ **Every unit makes contact, guns included**, and nothing on the catalog
 * says otherwise: being beside the enemy is the whole of the rule, which is
 * what lets it explain itself on the board without a marker.
 *
 * ⚠️ **Asked of a coordinate, not of the unit's position**, because the search
 * asks it of tiles a unit is only considering, and the refusal asks it of the
 * tile a path *started* on.
 */
export function inContact(state: GameState, unit: Unit, coordinate: Coordinate): boolean {
  return orthogonalNeighbours(coordinate).some((tile) => {
    const other = getUnitAt(state, tile);
    return other !== undefined && other.owner !== unit.owner;
  });
}

export function getCurrentPlayer(state: GameState): Player {
  const player = state.players.find((p) => p.id === state.currentTurn);
  if (!player) throw new Error(`no player found for currentTurn ${state.currentTurn}`);
  return player;
}
