// The public surface of the rulebook: what server/ and client/ actually
// consume. Anything used only inside shared/ stays unexported from here --
// commands are validated and resolved through action.ts, and union members
// are reached through their union.

export type {
  Command,
  Coordinate,
  Facing,
  GameEvent,
  GameState,
  Player,
  PlayerColor,
  PlayerId,
  TileType,
  Unit,
} from './types';

export { coordinatesEqual, isWithinGrid } from './coordinate';
export { getCurrentPlayer, getUnitAt } from './queries';
export { canSelectUnit } from './legality';
export { getReachableTiles } from './reachableTiles';
export { resolveAction, validateCommand } from './action';
export type { Action } from './action';
export { applyEvents } from './applyEvents';

export type {
  CommandResult,
  ErrorResponse,
  EventsResponse,
  GameServer,
  MatchSummary,
  StateResponse,
  UpdateListener,
} from './protocol';
export { parseCommand } from './protocol';
