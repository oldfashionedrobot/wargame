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

// The terrain vocabulary, and the lookup that gives it meaning. `getTerrain`
// is out because the server validates its maps against terrain costs; the
// table itself stays unexported until something needs to iterate it.
export type { TileType } from './data/terrain';
export { getTerrain } from './data/terrain';
// Maps are character grids, and this is the only thing that turns one into a
// board -- the server parses its map definitions with it, and so does the
// test fixture.
export { parseTerrainGrid } from './terrainGrid';

// The unit catalog. `UnitTypeId` is out because maps name the units they
// place; the rest of the catalog is read through `getUnitType`.
export type { UnitTypeId } from './data/unitTypes';
export { getUnitType } from './data/unitTypes';

export { coordinatesEqual, isWithinGrid } from './coordinate';
export { getCurrentPlayer, getUnit, getUnitAt } from './queries';
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
