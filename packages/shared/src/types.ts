export interface Coordinate {
  col: number
  row: number
}

export type TileType = 'land'

export type Facing = 'north' | 'east' | 'south' | 'west'

export type PlayerId = string

export type PlayerColor = 'blue' | 'red' | 'green' | 'yellow'

export interface Player {
  id: PlayerId
  name: string
  color: PlayerColor
}

export interface Unit {
  id: string
  position: Coordinate
  facing: Facing
  movementRange: number
  owner: PlayerId
  hasActed: boolean
}

export interface GameState {
  grid: TileType[][]
  units: Unit[]
  players: Player[]
  currentTurn: PlayerId
}

export interface MoveAction {
  type: 'move'
  unitId: string
  path: Coordinate[]
}

export interface EndTurnAction {
  type: 'endTurn'
}

export type Action = MoveAction | EndTurnAction

export type ActionResult = { ok: true; state: GameState } | { ok: false; reason: string }
