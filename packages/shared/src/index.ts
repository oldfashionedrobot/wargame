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
  Unit,
} from './types';

// Terrain vocabulary and the table that gives it meaning. Both sides read the
// same one -- the cost model has to agree or the client's reachable overlay
// offers moves the server refuses.
export type { Terrain, TileType } from './data/terrain';
export { getTerrain, TERRAIN } from './data/terrain';
// Maps are character grids, and this is the only thing that turns one into a
// board -- the server parses its map definitions with it, and so does the
// test fixture.
export { parseTerrainGrid } from './terrainGrid';

// The unit catalog. Both sides read it: the client to preview what a unit can
// do, the server to resolve the same thing authoritatively.
export type { MovementType, UnitType, UnitTypeId } from './data/unitTypes';
export { getUnitType } from './data/unitTypes';

export { coordinatesEqual, isWithinGrid } from './coordinate';
export { getCurrentPlayer, getUnitAt } from './queries';
export { canSelectUnit } from './legality';
export { exploreMovement } from './movement';
export type { Movement } from './movement';
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
