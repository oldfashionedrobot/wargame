// The public surface of the rulebook: what server/ and client/ actually
// consume. Anything used only inside shared/ stays unexported from here --
// reducers are reached through applyAction, and union members through their
// union.

export type {
  Action,
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
export { applyAction } from './applyAction';
export { applyEvents } from './applyEvents';

export type {
  CommandResult,
  EventsResponse,
  GameServer,
  MatchSummary,
  StateResponse,
  UpdateListener,
} from './protocol';
export { parseCommand } from './protocol';
