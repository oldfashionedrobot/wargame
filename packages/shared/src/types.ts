export interface Coordinate {
  col: number;
  row: number;
}

export type TileType = 'land';

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
  movementRange: number;
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

// --- Actions: a command as authenticated by the authority ------------------
// The server attaches `actor` from the connection before handing it to a
// reducer. Reducers only ever see this shape.

export type MoveAction = MoveCommand & { actor: PlayerId };
export type EndTurnAction = EndTurnCommand & { actor: PlayerId };

export type Action = MoveAction | EndTurnAction;

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

// Reducers decide what happened; applyEvents turns that into a new state. They
// deliberately do not return one -- a second mutation path is how live play and
// replay drift apart.
export type ActionResult = { ok: true; events: GameEvent[] } | { ok: false; reason: string };
