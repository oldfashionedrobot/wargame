import type { GameState, Player, TileType, Unit } from '@aw/shared'

const GRID_WIDTH = 8
const GRID_HEIGHT = 8

export function createInitialState(): GameState {
  const grid: TileType[][] = Array.from({ length: GRID_HEIGHT }, () =>
    Array.from({ length: GRID_WIDTH }, () => 'land'),
  )

  const players: Player[] = [
    { id: 'player-blue', name: 'Blue Army', color: 'blue' },
    { id: 'player-red', name: 'Red Army', color: 'red' },
  ]

  const units: Unit[] = [
    {
      id: 'blue-1',
      position: { col: 0, row: 0 },
      facing: 'south',
      movementRange: 3,
      owner: 'player-blue',
      hasActed: false,
    },
    {
      id: 'blue-2',
      position: { col: 1, row: 0 },
      facing: 'south',
      movementRange: 3,
      owner: 'player-blue',
      hasActed: false,
    },
    {
      id: 'red-1',
      position: { col: 7, row: 7 },
      facing: 'north',
      movementRange: 3,
      owner: 'player-red',
      hasActed: false,
    },
    {
      id: 'red-2',
      position: { col: 6, row: 7 },
      facing: 'north',
      movementRange: 3,
      owner: 'player-red',
      hasActed: false,
    },
  ]

  return {
    grid,
    units,
    players,
    currentTurn: players[0].id,
  }
}
