// The public surface of the rulebook: what server/ and client/ actually
// consume. Anything used only inside shared/ stays unexported from here --
// commands are validated and resolved through action.ts, and union members
// are reached through their union.

export type {
  AttackKind,
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
// Armies are character grids too, and this is the only thing that turns one
// into placements. Same split as terrain: the parser is here because what it
// produces is game state, while the armies themselves are the server's.
export { armyWidth, parseArmyGrid } from './armyGrid';
export type { ArmyPlacement } from './armyGrid';

// The unit catalog. `UnitTypeId` is out because an army names the units it
// places; the rest of the catalog is read through `getUnitType`.
export type { UnitTypeId } from './data/unitTypes';
export { clampHealth, getUnitType, MAX_HEALTH } from './data/unitTypes';

// Combat: the table is out because the tuning harness prints it, and
// `computeDamage` because the client previews the same number the server rolls.
export {
  BASE_DAMAGE,
  CHARGE_HALF_LIFE,
  CHARGE_REPEL,
  CHARGE_THRESHOLD,
  LUCK_MAX,
  REPEL_DIVISOR,
} from './data/combat';
export {
  band,
  BANDS,
  chargeChance,
  chargeThreshold,
  computeDamage,
  refuseAttack,
  refuseCharge,
  tilesInRange,
  wouldCounter,
} from './combat';
export type { ChargeRolls, FireRolls, Rolls } from './combat';

export {
  attackSide,
  coordinatesEqual,
  directionBetween,
  facingToward,
  isWithinGrid,
  tileDistance,
} from './coordinate';
export { getCurrentPlayer, getUnit, getUnitAt } from './queries';
export { canSelectUnit } from './legality';
export { isOver, soleSurvivor } from './victory';
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
  MapSummary,
  MatchSummary,
  StateResponse,
  UpdateListener,
} from './protocol';
export { parseCommand } from './protocol';
