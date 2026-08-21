// The public surface of the rulebook. Both server/ and client/ import from
// here rather than reaching into individual files.

export type {
  Action,
  ActionResult,
  Command,
  Coordinate,
  EndTurnAction,
  EndTurnCommand,
  Facing,
  GameEvent,
  GameState,
  MoveAction,
  MoveCommand,
  Player,
  PlayerColor,
  PlayerId,
  TileType,
  TurnEndedEvent,
  Unit,
  UnitMovedEvent,
} from './types'

export type { CommandResult, GameServer, UpdateListener } from './protocol'

export { coordinatesEqual, coordinateKey, isWithinGrid } from './coordinate'
export { getCurrentPlayer, getUnitAt } from './queries'
export { canMoveUnit, canSelectUnit } from './legality'
export { getReachableTiles } from './reachableTiles'
export { applyAction } from './applyAction'
export { applyEndTurn } from './applyEndTurn'
export { applyMove } from './applyMove'

export type { MovementType, UnitType, UnitTypeId } from './data/unitTypes'
export { getUnitType, UNIT_TYPES } from './data/unitTypes'
