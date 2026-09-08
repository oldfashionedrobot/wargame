import type { TileType } from './data/terrain';
import type { UnitTypeId } from './data/unitTypes';

export interface Coordinate {
  col: number;
  row: number;
}

export type Facing = 'north' | 'east' | 'south' | 'west';

export type PlayerId = string;

export type PlayerColor = 'blue' | 'red' | 'green' | 'yellow';

export interface Player {
  id: PlayerId;
  name: string;
  color: PlayerColor;
}

export interface Unit {
  id: string;
  position: Coordinate;
  facing: Facing;
  /**
   * What this unit *is*. Everything that never changes during a match --
   * movement range today, health and combat stats later -- lives on the
   * catalog entry this names, not on the instance. See data/unitTypes.
   */
  unitTypeId: UnitTypeId;
  owner: PlayerId;
  hasActed: boolean;
}

export interface GameState {
  grid: TileType[][];
  units: Unit[];
  players: Player[];
  currentTurn: PlayerId;
}

// --- Commands: what a client asks for -------------------------------------
// Intent only. No actor, no dice. A command can be rejected. The client can
// construct nothing else, which is what makes a client-supplied `actor`
// unrepresentable rather than merely discouraged.

export interface MoveCommand {
  type: 'move';
  unitId: string;
  path: Coordinate[];
}

export interface EndTurnCommand {
  type: 'endTurn';
}

export type Command = MoveCommand | EndTurnCommand;

// --- Actions ---------------------------------------------------------------
// A Command that the authority has accepted. Lives in action.ts, because the
// brand that makes it unforgeable has to be declared where the only
// constructor can see it.

// --- Events: what the server decided happened ------------------------------
// Facts, already resolved. Broadcast to clients, which animate them and never
// resolve anything themselves.

export interface UnitMovedEvent {
  type: 'unitMoved';
  unitId: string;
  path: Coordinate[];
}

export interface TurnEndedEvent {
  type: 'turnEnded';
  nextPlayer: PlayerId;
}

export type GameEvent = UnitMovedEvent | TurnEndedEvent;
