import { coordinatesEqual } from './coordinate';
import type { Coordinate, GameState, Player, Unit } from './types';

export function getUnitAt(state: GameState, coordinate: Coordinate): Unit | undefined {
  return state.units.find((unit) => coordinatesEqual(unit.position, coordinate));
}

export function getCurrentPlayer(state: GameState): Player {
  const player = state.players.find((p) => p.id === state.currentTurn);
  if (!player) throw new Error(`no player found for currentTurn ${state.currentTurn}`);
  return player;
}
