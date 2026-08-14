import { coordinatesEqual } from './coordinate'
import { getReachableTiles } from './reachableTiles'
import type { Coordinate, GameState, Unit } from './types'

export function canSelectUnit(state: GameState, unit: Unit): boolean {
  return unit.owner === state.currentTurn && !unit.hasActed
}

export function canMoveUnit(state: GameState, unit: Unit, destination: Coordinate): boolean {
  if (!canSelectUnit(state, unit)) return false
  return getReachableTiles(state, unit).some((tile) => coordinatesEqual(tile, destination))
}
