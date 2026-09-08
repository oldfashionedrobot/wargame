import type { GameState, Player, TileType, Unit } from '@vod/shared';

const GRID_WIDTH = 8;
const GRID_HEIGHT = 8;
const PLAYER_ONE_ID = 'player-blue';
const PLAYER_TWO_ID = 'player-red';

export function createInitialState(): GameState {
  const grid: TileType[][] = Array.from({ length: GRID_HEIGHT }, () =>
    Array.from({ length: GRID_WIDTH }, () => 'land'),
  );

  const players: Player[] = [
    { id: PLAYER_ONE_ID, name: 'Blue Army', color: 'blue' },
    { id: PLAYER_TWO_ID, name: 'Red Army', color: 'red' },
  ];

  const units: Unit[] = [
    {
      id: 'blue-1',
      position: { col: 0, row: 0 },
      facing: 'south',
      unitTypeId: 'infantry',
      owner: PLAYER_ONE_ID,
      hasActed: false,
    },
    {
      id: 'blue-2',
      position: { col: 1, row: 0 },
      facing: 'south',
      unitTypeId: 'infantry',
      owner: PLAYER_ONE_ID,
      hasActed: false,
    },
    {
      id: 'blue-3',
      position: { col: 2, row: 0 },
      facing: 'south',
      unitTypeId: 'infantry',
      owner: PLAYER_ONE_ID,
      hasActed: false,
    },
    {
      id: 'red-1',
      position: { col: 7, row: 7 },
      facing: 'north',
      unitTypeId: 'infantry',
      owner: PLAYER_TWO_ID,
      hasActed: false,
    },
    {
      id: 'red-2',
      position: { col: 6, row: 7 },
      facing: 'north',
      unitTypeId: 'infantry',
      owner: PLAYER_TWO_ID,
      hasActed: false,
    },
    {
      id: 'red-3',
      position: { col: 5, row: 7 },
      facing: 'north',
      unitTypeId: 'infantry',
      owner: PLAYER_TWO_ID,
      hasActed: false,
    },
  ];

  return {
    grid,
    units,
    players,
    currentTurn: players[0].id,
  };
}
