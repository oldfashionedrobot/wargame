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

// The terrain vocabulary a client needs to colour a board. The *table* stays
// unexported: nothing outside shared/ reads a cost or a defence value yet.
// `TERRAIN`, `getTerrain` and `MovementType` come out when something does --
// 7g's damage preview is the likely first, since it needs `defense`.
export type { TileType } from './data/terrain';
// Maps are character grids, and this is the only thing that turns one into a
// board -- the server parses its map definitions with it, and so does the
// test fixture.
export { parseTerrainGrid } from './terrainGrid';

// The unit catalog. Only the accessor is out: `UnitTypeId` follows in 6d,
// when maps start naming the units they place.
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
