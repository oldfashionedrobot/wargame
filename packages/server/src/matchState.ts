import { parseTerrainGrid } from '@vod/shared';
import type { GameState, Player, Unit } from '@vod/shared';
import type { GameMap } from './maps';

// The two players every match is between. Hardcoded until there is a lobby to
// choose them in: a map places units by owner *index*, so it never names them.
const PLAYERS: Player[] = [
  { id: 'player-blue', name: 'Blue Army', color: 'blue' },
  { id: 'player-red', name: 'Red Army', color: 'red' },
];

/**
 * Instantiates a map into the state a match starts from.
 *
 * Unit ids are `${colour}-${n}`, numbered per owner in the order the map lists
 * them. Deterministic on purpose: `initial_state` plus the log has to replay
 * identically, which a generated or random id would break.
 */
export function createMatchState(map: GameMap): GameState {
  const counts = new Map<number, number>();

  const units = map.units.map((placement): Unit => {
    const player = PLAYERS[placement.owner];
    if (!player)
      throw new Error(`map ${map.id} places a unit for unknown player ${placement.owner}`);

    const ordinal = (counts.get(placement.owner) ?? 0) + 1;
    counts.set(placement.owner, ordinal);

    return {
      id: `${player.color}-${ordinal}`,
      position: placement.at,
      facing: placement.owner === 0 ? 'south' : 'north',
      unitTypeId: placement.type,
      owner: player.id,
      hasActed: false,
    };
  });

  return {
    grid: parseTerrainGrid(map.rows),
    units,
    players: PLAYERS,
    currentTurn: PLAYERS[0].id,
  };
}
